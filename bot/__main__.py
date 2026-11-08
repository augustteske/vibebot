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
from aiogram.fsm.context import FSMContext
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.methods import SendMessage, SendPhoto
from aiogram.types import BotCommand, CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

from . import i18n
from .cleanup import SentMessageJournal, delete_recent_messages
from .flow import CheckinFlow, QUESTION_KEYS
from .http_transport import HttpTransport, OrganizerRequiredError, PausedError, TransportError
from .intake import ConsentSnapshot, TelegramIntake
from .pause_state import PauseState
from .question_images import DEFAULT_IMAGE_DIR, QuestionImageCache, send_question_image
from .voice import LocalWhisperProvider, VoiceError, VoiceTranscription, install_voice_handlers


# Список команд для синего меню Telegram; тексты согласованы с bot/BRANDING.md.
# Меню общее для всех чатов, поэтому подписи русские; сами ответы — на выбранном языке.
BOT_COMMANDS = [
    BotCommand(command="start", description="Открыть меню сценариев"),
    BotCommand(command="help", description="Доступные команды и сценарии"),
    BotCommand(command="privacy", description="Как бот обрабатывает данные"),
    BotCommand(command="stop", description="Отменить сценарий и очистить черновик"),
    BotCommand(command="clean", description="Удалить сообщения бота в этом чате"),
    BotCommand(command="lang", description="Язык / Language: ru, en"),
    BotCommand(command="transcribe", description="Согласие на одну голосовую (нужна локальная модель)"),
    BotCommand(command="subscribe", description="Уведомления организатора (если настроены)"),
]

CLEAN_DONE = i18n.text(i18n.RU, "clean.done")
CLEAN_EMPTY = i18n.text(i18n.RU, "clean.empty")
CLEAN_PARTIAL = i18n.text(i18n.RU, "clean.partial")

# Русские тексты ошибок из CheckinFlow -> ключи локализации.
ERROR_KEYS = {
    "Этот чек-ин истёк. Начните заново: /start": "error.expired",
    "Выбор уже обработан": "error.processed",
    "Эта кнопка устарела. Ответьте на текущий вопрос.": "error.stale",
    "Выберите целую оценку от 1 до 5": "error.score_range",
    "Неверный выбор": "error.choice",
}


class JournalBot(Bot):
    """Bot that remembers IDs of its private messages so /clean can delete them."""

    def __init__(self, *args, journal: SentMessageJournal, **kwargs):
        super().__init__(*args, **kwargs)
        self.journal = journal

    async def __call__(self, method, request_timeout=None):
        result = await super().__call__(method, request_timeout=request_timeout)
        if (
            isinstance(method, (SendMessage, SendPhoto))
            and isinstance(result, Message)
            and result.chat.type == "private"
        ):
            self.journal.record(result.chat.id, result.message_id)
        return result


