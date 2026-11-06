"""Telegram polling entry point with optional Vibee HTTP delivery."""
import asyncio
from contextlib import suppress
import os
import sys
import logging
from hashlib import sha256
from datetime import timezone
from pathlib import Path

from aiogram import Bot, Dispatcher, F
from aiogram.filters import Command, CommandStart
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

from .flow import CheckinFlow, QUESTIONS
from .http_transport import HttpTransport, OrganizerRequiredError, PausedError, TransportError
from .intake import ConsentSnapshot, TelegramIntake
from .pause_state import PauseState
from .voice import LocalWhisperProvider, VoiceError, VoiceTranscription, install_voice_handlers


def create_dispatcher(
    intake: TelegramIntake | None = None,
    voice: VoiceTranscription | None = None,
    notification_transport: HttpTransport | None = None,
    checkin_transport: HttpTransport | None = None,
) -> Dispatcher:
    dispatcher = Dispatcher()
    flow = CheckinFlow()
    voice_transcription = voice
    install_voice_handlers(dispatcher, voice_transcription)

    def menu_keyboard():
        rows = [[InlineKeyboardButton(text="Пройти личный чек-ин", callback_data="menu:checkin")]]
        if voice_transcription is not None:
            rows.append([InlineKeyboardButton(text="Расшифровать голосовое", callback_data="menu:voice")])
        return InlineKeyboardMarkup(inline_keyboard=rows)

    async def question(message, nonce, step):
        keyboard = InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(text=str(n), callback_data=f"score:{nonce}:{step}:{n}")
            for n in range(1, 6)
        ]])
        await message.answer(
            f"{step + 1}/3 · {QUESTIONS[step][1]}\n"
            "1 — мало, 5 — много. Отмена: /stop.",
            reply_markup=keyboard,
        )

    @dispatcher.message(CommandStart())
    async def start(message: Message):
        if message.chat.type != "private":
            await message.answer(
                "Vibee не собирает сообщения из групп в этом запуске. "
                "Откройте личный диалог, чтобы посмотреть доступные сценарии."
            )
            return
        if message.from_user is None or message.from_user.is_bot:
            return
        flow.cancel(message.from_user.id)
        await message.answer(
            "Привет! Я Vibee 🐝\nВыберите сценарий. О данных — /privacy.",
            reply_markup=menu_keyboard(),
        )

    @dispatcher.message(Command("help"))
    async def help_command(message: Message):
        lines = [
            "Команды Vibee:",
            "/start — меню сценариев",
            "/help — эта справка",
            "/privacy — что обрабатывается и где хранится",
            "/stop — отменить текущий чек-ин или расшифровку",
        ]
        if voice_transcription is not None:
            lines.append("/transcribe — запросить расшифровку одной личной голосовой")
        else:
            lines.append("Расшифровка голосовых сейчас недоступна: локальная модель не настроена.")
        if notification_transport is not None:
            lines.append("/subscribe — запросить уведомления; только для связанного организатора, сервер проверит права и доставку.")
        else:
            lines.append("Уведомления недоступны: серверное подключение не настроено.")
        lines.append("Групповой сбор не запускается из меню; стандартный сервер его не включает.")
        await message.answer("\n".join(lines))

    @dispatcher.message(Command("privacy"))
    async def privacy(message: Message):
        if checkin_transport is not None:
            checkin_note = (
                "• Личный чек-ин — три оценки. Согласие спрашивается до вопросов. "
                "Черновик хранится в памяти до 5 минут и очищается при завершении или /stop. "
                "После завершения три оценки отправляются на сервер; Telegram ID используется, "
                "чтобы проверить участие, поэтому полной анонимности нет. Организатор видит "
                "только общую сводку, когда ответов достаточно. /stop очищает локальный черновик, "
                "но не удаляет уже переданные данные и историю Telegram.\n"
            )
        else:
            checkin_note = (
                "• Личный чек-ин — три оценки. Согласие спрашивается до вопросов. "
                "Черновик хранится в памяти до 5 минут и очищается при завершении или /stop. "
                "Ответы остаются в личном сценарии и не отправляются на сервер или в командный кабинет. "
                "/stop очищает локальный черновик, но не удаляет историю Telegram.\n"
            )
        await message.answer(
            "Коротко о данных в этом боте:\n"
            + checkin_note
            + "• Голосовая расшифровывается только после отдельного согласия на одну новую запись "
            "и только локальной моделью. Аудио и текст не записываются ботом в файл или БД; "
            "результат отправляется только в этот личный чат и остаётся в Telegram.\n"
            "• Личные сценарии не анализируют групповые сообщения. Отдельный групповой контур "
            "требует серверной настройки и согласия компании и каждого участника."
        )

    @dispatcher.callback_query(F.data == "menu:checkin")
    async def select_checkin(event: CallbackQuery):
        message = event.message
        if (message is None or getattr(getattr(message, "chat", None), "type", None) != "private"
                or event.from_user.is_bot or not callable(getattr(message, "answer", None))):
            await event.answer("Личный чек-ин доступен только в личном чате.", show_alert=True)
            return
        user_id = event.from_user.id
        flow.expire()
        if user_id in flow.drafts:
            await event.answer("Чек-ин уже открыт. Продолжите по последним кнопкам или нажмите /stop.", show_alert=True)
            return
        nonce = flow.begin(user_id)
        await event.answer()
        keyboard = InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(text="Согласен", callback_data=f"consent:{nonce}:yes"),
            InlineKeyboardButton(text="Отказаться", callback_data=f"consent:{nonce}:no"),
        ]])
        await message.answer(
            "Чек-ин: три оценки от 1 до 5. Нужно ваше согласие.\n"
            "Черновик хранится в памяти до 5 минут и удаляется при завершении или /stop. "
            + (
                "После завершения три оценки уходят на сервер; Telegram ID нужен, "
                "чтобы проверить участие. Организатор получает общую сводку, когда ответов "
                "достаточно. /stop не удаляет уже переданные данные."
                if checkin_transport is not None else
                "Ответы остаются в личном сценарии и не отправляются в командный кабинет."
            ),
            reply_markup=keyboard,
        )

    @dispatcher.message(Command("stop"))
    async def stop(message: Message):
        if message.chat.type != "private" or message.from_user is None:
            return
        flow.cancel(message.from_user.id)
        if voice_transcription is not None:
            voice_transcription.cancel(message.from_user.id)
        await message.answer(
            "Текущий сценарий отменён. Черновик и разрешение на расшифровку очищены; "
            "обработка остановлена. "
            + (
                "Уже переданные на сервер ответы не удаляются; сообщения в Telegram бот тоже не удаляет."
                if checkin_transport is not None else
                "Сообщения в Telegram бот не удаляет."
            )
        )

    @dispatcher.message(Command("subscribe"))
    async def subscribe(message: Message):
        if (message.chat.type != "private" or message.from_user is None
                or message.from_user.is_bot or message.chat.id != message.from_user.id):
            return
        if notification_transport is None:
            await message.answer("Уведомления не настроены в этом запуске; подписка недоступна.")
            return
        try:
            result = await notification_transport.subscribe_notifications(message.from_user.id)
        except OrganizerRequiredError:
            await message.answer("Подписаться может только организатор, чей Telegram-аккаунт связан с этой командой.")
            return
        except TransportError:
            await message.answer("Не удалось включить уведомления. Проверьте подключение бота и настройки сервера.")
            return
        if result.get("notificationsEnabled") is True:
            await message.answer("Подписка включена. Уведомления о закрытых опубликованных периодах будут приходить сюда.")
        else:
            await message.answer(
                "Подписка сохранена, но серверная отправка уведомлений выключена. "
                "Администратору нужно настроить доставку на сервере."
            )

    async def submit_intake_text(message: Message, text: str) -> None:
        if intake is None or message.chat.type == "private" or message.from_user is None:
            return
        update = {
            "update_type": "message",
            "message": {
                "chat": {"id": message.chat.id},
                "from": {"id": message.from_user.id, "is_bot": message.from_user.is_bot},
                "message_id": message.message_id,
                "date": int((message.date.replace(tzinfo=timezone.utc) if message.date.tzinfo is None else message.date.astimezone(timezone.utc)).timestamp()),
                "text": text,
            },
        }
        try:
            await intake.process(update)
        except TransportError:
            intake.stop_after_transport_gap()
            await intake.reconcile_pause()
            logging.getLogger(__name__).warning("Telegram intake paused after delivery failure; pause the binding on the server before resuming")

    @dispatcher.message(F.text)
    async def intake_message(message: Message) -> None:
        if message.text is not None:
            await submit_intake_text(message, message.text)

    @dispatcher.message(F.voice)
    async def voice_intake_message(message: Message) -> None:
        if (
            intake is None
            or message.chat.type not in {"group", "supergroup"}
            or message.from_user is None
            or message.from_user.is_bot
            or not intake.is_active_chat(message.chat.id)
        ):
            return
        if message.forward_origin is not None:
            await message.answer("В этом режиме принимаются только новые, непересланные голосовые.")
            return
        if voice is None:
            await message.answer("Локальная расшифровка голосовых не настроена.")
            return
        if intake.is_rate_limited(message.from_user.id):
            return

        sent_at = int(
            (message.date.replace(tzinfo=timezone.utc) if message.date.tzinfo is None
             else message.date.astimezone(timezone.utc)).timestamp()
        )
        try:
            text = await voice.transcribe_for_intake(
                user_id=message.from_user.id,
                sent_at=sent_at,
                voice=message.voice,
                download=lambda destination: message.bot.download(
                    message.voice, destination=destination, timeout=15,
                ),
            )
            if text is not None:
                await submit_intake_text(message, text)
        except VoiceError as error:
            await message.answer(str(error), parse_mode=None)

    @dispatcher.edited_message()
    async def intake_edit(message: Message) -> None:
        if intake is None or message.chat.type == "private":
            return
        if intake.stop_after_message_edit(message.chat.id):
            await intake.reconcile_pause()

    @dispatcher.callback_query(F.data.startswith("consent:") | F.data.startswith("score:"))
    async def callback(event: CallbackQuery):
        message = event.message
        if (message is None or getattr(getattr(message, "chat", None), "type", None) != "private"
                or event.from_user.is_bot or not callable(getattr(message, "answer", None))):
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
                    await question(message, parts[1], 0)
                else:
                    await message.answer("Отказ принят. Черновик удалён. Меню — /start.")
            elif parts[0] == "score" and len(parts) == 4:
                step = int(parts[2])
                result = flow.answer(event.from_user.id, parts[1], step, int(parts[3]))
                await event.answer()
                if result is not None:
                    if checkin_transport is not None:
                        try:
                            await checkin_transport.submit_personal_checkin(
                                event.from_user.id, result, parts[1],
                            )
                            await message.answer(
                                "Спасибо, чек-ин завершён. Три оценки переданы на сервер; "
                                "организатор увидит общую сводку, когда ответов достаточно. Меню — /start."
                            )
                        except PausedError:
                            await message.answer(
                                "Чек-ин завершён, но сервер отклонил передачу. "
                                "Проверьте, что вы участник команды, или обратитесь к организатору. Меню — /start."
                            )
                        except TransportError:
                            await message.answer(
                                "Чек-ин завершён, но подтвердить передачу на сервер не удалось. "
                                "Ответы могли не сохраниться; попробуйте позже или обратитесь к организатору. "
                                "Меню — /start."
                            )
                    else:
                        await message.answer(
                            "Спасибо, личный демо-чек-ин завершён. Черновик очищен из памяти; "
                            "ответы не отправлялись на сервер или в командный кабинет. Меню — /start."
                        )
                else:
                    await question(message, parts[1], step + 1)
            else:
                raise ValueError("Неверная кнопка")
        except ValueError as error:
            public_errors = {
                "Этот чек-ин истёк. Начните заново: /start": "Этот чек-ин истёк. Откройте /start и начните заново.",
                "Выбор уже обработан": "Этот выбор уже обработан. Откройте /start для нового сценария.",
                "Эта кнопка устарела. Ответьте на текущий вопрос.": "Кнопка устарела. Откройте /start и начните заново.",
                "Выберите целую оценку от 1 до 5": "Выберите целую оценку от 1 до 5.",
                "Неверный выбор": "Выберите один из вариантов кнопками.",
            }
            public_message = public_errors.get(
                str(error), "Не удалось обработать выбор. Откройте /start и попробуйте снова."
            )
            await event.answer(public_message, show_alert=True)

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
    model_dir = os.environ.get("VIBEE_TRANSCRIPTION_MODEL_DIR")
    if any((api_token, binding_id, chat_id_raw)) and not all((api_token, binding_id, chat_id_raw)):
        raise SystemExit("Set VIBEE_BOT_TOKEN, VIBEE_BINDING_ID and VIBEE_CHAT_ID together.")

    transport: HttpTransport | None = None
    intake: TelegramIntake | None = None
    voice_transcription: VoiceTranscription | None = None
    if model_dir:
        try:
            voice_transcription = VoiceTranscription(LocalWhisperProvider(model_dir))
        except ValueError as error:
            raise SystemExit(str(error)) from None

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
        pause_path = Path(os.environ.get("VIBEBOT_DATA_DIR", ".data")) / ("bot-gap-" + sha256(binding_id.encode()).hexdigest() + ".json")
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
        ), transport, PauseState(pause_path))
        await intake.reconcile_pause()
    dispatcher, flow = create_dispatcher(intake, voice_transcription, transport, transport)

    async def cleanup():
        while True:
            await asyncio.sleep(15)
            flow.expire()
            if voice_transcription is not None:
                voice_transcription.expire()
            if intake is not None:
                await intake.reconcile_pause()

    task = asyncio.create_task(cleanup())
    try:
        async with Bot(token=token) as bot:
            print("Vibee: запускаю подключение к Telegram. Для проверки отправьте /start.", flush=True)
            await dispatcher.start_polling(bot, allowed_updates=dispatcher.resolve_used_update_types(), handle_signals=True)
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
        flow.drafts.clear()
        if voice_transcription is not None:
            await voice_transcription.close()
        if transport is not None:
            await transport.close()


if __name__ == "__main__":
    asyncio.run(main())
