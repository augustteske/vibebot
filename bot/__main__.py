# Copyright (c) 2026 Vibee Team. MIT License.
"""Telegram polling entry point with optional Vibee HTTP delivery."""
import asyncio
from contextlib import suppress
import os
import re
import sys
import logging
from hashlib import sha256
from datetime import timezone
from pathlib import Path
from math import isfinite
from time import monotonic

from aiogram import Bot, Dispatcher, F
from aiogram.exceptions import TelegramAPIError
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.methods import SendMessage, SendPhoto
from aiogram.types import BotCommand, BufferedInputFile, CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

from . import i18n, styles
from .cleanup import SentMessageJournal, delete_recent_messages
from .flow import CheckinFlow, QUESTION_KEYS
from .http_transport import HttpTransport, OrganizerRequiredError, PausedError, TransportError
from .intake import ConsentSnapshot, TelegramIntake
from .pause_state import PauseState
from .question_images import DEFAULT_IMAGE_DIR, QuestionImageCache, send_question_image
from .scheduler import CheckinHistoryJournal, CheckinReminderScheduler
from .voice import LocalWhisperProvider, VoiceError, VoiceTranscription, install_voice_handlers


# Список команд для синего меню Telegram; тексты согласованы с bot/BRANDING.md.
# Меню общее для всех чатов, поэтому подписи русские; сами ответы — на выбранном языке.
BOT_COMMANDS = [
    BotCommand(command="start", description="Открыть меню сценариев"),
    BotCommand(command="menu", description="Быстрое меню действий"),
    BotCommand(command="help", description="Доступные команды и сценарии"),
    BotCommand(command="guide", description="Инструкция по подключению Vibee"),
    BotCommand(command="privacy", description="Как бот обрабатывает данные"),
    BotCommand(command="stop", description="Отменить сценарий и очистить черновик"),
    BotCommand(command="clean", description="Удалить сообщения бота в этом чате"),
    BotCommand(command="lang", description="Язык / Language: ru, en"),
    BotCommand(command="style", description="Режим общения: классик, ми-ми-ми, правдарубка"),
    BotCommand(command="stats", description="Статистика команды (для организатора)"),
    BotCommand(command="share", description="Карточка «Пульс команды» (для организатора)"),
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

# Сколько держать завершённый чек-ин в памяти для кнопки «Повторить».
RETRY_TTL_SECONDS = 300
STATS_BAR_CELLS = 10
SHARE_CARD_FILE_NAME = "vibee-team-pulse.png"
# Кнопка на карточке: отправить её же в связанный групповой чат.
GROUP_SHARE_CALLBACK = "share:group"
# Статусы участника чата, при которых бот точно может писать сообщения.
GROUP_POST_STATUSES = frozenset({"creator", "administrator", "member"})


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
    stats_transport: HttpTransport | None = None,
    share_transport: HttpTransport | None = None,
    group_chat_id: int | None = None,
    message_log: SentMessageJournal | None = None,
    question_images: QuestionImageCache | None = None,
    question_images_dir: Path | None = None,
    checkin_history: CheckinHistoryJournal | None = None,
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

    async def style_of(state: FSMContext | None) -> str:
        if state is None:
            return styles.DEFAULT_STYLE
        data = await state.get_data()
        return styles.normalize_style(data.get("style")) or styles.DEFAULT_STYLE

    async def remember_style(state: FSMContext | None, style: str) -> None:
        if state is not None:
            await state.update_data(style=style)

    def chat_style(style: str, message) -> str:
        """Режим для конкретного чата: в группах всегда классик."""
        return styles.for_chat(style, getattr(getattr(message, "chat", None), "type", None))

    def menu_keyboard(language: str):
        rows = [
            [InlineKeyboardButton(
                text=i18n.text(language, "menu.checkin"), callback_data="menu:checkin",
            )],
            [InlineKeyboardButton(
                text=i18n.text(language, "menu.stats"), callback_data="menu:stats",
            )],
            [InlineKeyboardButton(
                text=i18n.text(language, "menu.leader_message"), callback_data="menu:leader_message",
            )],
            [InlineKeyboardButton(
                text=i18n.text(language, "menu.guide"), callback_data="menu:guide",
            )],
            [InlineKeyboardButton(
                text=i18n.text(language, "menu.settings"), callback_data="menu:settings",
            )],
        ]
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

    def style_keyboard(language: str, current: str):
        def label(code: str) -> str:
            name = i18n.style_name(language, code)
            return f"{name} ✓" if current == code else name

        return InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(text=label(code), callback_data=f"style:{code}")
            for code in styles.STYLES
        ]])

    # Завершённые чек-ины, доставку которых не удалось подтвердить:
    # nonce -> (Telegram ID, оценки, срок хранения для кнопки «Повторить»).
    pending_checkins: dict[str, tuple[int, dict[str, int], float]] = {}
    pending_leader_messages: dict[int, dict[str, object]] = {}

    def remember_pending_checkin(nonce: str, user_id: int, scores: dict[str, int]) -> None:
        now = monotonic()
        for key in list(pending_checkins):
            if pending_checkins[key][2] <= now:
                pending_checkins.pop(key, None)
        pending_checkins[nonce] = (user_id, dict(scores), now + RETRY_TTL_SECONDS)

    def take_pending_checkin(nonce: str, user_id: int) -> dict[str, int] | None:
        entry = pending_checkins.get(nonce)
        if entry is None:
            return None
        owner, scores, expires = entry
        if owner != user_id or expires <= monotonic():
            pending_checkins.pop(nonce, None)
            return None
        return scores

    def retry_keyboard(language: str, action: str):
        return InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(
            text=i18n.text(language, "button.retry"), callback_data=f"retry:{action}",
        )]])

    def percent_of(value: object) -> float | None:
        """Процент из ответа сервера; всё вне 0–100 и нечисло — ``None``."""
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return None
        number = float(value)
        if not isfinite(number):
            return None
        return min(100.0, max(0.0, number))

    def percent_text(value: float) -> str:
        """Процент без лишнего нуля: 25.0 → «25», 89.8 → «89.8»."""
        rounded = round(value, 1)
        return str(int(rounded)) if rounded == int(rounded) else f"{rounded:.1f}"

    def progress_bar(value: float) -> str:
        filled = int(value / 100 * STATS_BAR_CELLS + 0.5)
        return "█" * filled + "░" * (STATS_BAR_CELLS - filled)

    def stats_message(language: str, style: str, view: dict[str, object]) -> str | None:
        """Красивая сводка трёх метрик; ``None`` — сервер прислал неполные данные."""
        metrics = view.get("metrics")
        if not isinstance(metrics, dict):
            return None
        values = [
            percent_of(metrics.get("outsideHoursPercent")),
            percent_of(metrics.get("participationEvenness")),
            percent_of(metrics.get("recognitionPercent")),
        ]
        if any(value is None for value in values):
            return None
        keys = ("stats.outside_hours", "stats.participation", "stats.recognition")
        lines = [i18n.styled_text(language, style, "stats.header"), ""]
        for key, value in zip(keys, values):
            lines.append(i18n.text(language, key, value=percent_text(value)))
            lines.append(progress_bar(value))
        return "\n".join(lines)

    async def deliver_stats(message, user_id: int, language: str, style: str) -> None:
        """Показывает статистику команды; при сетевой ошибке даёт кнопку «Повторить»."""
        if stats_transport is None:
            await message.answer(i18n.text(language, "stats.no_connection"))
            return
        try:
            view = await stats_transport.get_summary(telegram_user_id=user_id)
        except OrganizerRequiredError:
            await message.answer(i18n.styled_text(language, style, "stats.organizer_only"))
            return
        except TransportError:
            await message.answer(
                i18n.text(language, "error.network"),
                reply_markup=retry_keyboard(language, "stats"),
            )
            return
        status = view.get("status")
        if status in ("calibrating", "insufficient"):
            await message.answer(i18n.styled_text(language, style, "stats.insufficient"))
            return
        if status != "published":
            await message.answer(i18n.styled_text(language, style, "stats.unavailable"))
            return
        text = stats_message(language, style, view)
        if text is None:
            await message.answer(i18n.text(language, "stats.error"))
            return
        report_url = getattr(stats_transport, "web_url", "")
        keyboard = None
        if isinstance(report_url, str) and report_url:
            keyboard = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(
                text=i18n.text(language, "stats.report"), url=report_url,
            )]])
        await message.answer(text, reply_markup=keyboard)

    def share_caption(language: str, card, url: str) -> str:
        """Подпись к карточке: название команды, период и ссылка на Vibee."""
        period = card.period_label or i18n.text(language, "share.period_fallback")
        if card.team_name:
            return i18n.text(language, "share.caption", team=card.team_name, period=period, url=url)
        return i18n.text(language, "share.caption_no_name", period=period, url=url)

    async def deliver_share(message, user_id: int, language: str) -> None:
        """Отправляет карточку «Пульс команды» связанному организатору."""
        if share_transport is None:
            await message.answer(i18n.text(language, "share.no_connection"))
            return
        try:
            view = await share_transport.get_summary(telegram_user_id=user_id)
        except OrganizerRequiredError:
            await message.answer(i18n.text(language, "share.organizer_only"))
            return
        except TransportError:
            await message.answer(
                i18n.text(language, "error.network"),
                reply_markup=retry_keyboard(language, "share"),
            )
            return
        status = view.get("status")
        if status in ("calibrating", "insufficient", "open"):
            await message.answer(i18n.text(language, "share.no_period"))
            return
        if status != "published":
            await message.answer(i18n.text(language, "share.unavailable"))
            return
        try:
            card = await share_transport.get_share_card(user_id)
        except OrganizerRequiredError:
            await message.answer(i18n.text(language, "share.organizer_only"))
            return
        except TransportError:
            await message.answer(
                i18n.text(language, "error.network"),
                reply_markup=retry_keyboard(language, "share"),
            )
            return
        await message.answer_photo(
            BufferedInputFile(card.image, filename=SHARE_CARD_FILE_NAME),
            caption=share_caption(language, card, share_transport.web_url),
            reply_markup=group_share_keyboard(language),
        )

    def group_caption(language: str, card, url: str) -> str:
        """Подпись к карточке в общем чате: только итоги периода, без личных данных."""
        period = card.period_label or i18n.text(language, "share.period_fallback")
        if card.team_name:
            return i18n.text(language, "share.group_caption", team=card.team_name, period=period, url=url)
        return i18n.text(language, "share.group_caption_no_name", period=period, url=url)

    def group_share_keyboard(language: str) -> InlineKeyboardMarkup | None:
        """Кнопка «Отправить в группу»; без связанного чата кнопки нет."""
        if group_chat_id is None:
            return None
        return InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(
            text=i18n.text(language, "share.group_button"), callback_data=GROUP_SHARE_CALLBACK,
        )]])

    async def group_share_block_reason() -> str | None:
        """Почему карточку нельзя отправить в чат команды; None — можно."""
        if group_chat_id is None:
            return "share.group_no_chat"
        if intake is None or share_transport is None:
            return "share.no_connection"
        try:
            status = await intake.get_binding_status()
        except TransportError:
            return "share.group_failed"
        if isinstance(status, dict) or status.phase != "active" or not intake.is_active_chat(group_chat_id):
            return "share.group_paused"
        return None

    async def bot_can_post_to_group(bot, chat_id: int) -> bool:
        """Проверяет, что бот состоит в чате и ему разрешено писать сообщения."""
        try:
            member = await bot.get_chat_member(chat_id=chat_id, user_id=bot.id)
        except TelegramAPIError:
            return False
        status = getattr(member, "status", "")
        status = getattr(status, "value", status)
        if status in GROUP_POST_STATUSES:
            return True
        return status == "restricted" and getattr(member, "can_send_messages", False) is True

    async def submit_checkin(
        message, user_id: int, scores: dict[str, int], nonce: str, language: str, style: str,
    ) -> None:
        """Отправляет оценки на сервер; при сетевой ошибке даёт кнопку «Повторить»."""
        if checkin_history is not None:
            checkin_history.record_checkin(user_id)
        if checkin_transport is None:
            await message.answer(i18n.styled_text(language, style, "checkin.done.demo"))
            return
        try:
            await checkin_transport.submit_personal_checkin(user_id, scores, nonce)
        except PausedError:
            pending_checkins.pop(nonce, None)
            await message.answer(i18n.styled_text(language, style, "checkin.done.paused"))
            return
        except TransportError:
            remember_pending_checkin(nonce, user_id, scores)
            await message.answer(
                i18n.styled_text(language, style, "checkin.done.unknown")
                + "\n\n" + i18n.text(language, "error.network"),
                reply_markup=retry_keyboard(language, f"checkin:{nonce}"),
            )
            return
        pending_checkins.pop(nonce, None)
        await message.answer(i18n.styled_text(language, style, "checkin.done.server"))

    async def deliver_subscription(message, user_id: int, language: str, style: str) -> None:
        """Включает уведомления; при сетевой ошибке даёт кнопку «Повторить»."""
        if notification_transport is None:
            await message.answer(i18n.text(language, "subscribe.no_config"))
            return
        try:
            result = await notification_transport.subscribe_notifications(user_id)
        except OrganizerRequiredError:
            await message.answer(i18n.text(language, "subscribe.organizer_only"))
            return
        except TransportError:
            await message.answer(
                i18n.text(language, "error.network"),
                reply_markup=retry_keyboard(language, "subscribe"),
            )
            return
        if result.get("notificationsEnabled") is True:
            await message.answer(i18n.styled_text(language, style, "subscribe.enabled"))
        else:
            await message.answer(i18n.text(language, "subscribe.disabled"))

    async def clear_buttons(message) -> None:
        """Убирает кнопки у уже отвеченного шага, чтобы чат не копил старые."""
        edit = getattr(message, "edit_reply_markup", None)
        if not callable(edit):
            return
        try:
            await edit(reply_markup=None)
        except Exception as error:  # noqa: BLE001 — кнопки не должны ронять сценарий
            logging.getLogger(__name__).debug("Не удалось убрать кнопки шага: %s", error)

    async def question(message, nonce, step, language, style) -> None:
        """Задаёт вопрос одним сообщением: картинка, текст и оценки."""
        key = QUESTION_KEYS[step]
        keyboard = InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(text=str(n), callback_data=f"score:{nonce}:{step}:{n}")
            for n in range(1, 6)
        ]])
        text = i18n.styled_text(
            language, style, "question.ask",
            index=step + 1, total=len(QUESTION_KEYS),
            question=i18n.question(language, key),
        )
        sent_with_photo = await send_question_image(
            message, key, question_images,
            question_images_dir or DEFAULT_IMAGE_DIR,
            caption=text, reply_markup=keyboard,
        )
        if not sent_with_photo:
            await message.answer(text, reply_markup=keyboard)

    @dispatcher.message(CommandStart())
    async def start(message: Message, state: FSMContext | None = None):
        language = await language_of(state)
        style = chat_style(await style_of(state), message)
        if message.chat.type != "private":
            await message.answer(i18n.text(
                language, "start.group.intake" if intake is not None else "start.group.no_intake",
            ))
            return
        if message.from_user is None or message.from_user.is_bot:
            return
        if checkin_history is not None:
            checkin_history.register_user(message.from_user.id)
        flow.cancel(message.from_user.id)
        pending_leader_messages.pop(message.from_user.id, None)
        if state is not None:
            await state.update_data(waiting_leader_message=False, leader_msg_text=None)
        await message.answer(
            i18n.styled_text(language, style, "start.private"),
            reply_markup=menu_keyboard(language),
        )

    @dispatcher.message(Command("menu"))
    async def menu_command(message: Message, state: FSMContext | None = None):
        await start(message, state)

    def resolve_guide_url() -> str:
        base = (
            os.environ.get("VIBEE_WEB_URL")
            or os.environ.get("VIBEE_API_BASE_URL", "https://vibee.dev")
        )
        if base.endswith("/api"):
            base = base[:-4]
        return f"{base.rstrip('/')}/guide"

    @dispatcher.message(Command("help"))
    async def help_command(message: Message, state: FSMContext | None = None):
        language = await language_of(state)
        url = resolve_guide_url()
        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text=i18n.text(language, "menu.leader_message"), callback_data="menu:leader_message")],
            [InlineKeyboardButton(text=i18n.text(language, "guide.button"), url=url)],
        ])
        await message.answer(
            i18n.help_text(
                language,
                voice_available=voice_transcription is not None,
                notifications_available=notification_transport is not None,
            ),
            reply_markup=keyboard,
        )

    @dispatcher.message(Command("guide"))
    async def guide_command(message: Message, state: FSMContext | None = None):
        language = await language_of(state)
        url = resolve_guide_url()
        keyboard = InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(text=i18n.text(language, "guide.button"), url=url),
        ]])
        await message.answer(
            i18n.text(language, "guide.text", url=url),
            reply_markup=keyboard,
        )

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

    @dispatcher.message(Command("style"))
    async def style_command(message: Message, state: FSMContext | None = None):
        language = await language_of(state)
        if message.chat.type != "private" or message.from_user is None or message.from_user.is_bot:
            await message.answer(i18n.text(language, "style.private_only"))
            return
        current = await style_of(state)
        parts = (message.text or "").split(maxsplit=1)
        requested = parts[1].strip() if len(parts) > 1 else ""
        if not requested:
            await message.answer(
                i18n.text(language, "style.current", name=i18n.style_name(language, current))
                + "\n" + i18n.text(language, "style.usage"),
                reply_markup=style_keyboard(language, current),
            )
            return
        style = styles.normalize_style(requested)
        if style is None:
            await message.answer(
                i18n.text(language, "style.invalid"),
                reply_markup=style_keyboard(language, current),
            )
            return
        await remember_style(state, style)
        await message.answer(
            i18n.styled_text(
                language, style, "style.saved", name=i18n.style_name(language, style),
            ),
            reply_markup=style_keyboard(language, style),
        )

    @dispatcher.callback_query(F.data.startswith("style:"))
    async def style_callback(event: CallbackQuery, state: FSMContext | None = None):
        language = await language_of(state)
        message = event.message
        if (message is None or getattr(getattr(message, "chat", None), "type", None) != "private"
                or event.from_user.is_bot or not callable(getattr(message, "answer", None))):
            await event.answer(i18n.text(language, "style.private_only"), show_alert=True)
            return
        style = styles.normalize_style(event.data.split(":", 1)[1])
        if style is None:
            await event.answer(i18n.text(language, "style.invalid"), show_alert=True)
            return
        await remember_style(state, style)
        await event.answer()
        await message.answer(
            i18n.styled_text(
                language, style, "style.saved", name=i18n.style_name(language, style),
            ),
            reply_markup=style_keyboard(language, style),
        )

    @dispatcher.callback_query(F.data.startswith("retry:"))
    async def retry_callback(event: CallbackQuery, state: FSMContext | None = None):
        language = await language_of(state)
        message = event.message
        if (message is None or getattr(getattr(message, "chat", None), "type", None) != "private"
                or event.from_user.is_bot or not callable(getattr(message, "answer", None))):
            await event.answer(i18n.text(language, "alert.checkin_private"), show_alert=True)
            return
        style = chat_style(await style_of(state), message)
        parts = event.data.split(":")
        if len(parts) == 2 and parts[1] == "subscribe":
            await event.answer()
            await deliver_subscription(message, event.from_user.id, language, style)
            return
        if len(parts) == 2 and parts[1] == "stats":
            await event.answer()
            await deliver_stats(message, event.from_user.id, language, style)
            return
        if len(parts) == 2 and parts[1] == "share":
            await event.answer()
            await deliver_share(message, event.from_user.id, language)
            return
        if len(parts) == 3 and parts[1] == "checkin":
            scores = take_pending_checkin(parts[2], event.from_user.id)
            if scores is None:
                await event.answer(i18n.text(language, "retry.expired"), show_alert=True)
                return
            await event.answer()
            await submit_checkin(message, event.from_user.id, scores, parts[2], language, style)
            return
        await event.answer(i18n.text(language, "error.generic"), show_alert=True)

    @dispatcher.callback_query(F.data == GROUP_SHARE_CALLBACK)
    async def group_share_callback(event: CallbackQuery, state: FSMContext | None = None):
        """Публикует готовую карточку в связанный чат команды по кнопке организатора."""
        language = await language_of(state)
        message = event.message
        if (message is None or getattr(getattr(message, "chat", None), "type", None) != "private"
                or event.from_user.is_bot):
            await event.answer(i18n.text(language, "alert.checkin_private"), show_alert=True)
            return
        reason = await group_share_block_reason()
        if reason is not None:
            await event.answer(i18n.text(language, reason), show_alert=True)
            return
        bot = getattr(event, "bot", None)
        if bot is None or not await bot_can_post_to_group(bot, group_chat_id):
            await event.answer(i18n.text(language, "share.group_no_rights"), show_alert=True)
            return
        try:
            view = await share_transport.get_summary(telegram_user_id=event.from_user.id)
        except OrganizerRequiredError:
            await event.answer(i18n.text(language, "share.organizer_only"), show_alert=True)
            return
        except TransportError:
            await event.answer(i18n.text(language, "share.group_failed"), show_alert=True)
            return
        status = view.get("status")
        if status in ("paused", "awaiting_consents", "disconnected"):
            await event.answer(i18n.text(language, "share.group_paused"), show_alert=True)
            return
        if status in ("calibrating", "insufficient", "open"):
            await event.answer(i18n.text(language, "share.no_period"), show_alert=True)
            return
        if status != "published":
            await event.answer(i18n.text(language, "share.unavailable"), show_alert=True)
            return
        try:
            card = await share_transport.get_share_card(event.from_user.id)
        except OrganizerRequiredError:
            await event.answer(i18n.text(language, "share.organizer_only"), show_alert=True)
            return
        except TransportError:
            await event.answer(i18n.text(language, "share.group_failed"), show_alert=True)
            return
        try:
            # В чат уходит только карточка с итогами периода: личных данных участников в ней нет.
            await bot.send_photo(
                chat_id=group_chat_id,
                photo=BufferedInputFile(card.image, filename=SHARE_CARD_FILE_NAME),
                caption=group_caption(language, card, share_transport.web_url),
            )
        except TelegramAPIError:
            logging.getLogger(__name__).warning("Share card was not delivered to the team chat")
            await event.answer(i18n.text(language, "share.group_failed"), show_alert=True)
            return
        # Кнопку убираем: карточка уже в чате, случайный повтор не нужен.
        await clear_buttons(message)
        await event.answer(i18n.text(language, "share.group_sent"))

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

    @dispatcher.callback_query(F.data == "menu:stats")
    async def select_stats(event: CallbackQuery, state: FSMContext | None = None):
        language = await language_of(state)
        message = event.message
        if (message is None or getattr(getattr(message, "chat", None), "type", None) != "private"
                or event.from_user.is_bot or not callable(getattr(message, "answer", None))):
            await event.answer(i18n.text(language, "alert.checkin_private_only"), show_alert=True)
            return
        style = chat_style(await style_of(state), message)
        await event.answer()
        await deliver_stats(message, event.from_user.id, language, style)

    @dispatcher.callback_query(F.data == "menu:guide")
    async def select_guide(event: CallbackQuery, state: FSMContext | None = None):
        language = await language_of(state)
        message = event.message
        if message is None or not callable(getattr(message, "answer", None)):
            await event.answer()
            return
        await event.answer()
        url = resolve_guide_url()
        keyboard = InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(text=i18n.text(language, "guide.button"), url=url),
        ]])
        await message.answer(
            i18n.text(language, "guide.text", url=url),
            reply_markup=keyboard,
        )

    @dispatcher.callback_query(F.data == "menu:settings")
    async def select_settings(event: CallbackQuery, state: FSMContext | None = None):
        language = await language_of(state)
        message = event.message
        if (message is None or getattr(getattr(message, "chat", None), "type", None) != "private"
                or event.from_user.is_bot or not callable(getattr(message, "answer", None))):
            await event.answer(i18n.text(language, "alert.checkin_private_only"), show_alert=True)
            return
        current_style = await style_of(state)
        await event.answer()
        lang_kb = language_keyboard(language)
        style_kb = style_keyboard(language, current_style)
        combined_keyboard = InlineKeyboardMarkup(inline_keyboard=[
            *lang_kb.inline_keyboard,
            *style_kb.inline_keyboard,
        ])
        await message.answer(
            i18n.text(language, "menu.settings_prompt"),
            reply_markup=combined_keyboard,
        )

    @dispatcher.callback_query(F.data == "menu:leader_message")
    async def select_leader_message(event: CallbackQuery, state: FSMContext | None = None):
        language = await language_of(state)
        message = event.message
        if (message is None or getattr(getattr(message, "chat", None), "type", None) != "private"
                or event.from_user.is_bot or not callable(getattr(message, "answer", None))):
            await event.answer(i18n.text(language, "alert.checkin_private_only"), show_alert=True)
            return
        pending_leader_messages[event.from_user.id] = {"stage": "text"}
        if state is not None:
            await state.update_data(waiting_leader_message=True)
        await event.answer()
        await message.answer(i18n.text(language, "leader_msg.prompt"))

    @dispatcher.callback_query(F.data.in_({"leadermsg:anon", "leadermsg:open"}))
    async def submit_leader_message_callback(event: CallbackQuery, state: FSMContext | None = None):
        language = await language_of(state)
        message = event.message
        if (message is None or getattr(getattr(message, "chat", None), "type", None) != "private"
                or event.from_user.is_bot):
            await event.answer(i18n.text(language, "alert.checkin_private_only"), show_alert=True)
            return
        user_id = event.from_user.id
        state_data = await state.get_data() if state is not None else {}
        draft = pending_leader_messages.pop(user_id, None)
        text_content = (draft.get("text") if isinstance(draft, dict) else None) or state_data.get("leader_msg_text")
        if not text_content:
            await event.answer(i18n.text(language, "error.generic"), show_alert=True)
            return

        if state is not None:
            await state.update_data(leader_msg_text=None, waiting_leader_message=False)

        is_anon = event.data == "leadermsg:anon"
        sender_name = None
        if not is_anon:
            name_parts = [event.from_user.first_name or "", event.from_user.last_name or ""]
            full_name = " ".join(p for p in name_parts if p).strip()
            sender_name = full_name or (f"@{event.from_user.username}" if event.from_user.username else "Участник Telegram")

        transport = checkin_transport or notification_transport
        if transport is not None and hasattr(transport, "submit_leader_message"):
            try:
                await transport.submit_leader_message(
                    message=text_content,
                    is_anonymous=is_anon,
                    telegram_user_id=user_id,
                    sender_name=sender_name,
                )
            except Exception as e:
                logging.getLogger(__name__).warning("Failed to submit leader message: %s", e)

        await clear_buttons(message)
        await event.answer()
        confirmation_key = "leader_msg.sent_anonymous" if is_anon else "leader_msg.sent_open"
        await message.answer(i18n.text(language, confirmation_key))

    @dispatcher.message(Command("stop"))
    async def stop(message: Message, state: FSMContext | None = None):
        if message.chat.type != "private" or message.from_user is None:
            return
        language = await language_of(state)
        style = chat_style(await style_of(state), message)
        flow.cancel(message.from_user.id)
        pending_leader_messages.pop(message.from_user.id, None)
        if state is not None:
            await state.update_data(waiting_leader_message=False, leader_msg_text=None)
        if voice_transcription is not None:
            voice_transcription.cancel(message.from_user.id)
        await message.answer(i18n.styled_text(
            language, style,
            "stop.with_transport" if checkin_transport is not None else "stop.without_transport",
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
        pending_leader_messages.pop(message.from_user.id, None)
        if state is not None:
            await state.update_data(waiting_leader_message=False, leader_msg_text=None)
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
        style = chat_style(await style_of(state), message)
        await deliver_subscription(message, message.from_user.id, language, style)

    @dispatcher.message(Command("stats"))
    async def stats_command(message: Message, state: FSMContext | None = None):
        language = await language_of(state)
        style = chat_style(await style_of(state), message)
        if message.chat.type != "private":
            await message.answer(i18n.text(language, "stats.private_only"))
            return
        if message.from_user is None or message.from_user.is_bot:
            return
        await deliver_stats(message, message.from_user.id, language, style)

    @dispatcher.message(Command("share"))
    async def share_command(message: Message, state: FSMContext | None = None):
        language = await language_of(state)
        if message.chat.type != "private":
            await message.answer(i18n.text(language, "share.private_only"))
            return
        if message.from_user is None or message.from_user.is_bot:
            return
        await deliver_share(message, message.from_user.id, language)

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

    def parse_room_key(raw: str | None) -> str | None:
        if not raw:
            return None
        text = raw.strip()
        if re.fullmatch(r"[A-Fa-f0-9]{8}", text):
            return text.upper()
        match = re.search(r"(?:ключ|код|room|key)[:\s]+([A-Fa-f0-9]{8})\b", text, re.IGNORECASE)
        if match:
            return match.group(1).upper()
        return None

    @dispatcher.message(Command("room"))
    @dispatcher.message(Command("join"))
    async def room_command(message: Message, state: FSMContext | None = None) -> None:
        if message.chat.type != "private":
            return
        language = await language_of(state)
        style = chat_style(await style_of(state), message)
        parts = (message.text or "").split(maxsplit=1)
        arg = parts[1].strip() if len(parts) > 1 else ""
        key = parse_room_key(arg)
        if key:
            if state is not None:
                await state.update_data(room_key=key)
            await message.answer(i18n.styled_text(language, style, "onboarding.room_connected"))
        else:
            await message.answer(i18n.styled_text(language, style, "onboarding.room_prompt"))

    @dispatcher.message(F.text)
    async def intake_message(message: Message, state: FSMContext | None = None) -> None:
        if message.chat.type == "private" and message.text and not message.text.startswith("/"):
            user_id = message.from_user.id if message.from_user else None
            is_waiting = (
                user_id is not None
                and user_id in pending_leader_messages
                and pending_leader_messages[user_id].get("stage") == "text"
            )
            if not is_waiting and state is not None and hasattr(state, "get_data"):
                try:
                    data = await state.get_data()
                    if isinstance(data, dict) and data.get("waiting_leader_message") is True:
                        is_waiting = True
                except Exception:
                    pass

            if is_waiting:
                cleaned = message.text.strip()
                language = await language_of(state)
                if not cleaned:
                    await message.answer(i18n.text(language, "leader_msg.empty"))
                    return
                if user_id:
                    pending_leader_messages[user_id] = {"stage": "choice", "text": cleaned}
                if state is not None and hasattr(state, "update_data"):
                    try:
                        await state.update_data(waiting_leader_message=False, leader_msg_text=cleaned)
                    except Exception:
                        pass
                keyboard = InlineKeyboardMarkup(inline_keyboard=[[
                    InlineKeyboardButton(text=i18n.text(language, "leader_msg.anonymous"), callback_data="leadermsg:anon"),
                    InlineKeyboardButton(text=i18n.text(language, "leader_msg.open"), callback_data="leadermsg:open"),
                ]])
                await message.answer(i18n.text(language, "leader_msg.choose_type"), reply_markup=keyboard)
                return

            room_key = parse_room_key(message.text)
            if room_key:
                if state is not None:
                    await state.update_data(room_key=room_key)
                language = await language_of(state)
                style = chat_style(await style_of(state), message)
                await message.answer(i18n.styled_text(language, style, "onboarding.room_connected"))
                return
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
            style = chat_style(await style_of(state), message)
            parts = event.data.split(":")
            if parts[0] == "consent" and len(parts) == 3:
                if parts[2] not in ("yes", "no"):
                    raise ValueError("Неверный выбор")
                accepted = flow.consent(event.from_user.id, parts[1], parts[2] == "yes")
                await event.answer()
                await clear_buttons(message)
                if accepted:
                    await question(message, parts[1], 0, language, style)
                else:
                    await message.answer(i18n.styled_text(language, style, "consent.declined"))
            elif parts[0] == "score" and len(parts) == 4:
                step = int(parts[2])
                result = flow.answer(event.from_user.id, parts[1], step, int(parts[3]))
                await event.answer()
                await clear_buttons(message)
                if result is not None:
                    await submit_checkin(
                        message, event.from_user.id, result, parts[1], language, style,
                    )
                else:
                    await question(message, parts[1], step + 1, language, style)
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
    checkin_history = CheckinHistoryJournal(data_dir / ("bot-checkin-history-" + suffix + ".json"))
    group_chat_id: int | None = None

    if api_token and binding_id and chat_id_raw:
        try:
            chat_id = int(chat_id_raw)
            if chat_id >= 0 or str(chat_id) != chat_id_raw:
                raise ValueError()
        except ValueError:
            raise SystemExit("VIBEE_CHAT_ID must be a negative Telegram group ID.") from None
        group_chat_id = chat_id
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
        stats_transport=transport,
        share_transport=transport,
        group_chat_id=group_chat_id,
        message_log=message_log,
        question_images=question_image_cache,
        checkin_history=checkin_history,
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
            reminder_scheduler = CheckinReminderScheduler(bot=bot, journal=checkin_history)
            reminder_task = asyncio.create_task(reminder_scheduler.start_loop())
            print("Vibee: запускаю подключение к Telegram. Для проверки отправьте /start.", flush=True)
            try:
                await bot.set_my_commands(BOT_COMMANDS)
            except Exception as error:
                # Меню команд не критично для работы бота: сообщаем и продолжаем опрос.
                logging.getLogger(__name__).warning("Не удалось обновить меню команд Telegram: %s", error)
            await dispatcher.start_polling(bot, allowed_updates=dispatcher.resolve_used_update_types(), handle_signals=True)
    finally:
        task.cancel()
        reminder_task.cancel()
        with suppress(asyncio.CancelledError):
            await task
        with suppress(asyncio.CancelledError):
            await reminder_task
        flow.drafts.clear()
        if voice_transcription is not None:
            await voice_transcription.close()
        if transport is not None:
            await transport.close()


if __name__ == "__main__":
    asyncio.run(main())
