"""Telegram polling entry point with optional Vibee HTTP delivery."""
import asyncio
from contextlib import suppress
import os
import sys
import logging
from datetime import timezone

from aiogram import Bot, Dispatcher, F
from aiogram.filters import Command, CommandStart
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

from .flow import CheckinFlow, QUESTIONS
from .http_transport import HttpTransport, TransportError
from .intake import ConsentSnapshot, TelegramIntake


def create_dispatcher(intake: TelegramIntake | None = None) -> Dispatcher:
    dispatcher = Dispatcher()
    flow = CheckinFlow()

    async def question(message, nonce, step):
        keyboard = InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(text=str(n), callback_data=f"score:{nonce}:{step}:{n}")
            for n in range(1, 6)
        ]])
        await message.answer(f"{step + 1}/3. {QUESTIONS[step][1]}\n1 — низкая оценка, 5 — высокая. Отказ: /stop", reply_markup=keyboard)

    @dispatcher.message(CommandStart())
    async def start(message: Message):
        if message.chat.type != "private":
            await message.answer("Откройте личный диалог с ботом для добровольного демо-чек-ина. Переписка группы не анализируется.")
            return
        nonce = flow.begin(message.from_user.id)
        keyboard = InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(text="Согласен на демо", callback_data=f"consent:{nonce}:yes"),
            InlineKeyboardButton(text="Отказаться", callback_data=f"consent:{nonce}:no"),
        ]])
        await message.answer("Vibee · демо-прототип. Собираем только три оценки 1–5. Черновик действует пять минут; очистка памяти выполняется каждые 15 секунд, а после завершения или /stop — сразу. Тексты переписки не анализируются. Передача на веб-платформу и ИИ пока не подключены; результаты руководителю не отправляются. Это личный тест, корпоративный модуль ещё в разработке.", reply_markup=keyboard)

    @dispatcher.message(Command("stop"))
    async def stop(message: Message):
        flow.cancel(message.from_user.id)
        await message.answer("Участие отменено, черновик удалён из памяти бота. Сообщения в Telegram автоматически не удаляются.")

    @dispatcher.message(F.text)
    async def intake_message(message: Message) -> None:
        if intake is None or message.chat.type == "private" or message.from_user is None:
            return
        update = {
            "update_type": "message",
            "message": {
                "chat": {"id": message.chat.id},
                "from": {"id": message.from_user.id, "is_bot": message.from_user.is_bot},
                "message_id": message.message_id,
                "date": int((message.date.replace(tzinfo=timezone.utc) if message.date.tzinfo is None else message.date.astimezone(timezone.utc)).timestamp()),
                "text": message.text,
            },
        }
        try:
            await intake.process(update)
        except TransportError:
            intake.stop_after_transport_gap()
            logging.getLogger(__name__).warning("Telegram intake paused after delivery failure; pause the binding on the server before resuming")

    @dispatcher.callback_query(F.data.startswith("consent:") | F.data.startswith("score:"))
    async def callback(event: CallbackQuery):
        if not isinstance(event.message, Message) or event.message.chat.type != "private":
            await event.answer("Чек-ин доступен в личном диалоге")
            return
        try:
            parts = event.data.split(":")
            if parts[0] == "consent" and len(parts) == 3:
                if parts[2] not in ("yes", "no"):
                    raise ValueError("Неверный выбор")
                accepted = flow.consent(event.from_user.id, parts[1], parts[2] == "yes")
                await event.answer()
                if accepted:
                    await question(event.message, parts[1], 0)
                else:
                    await event.message.answer("Участие отменено. Черновик удалён.")
            elif parts[0] == "score" and len(parts) == 4:
                step = int(parts[2])
                result = flow.answer(event.from_user.id, parts[1], step, int(parts[3]))
                await event.answer()
                if result is not None:
                    await event.message.answer("Демо-чек-ин завершён, черновик удалён из памяти. На веб-платформу ответы не отправлены: интеграция ещё в разработке.")
                else:
                    await question(event.message, parts[1], step + 1)
            else:
                raise ValueError("Неверная кнопка")
        except ValueError as error:
            await event.answer(str(error), show_alert=True)

    return dispatcher, flow


async def main():
    if "--check" in sys.argv:
        dispatcher, _ = create_dispatcher()
        print("OK: aiogram handlers loaded; mode=demo; server_connected=false")
        return
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token:
        raise SystemExit("Set TELEGRAM_BOT_TOKEN locally. Do not commit it. Use --check for an offline check.")
    api_token = os.environ.get("VIBEE_BOT_TOKEN")
    binding_id = os.environ.get("VIBEE_BINDING_ID")
    chat_id_raw = os.environ.get("VIBEE_CHAT_ID")
    api_base_url = os.environ.get("VIBEE_API_BASE_URL", "http://localhost:8787")
    if any((api_token, binding_id, chat_id_raw)) and not all((api_token, binding_id, chat_id_raw)):
        raise SystemExit("Set VIBEE_BOT_TOKEN, VIBEE_BINDING_ID and VIBEE_CHAT_ID together.")

    transport: HttpTransport | None = None
    intake: TelegramIntake | None = None
    if api_token and binding_id and chat_id_raw:
        try:
            chat_id = int(chat_id_raw)
            if chat_id >= 0 or str(chat_id) != chat_id_raw:
                raise ValueError()
        except ValueError:
            raise SystemExit("VIBEE_CHAT_ID must be a negative Telegram group ID.") from None
        transport = HttpTransport(api_base_url, binding_id, api_token)
        try:
            status = await transport.get_binding_status()
        except TransportError:
            await transport.close()
            raise SystemExit("Could not read Vibee binding status; Telegram polling was not started.") from None
        if isinstance(status, dict):
            await transport.close()
            raise SystemExit("Vibee binding status request was rejected; Telegram polling was not started.")
        intake = TelegramIntake(ConsentSnapshot(
            chat_id=chat_id,
            binding_id=binding_id,
            revision=status.revision,
            roster_version=status.rosterVersion,
            active=status.phase == "active",
            roster=frozenset(),
            accepted_members=frozenset(),
            policy_version=status.policyVersion,
            consent_policy_version=status.policyVersion,
            roster_verified=True,
            company_accepted=True,
        ), transport)
    dispatcher, flow = create_dispatcher(intake)

    async def cleanup():
        while True:
            await asyncio.sleep(15)
            flow.expire()

    task = asyncio.create_task(cleanup())
    try:
        async with Bot(token=token) as bot:
            await dispatcher.start_polling(bot, allowed_updates=dispatcher.resolve_used_update_types(), handle_signals=True)
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
        flow.drafts.clear()
        if transport is not None:
            await transport.close()


if __name__ == "__main__":
    asyncio.run(main())
