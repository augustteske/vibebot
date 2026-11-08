"""Тексты бота на русском и английском.

Русские строки — исходные, английские лежат рядом в том же словаре. Ключи
плоские: ``"start.private"``. Подстановки — через ``{имя}`` и ``text(...)``.
"""
from __future__ import annotations

RU = "ru"
EN = "en"
LANGUAGES = (RU, EN)
DEFAULT_LANGUAGE = RU

_TEXTS: dict[str, dict[str, str]] = {
    RU: {
        "start.private": "Привет! Я Vibee 🐝\nВыберите сценарий. О данных — /privacy.",
        "start.group.no_intake": (
            "Сбор сообщений из групп в этом запуске не настроен, "
            "поэтому Vibee их не обрабатывает. "
            "Личные сценарии доступны в личном диалоге."
        ),
        "start.group.intake": (
            "Vibee обрабатывает сообщения этой группы только при включённом на сервере сборе "
            "и подтверждённых согласиях компании и всех участников. "
            "Сам по себе запуск бота не означает, что сбор активен: итоговый статус определяет сервер. "
            "Личные сценарии доступны в личном диалоге."
        ),
        "menu.checkin": "Пройти личный чек-ин",
        "menu.voice": "Расшифровать голосовое",
        "question.energy": "Сколько сил на работу сегодня?",
        "question.clarity": "Насколько понятно, что сейчас главное?",
        "question.support": "Насколько легко сейчас попросить помощи?",
        "question.ask": "{index}/{total} · {question}\n1 — мало, 5 — много. Отмена: /stop.",
        "consent.yes": "Согласен",
        "consent.no": "Отказаться",
        "consent.text_with_transport": (
            "Чек-ин: три оценки от 1 до 5. Нужно ваше согласие.\n"
            "Черновик хранится в памяти до 5 минут и удаляется при завершении или /stop. "
            "После завершения три оценки уходят на сервер; Telegram ID нужен, "
            "чтобы проверить участие. Организатор получает общую сводку, когда ответов "
            "достаточно. /stop не удаляет уже переданные данные."
        ),
        "consent.text_without_transport": (
            "Чек-ин: три оценки от 1 до 5. Нужно ваше согласие.\n"
            "Черновик хранится в памяти до 5 минут и удаляется при завершении или /stop. "
            "Ответы остаются в личном сценарии и не отправляются в командный кабинет."
        ),
        "consent.declined": "Отказ принят. Черновик удалён. Меню — /start.",
        "checkin.done.server": (
            "Спасибо, чек-ин завершён. Три оценки переданы на сервер; "
            "организатор увидит общую сводку, когда ответов достаточно. Меню — /start."
        ),
        "checkin.done.paused": (
            "Чек-ин завершён, но сервер отклонил передачу. "
            "Проверьте, что вы участник команды, или обратитесь к организатору. Меню — /start."
        ),
        "checkin.done.unknown": (
            "Чек-ин завершён, но подтвердить передачу на сервер не удалось. "
            "Ответы могли не сохраниться; попробуйте позже или обратитесь к организатору. "
            "Меню — /start."
        ),
        "checkin.done.demo": (
            "Спасибо, личный демо-чек-ин завершён. Черновик очищен из памяти; "
            "ответы не отправлялись на сервер или в командный кабинет. Меню — /start."
        ),
        "stop.with_transport": (
            "Текущий сценарий отменён. Черновик и разрешение на расшифровку очищены; "
            "обработка остановлена. "
            "Уже переданные на сервер ответы не удаляются; для сообщений в Telegram есть /clean."
        ),
        "stop.without_transport": (
            "Текущий сценарий отменён. Черновик и разрешение на расшифровку очищены; "
            "обработка остановлена. "
            "Сообщения в Telegram бот не удаляет; для них есть /clean."
        ),
        "clean.done": (
            "Чат очищен. Если остались старые сообщения, удалите их вручную "
            "(Telegram не позволяет ботам удалять их).\n\n"
            "⚠️ История диалога пропала: удалённые сообщения восстановить нельзя."
        ),
        "clean.empty": (
            "Нечего очищать: за последние 48 часов бот не нашёл своих сообщений. "
            "Если остались старые сообщения, удалите их вручную "
            "(Telegram не позволяет ботам удалять их)."
        ),
        "clean.partial": (
            "Не удалось удалить часть сообщений: Telegram отклонил запрос. "
            "Попробуйте /clean ещё раз позже; оставшиеся сообщения можно удалить вручную.\n\n"
            "⚠️ Уже удалённые сообщения восстановить нельзя."
        ),
        "clean.private_only": "Очистка истории доступна только в личном диалоге с ботом.",
        "subscribe.no_config": "Уведомления не настроены в этом запуске; подписка недоступна.",
        "subscribe.organizer_only": (
            "Подписаться может только организатор, чей Telegram-аккаунт связан с этой командой."
        ),
        "subscribe.error": (
            "Не удалось включить уведомления. Проверьте подключение бота и настройки сервера."
        ),
        "subscribe.enabled": (
            "Подписка включена. Уведомления о закрытых опубликованных периодах будут приходить сюда."
        ),
        "subscribe.disabled": (
            "Подписка сохранена, но серверная отправка уведомлений выключена. "
            "Администратору нужно настроить доставку на сервере."
        ),
        "help.title": "Команды Vibee:",
        "help.start": "/start — меню сценариев",
        "help.help": "/help — эта справка",
        "help.privacy": "/privacy — что обрабатывается и где хранится",
        "help.stop": "/stop — отменить текущий чек-ин или расшифровку",
        "help.clean": "/clean — удалить сообщения бота в этом чате (до 48 часов)",
        "help.lang": "/lang ru | en — язык ответов бота",
        "help.transcribe": "/transcribe — запросить расшифровку одной личной голосовой",
        "help.voice_unavailable": (
            "Расшифровка голосовых сейчас недоступна: локальная модель не настроена."
        ),
        "help.subscribe": (
            "/subscribe — запросить уведомления; только для связанного организатора, "
            "сервер проверит права и доставку."
        ),
        "help.notifications_unavailable": (
            "Уведомления недоступны: серверное подключение не настроено."
        ),
        "help.group": (
            "Групповой сбор не запускается из меню; стандартный сервер его не включает."
        ),
        "privacy.checkin_server": (
            "• Личный чек-ин — три оценки. Согласие спрашивается до вопросов. "
            "Черновик хранится в памяти до 5 минут и очищается при завершении или /stop. "
            "После завершения три оценки отправляются на сервер; Telegram ID используется, "
            "чтобы проверить участие, поэтому полной анонимности нет. Организатор видит "
            "только общую сводку, когда ответов достаточно. /stop очищает локальный черновик, "
            "но не удаляет уже переданные данные и историю Telegram.\n"
        ),
        "privacy.checkin_demo": (
            "• Личный чек-ин — три оценки. Согласие спрашивается до вопросов. "
            "Черновик хранится в памяти до 5 минут и очищается при завершении или /stop. "
            "Ответы остаются в личном сценарии и не отправляются на сервер или в командный кабинет. "
            "/stop очищает локальный черновик, но не удаляет историю Telegram.\n"
        ),
        "privacy.intro": "Коротко о данных в этом боте:\n",
        "privacy.common": (
            "• Голосовая расшифровывается только после отдельного согласия на одну новую запись "
            "и только локальной моделью. Аудио и текст не записываются ботом в файл или БД; "
            "результат отправляется только в этот личный чат и остаётся в Telegram.\n"
            "• Для /clean бот хранит только идентификаторы своих сообщений и время отправки "
            "(не дольше 48 часов), без текста и содержимого.\n"
            "• Личные сценарии не анализируют групповые сообщения. Отдельный групповой контур "
            "требует серверной настройки и согласия компании и каждого участника."
        ),
        "alert.checkin_private_only": "Личный чек-ин доступен только в личном чате.",
        "alert.checkin_open": (
            "Чек-ин уже открыт. Продолжите по последним кнопкам или нажмите /stop."
        ),
        "alert.checkin_private": "Чек-ин доступен в личном диалоге",
        "error.expired": "Этот чек-ин истёк. Откройте /start и начните заново.",
        "error.processed": "Этот выбор уже обработан. Откройте /start для нового сценария.",
        "error.stale": "Кнопка устарела. Откройте /start и начните заново.",
        "error.score_range": "Выберите целую оценку от 1 до 5.",
        "error.choice": "Выберите один из вариантов кнопками.",
        "error.generic": "Не удалось обработать выбор. Откройте /start и попробуйте снова.",
        "lang.saved": "Язык сохранён: русский.",
        "lang.current": "Текущий язык: {name}.",
        "lang.usage": "Сменить: /lang ru или /lang en.",
        "lang.invalid": "Не понял язык. Доступно: /lang ru или /lang en.",
    },
    EN: {
        "start.private": "Hi! I'm Vibee 🐝\nPick a scenario. About data — /privacy.",
        "start.group.no_intake": (
            "Collecting messages from groups is not configured in this run, "
            "so Vibee does not process them. "
            "Personal scenarios are available in a private chat."
        ),
        "start.group.intake": (
            "Vibee processes messages in this group only when collection is enabled on the server "
            "and the company and all members have given consent. "
            "Starting the bot does not by itself mean collection is active: the server decides "
            "the final status. Personal scenarios are available in a private chat."
        ),
        "menu.checkin": "Take a personal check-in",
        "menu.voice": "Transcribe a voice message",
        "question.energy": "How much energy do you have for work today?",
        "question.clarity": "How clear is it what matters most right now?",
        "question.support": "How easy is it to ask for help right now?",
        "question.ask": "{index}/{total} · {question}\n1 — low, 5 — high. Cancel: /stop.",
        "consent.yes": "I agree",
        "consent.no": "Decline",
        "consent.text_with_transport": (
            "Check-in: three ratings from 1 to 5. Your consent is required.\n"
            "The draft is kept in memory for up to 5 minutes and deleted when you finish or send /stop. "
            "After you finish, the three ratings go to the server; Telegram ID is used to verify "
            "participation. The organizer receives an aggregate summary once there are enough answers. "
            "/stop does not delete data already sent."
        ),
        "consent.text_without_transport": (
            "Check-in: three ratings from 1 to 5. Your consent is required.\n"
            "The draft is kept in memory for up to 5 minutes and deleted when you finish or send /stop. "
            "The answers stay in the personal scenario and are not sent to the team dashboard."
        ),
        "consent.declined": "Declined. The draft is deleted. Menu — /start.",
        "checkin.done.server": (
            "Thanks, the check-in is complete. The three ratings were sent to the server; "
            "the organizer will see an aggregate summary once there are enough answers. Menu — /start."
        ),
        "checkin.done.paused": (
            "The check-in is complete, but the server rejected the transfer. "
            "Check that you are a team member or contact the organizer. Menu — /start."
        ),
        "checkin.done.unknown": (
            "The check-in is complete, but delivery to the server could not be confirmed. "
            "The answers may not have been saved; try again later or contact the organizer. "
            "Menu — /start."
        ),
        "checkin.done.demo": (
            "Thanks, the personal demo check-in is complete. The draft was cleared from memory; "
            "the answers were not sent to the server or the team dashboard. Menu — /start."
        ),
        "stop.with_transport": (
            "The current scenario is cancelled. The draft and transcription permission were cleared; "
            "processing stopped. "
            "Answers already sent to the server are not deleted; use /clean for Telegram messages."
        ),
        "stop.without_transport": (
            "The current scenario is cancelled. The draft and transcription permission were cleared; "
            "processing stopped. "
            "The bot does not delete Telegram messages; /clean is available for them."
        ),
        "clean.done": (
            "Chat cleaned. If older messages remain, delete them manually "
            "(Telegram does not let bots delete them).\n\n"
            "⚠️ The conversation history is gone: deleted messages cannot be restored."
        ),
        "clean.empty": (
            "Nothing to clean: the bot found no messages of its own from the last 48 hours. "
            "If older messages remain, delete them manually "
            "(Telegram does not let bots delete them)."
        ),
        "clean.partial": (
            "Some messages could not be deleted: Telegram rejected the request. "
            "Try /clean again later; the remaining messages can be deleted manually.\n\n"
            "⚠️ Messages already deleted cannot be restored."
        ),
        "clean.private_only": "History cleanup is available only in a private chat with the bot.",
        "subscribe.no_config": "Notifications are not configured in this run; subscription is unavailable.",
        "subscribe.organizer_only": (
            "Only an organizer whose Telegram account is linked to this team can subscribe."
        ),
        "subscribe.error": (
            "Could not enable notifications. Check the bot connection and server settings."
        ),
        "subscribe.enabled": (
            "Subscription enabled. Notifications about closed published periods will arrive here."
        ),
        "subscribe.disabled": (
            "The subscription is saved, but server delivery is disabled. "
            "An administrator needs to configure delivery on the server."
        ),
        "help.title": "Vibee commands:",
        "help.start": "/start — scenario menu",
        "help.help": "/help — this help",
        "help.privacy": "/privacy — what is processed and where it is stored",
        "help.stop": "/stop — cancel the current check-in or transcription",
        "help.clean": "/clean — delete the bot's messages in this chat (up to 48 hours)",
        "help.lang": "/lang ru | en — bot reply language",
        "help.transcribe": "/transcribe — request transcription of one personal voice message",
        "help.voice_unavailable": (
            "Voice transcription is unavailable right now: the local model is not configured."
        ),
        "help.subscribe": (
            "/subscribe — request notifications; only for a linked organizer, "
            "the server checks permissions and delivery."
        ),
        "help.notifications_unavailable": (
            "Notifications are unavailable: the server connection is not configured."
        ),
        "help.group": "Group collection is not started from the menu; the standard server keeps it off.",
        "privacy.checkin_server": (
            "• Personal check-in — three ratings. Consent is asked before the questions. "
            "The draft is kept in memory for up to 5 minutes and cleared when you finish or send /stop. "
            "After you finish, the three ratings are sent to the server; Telegram ID is used to verify "
            "participation, so there is no full anonymity. The organizer sees only an aggregate "
            "summary once there are enough answers. /stop clears the local draft but does not delete "
            "data already sent or the Telegram history.\n"
        ),
        "privacy.checkin_demo": (
            "• Personal check-in — three ratings. Consent is asked before the questions. "
            "The draft is kept in memory for up to 5 minutes and cleared when you finish or send /stop. "
            "The answers stay in the personal scenario and are not sent to the server or the team "
            "dashboard. /stop clears the local draft but does not delete the Telegram history.\n"
        ),
        "privacy.intro": "Briefly about data in this bot:\n",
        "privacy.common": (
            "• A voice message is transcribed only after separate consent for one new recording "
            "and only by the local model. The bot does not save audio or text to a file or database; "
            "the result is sent only to this private chat and stays in Telegram.\n"
            "• For /clean the bot stores only the IDs of its own messages and the send time "
            "(no longer than 48 hours), without text or content.\n"
            "• Personal scenarios do not analyse group messages. A separate group flow requires "
            "server configuration and consent from the company and every member."
        ),
        "alert.checkin_private_only": "A personal check-in is available only in a private chat.",
        "alert.checkin_open": (
            "A check-in is already open. Continue with the latest buttons or send /stop."
        ),
        "alert.checkin_private": "The check-in is available in a private chat",
        "error.expired": "This check-in has expired. Open /start and begin again.",
        "error.processed": "This choice was already handled. Open /start for a new scenario.",
        "error.stale": "The button is out of date. Open /start and begin again.",
        "error.score_range": "Choose a whole rating from 1 to 5.",
        "error.choice": "Choose one of the options with the buttons.",
        "error.generic": "Could not process the choice. Open /start and try again.",
        "lang.saved": "Language saved: English.",
        "lang.current": "Current language: {name}.",
        "lang.usage": "Switch: /lang ru or /lang en.",
        "lang.invalid": "Unknown language. Available: /lang ru or /lang en.",
    },
}