def create_dispatcher(
    intake: TelegramIntake | None = None,
    voice: VoiceTranscription | None = None,
    notification_transport: HttpTransport | None = None,
    checkin_transport: HttpTransport | None = None,
    message_log: SentMessageJournal | None = None,
    question_images: QuestionImageCache | None = None,
    question_images_dir: Path | None = None,
) -> Dispatcher:
    dispatcher = Dispatcher(storage=MemoryStorage())
    flow = CheckinFlow()
    voice_transcription = voice
    journal = message_log if message_log is not None else SentMessageJournal()
    install_voice_handlers(dispatcher, voice_transcription)

    async def language_of(state: FSMContext | None) -> str:
        if state is None:
            return i18n.DEFAULT_LANGUAGE
        data = await state.get_data()
        return i18n.normalize_language(data.get("lang")) or i18n.DEFAULT_LANGUAGE

    async def remember_language(state: FSMContext | None, language: str) -> None:
        if state is not None:
            await state.update_data(lang=language)

    def menu_keyboard(language: str):
        rows = [[InlineKeyboardButton(
            text=i18n.text(language, "menu.checkin"), callback_data="menu:checkin",
        )]]
        if voice_transcription is not None:
            rows.append([InlineKeyboardButton(
                text=i18n.text(language, "menu.voice"), callback_data="menu:voice",
            )])
        return InlineKeyboardMarkup(inline_keyboard=rows)

    def language_keyboard(language: str):
        def label(code: str, name: str) -> str:
            return f"{name} ✓" if language == code else name

        return InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(text=label(i18n.RU, "Русский"), callback_data=f"lang:{i18n.RU}"),
            InlineKeyboardButton(text=label(i18n.EN, "English"), callback_data=f"lang:{i18n.EN}"),
        ]])

    async def question(message, nonce, step, language):
        key = QUESTION_KEYS[step]
        keyboard = InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(text=str(n), callback_data=f"score:{nonce}:{step}:{n}")
            for n in range(1, 6)
        ]])
        await send_question_image(
            message, key, question_images,
            question_images_dir or DEFAULT_IMAGE_DIR,
        )
        await message.answer(
            i18n.text(
                language, "question.ask",
                index=step + 1, total=len(QUESTION_KEYS),
                question=i18n.question(language, key),
            ),
            reply_markup=keyboard,
        )

    @dispatcher.message(CommandStart())
    async def start(message: Message, state: FSMContext | None = None):
        language = await language_of(state)
        if message.chat.type != "private":
            await message.answer(i18n.text(
                language, "start.group.intake" if intake is not None else "start.group.no_intake",
            ))
            return
        if message.from_user is None or message.from_user.is_bot:
            return
        flow.cancel(message.from_user.id)
        await message.answer(
            i18n.text(language, "start.private"),
            reply_markup=menu_keyboard(language),
        )

    @dispatcher.message(Command("help"))
    async def help_command(message: Message, state: FSMContext | None = None):
        language = await language_of(state)
        await message.answer(i18n.help_text(
            language,
            voice_available=voice_transcription is not None,
            notifications_available=notification_transport is not None,
        ))

    @dispatcher.message(Command("privacy"))
    async def privacy(message: Message, state: FSMContext | None = None):
        language = await language_of(state)
        await message.answer(i18n.privacy_text(language, checkin_transport is not None))

    @dispatcher.message(Command("lang"))
    async def language_command(message: Message, state: FSMContext | None = None):
        if message.chat.type != "private" or message.from_user is None or message.from_user.is_bot:
            return
        parts = (message.text or "").split(maxsplit=1)
        requested = parts[1].strip() if len(parts) > 1 else ""
        if not requested:
            language = await language_of(state)
            await message.answer(
                i18n.text(language, "lang.current", name=i18n.language_name(language))
                + "\n" + i18n.text(language, "lang.usage"),
                reply_markup=language_keyboard(language),
            )
            return
        language = i18n.normalize_language(requested)
        if language is None:
            current = await language_of(state)
            await message.answer(
                i18n.text(current, "lang.invalid"),
                reply_markup=language_keyboard(current),
            )
            return
        await remember_language(state, language)
        await message.answer(
            i18n.text(language, "lang.saved"),
            reply_markup=language_keyboard(language),
        )

    @dispatcher.callback_query(F.data.startswith("lang:"))
    async def language_callback(event: CallbackQuery, state: FSMContext | None = None):
        current = await language_of(state)
        language = i18n.normalize_language(event.data.split(":", 1)[1])
        if language is None:
            await event.answer(i18n.text(current, "lang.invalid"), show_alert=True)
            return
        await remember_language(state, language)
        await event.answer()
        message = event.message
        if message is not None and callable(getattr(message, "answer", None)):
            await message.answer(
                i18n.text(language, "lang.saved"),
                reply_markup=language_keyboard(language),
            )

    @dispatcher.callback_query(F.data == "menu:checkin")
    async def select_checkin(event: CallbackQuery, state: FSMContext | None = None):
        language = await language_of(state)
        message = event.message
        if (message is None or getattr(getattr(message, "chat", None), "type", None) != "private"
                or event.from_user.is_bot or not callable(getattr(message, "answer", None))):
            await event.answer(i18n.text(language, "alert.checkin_private_only"), show_alert=True)
            return
        user_id = event.from_user.id
        flow.expire()
        if user_id in flow.drafts:
            await event.answer(i18n.text(language, "alert.checkin_open"), show_alert=True)
            return
        nonce = flow.begin(user_id)
        await event.answer()
        keyboard = InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(text=i18n.text(language, "consent.yes"), callback_data=f"consent:{nonce}:yes"),
            InlineKeyboardButton(text=i18n.text(language, "consent.no"), callback_data=f"consent:{nonce}:no"),
        ]])
        await message.answer(
            i18n.consent_text(language, checkin_transport is not None),
            reply_markup=keyboard,
        )

    @dispatcher.message(Command("stop"))
    async def stop(message: Message, state: FSMContext | None = None):
        if message.chat.type != "private" or message.from_user is None:
            return
        language = await language_of(state)
        flow.cancel(message.from_user.id)
        if voice_transcription is not None:
            voice_transcription.cancel(message.from_user.id)
        await message.answer(i18n.text(
            language, "stop.with_transport" if checkin_transport is not None else "stop.without_transport",
        ))

    @dispatcher.message(Command("clean"))
    async def clean_command(message: Message, state: FSMContext | None = None):
        language = await language_of(state)
        if message.chat.type != "private":
            await message.answer(i18n.text(language, "clean.private_only"))
            return
        if message.from_user is None or message.from_user.is_bot:
            return
        flow.cancel(message.from_user.id)
        if voice_transcription is not None:
            voice_transcription.cancel(message.from_user.id)
        deleted, complete = await delete_recent_messages(message.bot, journal, message.chat.id)
        if not complete:
            await message.answer(i18n.text(language, "clean.partial"))
        elif deleted:
            await message.answer(i18n.text(language, "clean.done"))
        else:
            await message.answer(i18n.text(language, "clean.empty"))

    @dispatcher.message(Command("subscribe"))
    async def subscribe(message: Message, state: FSMContext | None = None):
        if (message.chat.type != "private" or message.from_user is None
                or message.from_user.is_bot or message.chat.id != message.from_user.id):
            return
        language = await language_of(state)
        if notification_transport is None:
            await message.answer(i18n.text(language, "subscribe.no_config"))
            return
        try:
            result = await notification_transport.subscribe_notifications(message.from_user.id)
        except OrganizerRequiredError:
            await message.answer(i18n.text(language, "subscribe.organizer_only"))
            return
        except TransportError:
            await message.answer(i18n.text(language, "subscribe.error"))
            return
        if result.get("notificationsEnabled") is True:
            await message.answer(i18n.text(language, "subscribe.enabled"))
        else:
            await message.answer(i18n.text(language, "subscribe.disabled"))

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
    async def callback(event: CallbackQuery, state: FSMContext | None = None):
        language = await language_of(state)
        message = event.message
        if (message is None or getattr(getattr(message, "chat", None), "type", None) != "private"
                or event.from_user.is_bot or not callable(getattr(message, "answer", None))):
            await event.answer(i18n.text(language, "alert.checkin_private"))
            return
        try:
            parts = event.data.split(":")
            if parts[0] == "consent" and len(parts) == 3:
                if parts[2] not in ("yes", "no"):
                    raise ValueError("Неверный выбор")
                accepted = flow.consent(event.from_user.id, parts[1], parts[2] == "yes")
                await event.answer()
                if accepted:
                    await question(message, parts[1], 0, language)
                else:
                    await message.answer(i18n.text(language, "consent.declined"))
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
                            await message.answer(i18n.text(language, "checkin.done.server"))
                        except PausedError:
                            await message.answer(i18n.text(language, "checkin.done.paused"))
                        except TransportError:
                            await message.answer(i18n.text(language, "checkin.done.unknown"))
                    else:
                        await message.answer(i18n.text(language, "checkin.done.demo"))
                else:
                    await question(message, parts[1], step + 1, language)
            else:
                raise ValueError("Неверная кнопка")
        except ValueError as error:
            public_message = i18n.text(language, ERROR_KEYS.get(str(error), "error.generic"))
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
    data_dir = Path(os.environ.get("VIBEBOT_DATA_DIR", ".data"))
    suffix = sha256((binding_id or "default").encode()).hexdigest()
    journal_name = "bot-clean-" + suffix + ".json"
    message_log = SentMessageJournal(data_dir / journal_name)
    question_image_cache = QuestionImageCache(data_dir / ("bot-question-images-" + suffix + ".json"))

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
        pause_path = data_dir / ("bot-gap-" + sha256(binding_id.encode()).hexdigest() + ".json")
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
    dispatcher, flow = create_dispatcher(
        intake=intake,
        voice=voice_transcription,
        notification_transport=transport,
        checkin_transport=transport,
        message_log=message_log,
        question_images=question_image_cache,
    )

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
        async with JournalBot(token=token, journal=message_log) as bot:
            print("Vibee: запускаю подключение к Telegram. Для проверки отправьте /start.", flush=True)
            try:
                await bot.set_my_commands(BOT_COMMANDS)
            except Exception as error:
                # Меню команд не критично для работы бота: сообщаем и продолжаем опрос.
                logging.getLogger(__name__).warning("Не удалось обновить меню команд Telegram: %s", error)
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