_LANGUAGE_NAMES = {RU: "русский (ru)", EN: "English (en)"}


def normalize_language(value: object) -> str | None:
    """Возвращает код языка, если он поддерживается, иначе ``None``."""
    if not isinstance(value, str):
        return None
    code = value.strip().lower().replace("_", "-").split("-")[0]
    return code if code in LANGUAGES else None


def language_name(language: object) -> str:
    """Название языка на нём самом — для сообщения /lang."""
    return _LANGUAGE_NAMES.get(normalize_language(language) or DEFAULT_LANGUAGE, _LANGUAGE_NAMES[DEFAULT_LANGUAGE])


def text(language: object, key: str, **values: object) -> str:
    """Текст по ключу на выбранном языке; неизвестный язык — русский."""
    code = normalize_language(language) or DEFAULT_LANGUAGE
    template = _TEXTS[code].get(key) or _TEXTS[DEFAULT_LANGUAGE][key]
    return template.format(**values) if values else template


def question(language: object, key: str) -> str:
    """Формулировка вопроса чек-ина по его ключу."""
    return text(language, f"question.{key}")


def help_text(language: object, voice_available: bool, notifications_available: bool) -> str:
    """Справка /help с учётом настроенных возможностей."""
    lines = [
        text(language, "help.title"),
        text(language, "help.start"),
        text(language, "help.help"),
        text(language, "help.privacy"),
        text(language, "help.stop"),
        text(language, "help.clean"),
        text(language, "help.lang"),
    ]
    if voice_available:
        lines.append(text(language, "help.transcribe"))
    else:
        lines.append(text(language, "help.voice_unavailable"))
    if notifications_available:
        lines.append(text(language, "help.subscribe"))
    else:
        lines.append(text(language, "help.notifications_unavailable"))
    lines.append(text(language, "help.group"))
    return "\n".join(lines)


def privacy_text(language: object, checkin_transport: bool) -> str:
    """Текст /privacy: что бот обрабатывает и где это хранится."""
    checkin_note = text(
        language,
        "privacy.checkin_server" if checkin_transport else "privacy.checkin_demo",
    )
    return text(language, "privacy.intro") + checkin_note + text(language, "privacy.common")


def consent_text(language: object, checkin_transport: bool) -> str:
    """Текст согласия перед первым вопросом чек-ина."""
    return text(
        language,
        "consent.text_with_transport" if checkin_transport else "consent.text_without_transport",
    )
