"""Тексты бота на русском и английском.

Русские строки — исходные, английские лежат рядом в том же словаре. Ключи
плоские: ``"start.private"``. Подстановки — через ``{имя}`` и ``text(...)``.
Режимы общения добавляют ключи с префиксом: ``"cute.start.private"``.
"""
from __future__ import annotations

from . import styles

RU = "ru"
EN = "en"
LANGUAGES = (RU, EN)
DEFAULT_LANGUAGE = RU

_TEXTS: dict[str, dict[str, str]] = {
    RU: {
        "start.private": (
            "Привет! Я Vibee 🐝\n\n"
            "Хочешь подключить свою команду? Просто отправь мне ключ комнаты (например, A1B2C3D4).\n\n"
            "Или выберите сценарий ниже. О данных — /privacy."
        ),
        "onboarding.room_connected": (
            "Отлично! Теперь ты в команде. Когда все коллеги подключатся, мы начнем собирать метрики."
        ),
        "onboarding.room_prompt": (
            "Хочешь подключить свою команду? Просто отправь мне 8-значный ключ комнаты (например, A1B2C3D4)."
        ),
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
        "subscribe.enabled": (
            "Подписка включена. Уведомления о закрытых опубликованных периодах будут приходить сюда."
        ),
        "subscribe.disabled": (
            "Подписка сохранена, но серверная отправка уведомлений выключена. "
            "Администратору нужно настроить доставку на сервере."
        ),
        "guide.text": (
            "📖 Инструкция по подключению Vibee:\n{url}\n\n"
            "Пошаговый гайд: создание бота в BotFather, настройка .env, запуск и подключение рабочего чата."
        ),
        "guide.button": "📖 Открыть инструкцию",
        "help.title": "Команды Vibee:",
        "help.start": "/start — меню сценариев",
        "help.help": "/help — эта справка",
        "help.guide": "/guide — руководство по подключению бота и кабинета",
        "help.privacy": "/privacy — что обрабатывается и где хранится",
        "help.stop": "/stop — отменить текущий чек-ин или расшифровку",
        "help.clean": "/clean — удалить сообщения бота в этом чате (до 48 часов)",
        "help.lang": "/lang ru | en — язык ответов бота",
        "help.style": "/style — режим общения: классик, ми-ми-ми или правдарубка",
        "help.stats": "/stats — статистика команды; только для связанного организатора",
        "help.share": "/share — карточка «Пульс команды» для организатора",
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
        "error.network": (
            "🐝 Упс, кажется, у нас проблемы с сетью. Мы уже чиним! Попробуйте позже."
        ),
        "reminder.text": (
            "🐝 Привет! Мы давно не видели твоих ответов. Не забудь пройти чек-ин на этой неделе."
        ),
        "reminder.button": "Пройти чек-ин",
        "button.retry": "Повторить",
        "retry.expired": (
            "Данные этого чек-ина уже не сохранены. Пройдите чек-ин заново: /start."
        ),
        "lang.saved": "Язык сохранён: русский.",
        "lang.current": "Текущий язык: {name}.",
        "lang.usage": "Сменить: /lang ru или /lang en.",
        "lang.invalid": "Не понял язык. Доступно: /lang ru или /lang en.",
        "style.current": (
            "Сейчас режим: «{name}». Выберите новый — он сохранится до перезапуска бота."
        ),
        "style.usage": "Сменить: /style classic, /style cute или /style straight.",
        "style.saved": "Готово: теперь общаемся в режиме «{name}».",
        "style.invalid": "Не знаю такого режима. Доступны: classic, cute, straight.",
        "style.private_only": "Режим общения можно менять только в личном чате с ботом.",
        "style.name.classic": "Классик",
        "style.name.cute": "Ми-ми-ми",
        "style.name.straight": "Правдарубка",
        "stats.private_only": "Статистика доступна только в личном диалоге с ботом.",
        "stats.organizer_only": (
            "Статистика доступна только организатору, чей Telegram-аккаунт связан с этой командой."
        ),
        "stats.no_connection": "Статистика пока недоступна: бот не подключён к серверу.",
        "stats.insufficient": "Пока недостаточно данных для статистики. Пригласите коллег в чат!",
        "stats.unavailable": (
            "Статистика пока недоступна: сбор ещё не дал данных. Попробуйте позже."
        ),
        "stats.header": "📊 Статистика команды",
        "stats.outside_hours": "⏱ Вне работы: {value}%",
        "stats.participation": "🤝 Участие: {value}%",
        "stats.recognition": "🙏 Благодарности: {value}%",
        "stats.report": "Открыть полный отчет",
        "stats.error": "Не удалось разобрать статистику. Попробуйте позже.",
        "share.private_only": "Карточка «Пульс команды» доступна только в личном диалоге с ботом.",
        "share.organizer_only": (
            "Карточку может собрать только организатор, чей Telegram-аккаунт связан с этой командой."
        ),
        "share.no_connection": "Карточка пока недоступна: бот не подключён к серверу.",
        "share.no_period": (
            "Пока нет опубликованного периода. Карточка появится, когда период закроется "
            "и в нём будет достаточно ответов."
        ),
        "share.unavailable": (
            "Карточка пока недоступна: период ещё не опубликован. Попробуйте позже."
        ),
        "share.period_fallback": "этот период",
        "share.caption": (
            "📊 Пульс команды {team} за {period}. Попробуйте Vibee для своей команды: {url}"
        ),
        "share.caption_no_name": (
            "📊 Пульс команды за {period}. Попробуйте Vibee для своей команды: {url}"
        ),
        "share.group_button": "Отправить в группу",
        "share.group_caption": (
            "📊 Пульс команды {team} за {period}. Подробнее в кабинете: {url}"
        ),
        "share.group_caption_no_name": (
            "📊 Пульс команды за {period}. Подробнее в кабинете: {url}"
        ),
        "share.group_sent": "Карточка отправлена в чат команды.",
        "share.group_no_chat": "Чат команды не подключён: карточку пока некуда отправить.",
        "share.group_paused": (
            "Сейчас карточку в чат не отправить: сбор на паузе или не хватает согласий."
        ),
        "share.group_no_rights": (
            "Бот не может писать в чат команды: проверьте его права или добавьте бота в чат."
        ),
        "share.group_failed": "Не получилось отправить карточку в чат. Попробуйте ещё раз.",
        "cute.start.private": (
            "Приветик! Я Vibee 🐝💛\n\n"
            "Хочешь подключить свою команду? Просто отправь мне ключ комнаты (например, A1B2C3D4).\n\n"
            "Или выбери, чем займёмся ниже 🌸 О данных — /privacy."
        ),
        "cute.onboarding.room_connected": (
            "Отлично! Теперь ты в команде 🐝✨ Когда все коллеги подключатся, мы начнем собирать метрики 💛"
        ),
        "cute.onboarding.room_prompt": (
            "Хочешь подключить команду? Отправь мне ключик комнаты (например, A1B2C3D4) 🌸"
        ),
        "cute.question.ask": (
            "{index}/{total} · {question}\n"
            "Поставь от 1 до 5, как чувствуешь 🌸 Передумал — /stop."
        ),
        "cute.consent.declined": "Хорошо, отказ принят 💛 Черновик удалён. Меню — /start.",
        "cute.checkin.done.server": (
            "Спасибо, что поделился! 💛 Чек-ин готов: три оценки улетели на сервер. "
            "Организатор увидит только общую сводку. Меню — /start."
        ),
        "cute.checkin.done.paused": (
            "Чек-ин готов, но сервер его не принял 😔 Проверь, что ты участник команды, "
            "или напиши организатору. Меню — /start."
        ),
        "cute.checkin.done.unknown": (
            "Чек-ин готов, но подтвердить отправку не получилось 😔 "
            "Ответы могли не сохраниться — попробуй позже. Меню — /start."
        ),
        "cute.checkin.done.demo": (
            "Спасибо, что поделился! 💛 Демо-чек-ин готов, ответы остались только у нас "
            "и никуда не ушли. Меню — /start."
        ),
        "cute.stop.with_transport": (
            "Остановила сценарий 💛 Черновик и разрешение на расшифровку очищены. "
            "Уже переданные на сервер ответы не удаляются; для сообщений есть /clean."
        ),
        "cute.stop.without_transport": (
            "Остановила сценарий 💛 Черновик и разрешение на расшифровку очищены. "
            "Сообщения в Telegram остаются — для них есть /clean."
        ),
        "cute.subscribe.enabled": (
            "Подписка включена 💛 Уведомления о закрытых опубликованных периодах будут приходить сюда."
        ),
        "cute.style.saved": "Готово: теперь общаемся в режиме «{name}» 💛",
        "cute.stats.header": "📊 Статистика команды 💛",
        "cute.stats.insufficient": (
            "Пока маловато данных для статистики 🌱 Пригласите коллег в чат — и всё получится!"
        ),
        "cute.stats.unavailable": (
            "Статистика ещё собирается 🌸 Загляните чуть позже — я всё покажу."
        ),
        "straight.start.private": (
            "Привет. Vibee на связи. Хочешь подключить свою команду? Отправь ключ комнаты (например, A1B2C3D4).\n\n"
            "Или выбирай сценарий, без лишней болтовни — она нахер не сдалась. Данные — /privacy."
        ),
        "straight.onboarding.room_connected": (
            "Отлично. Теперь ты в команде. Когда все коллеги подключатся, начнем собирать метрики."
        ),
        "straight.onboarding.room_prompt": (
            "Хочешь подключить команду? Кинь сюда 8-значный ключ комнаты (например, A1B2C3D4)."
        ),
        "straight.question.ask": (
            "{index}/{total} · {question}\nСтавь от 1 до 5. Надоело — /stop."
        ),
        "straight.consent.declined": "Ладно, отказ принят. Черновик удалён. Меню — /start.",
        "straight.checkin.done.server": (
            "Готово. Оценки ушли на сервер. Организатор увидит только общую сводку. "
            "Меню — /start."
        ),
        "straight.checkin.done.paused": (
            "Чек-ин готов, но сервер отклонил отправку — херня какая-то. "
            "Проверь, что ты в команде, или напиши организатору. Меню — /start."
        ),
        "straight.checkin.done.unknown": (
            "Чек-ин готов, но отправку не подтвердили. Ответы могли не сохраниться — "
            "попробуй позже. Меню — /start."
        ),
        "straight.checkin.done.demo": (
            "Готово. Демо-чек-ин закрыт, никуда ничего не ушло. Меню — /start."
        ),
        "straight.stop.with_transport": (
            "Стоп. Черновик и разрешение на расшифровку очищены. "
            "Уже отправленные ответы не удаляются; для сообщений есть /clean."
        ),
        "straight.stop.without_transport": (
            "Стоп. Черновик и разрешение на расшифровку очищены. "
            "Сообщения в Telegram остаются — для них есть /clean."
        ),
        "straight.subscribe.enabled": (
            "Подписка включена. Уведомления о закрытых периодах придут сюда."
        ),
        "straight.style.saved": "Принято. Режим — «{name}».",
        "straight.stats.header": "📊 Статистика команды. Без соплей.",
        "straight.stats.insufficient": (
            "Данных мало. Пригласи коллег в чат — без них статистики не будет."
        ),
        "straight.stats.unavailable": (
            "Статистики пока нет: собирать ещё нечего. Зайди позже."
        ),
        "straight.stats.organizer_only": (
            "Статистика только для организатора. Остальным тут смотреть нечего."
        ),
    },
    EN: {
        "start.private": (
            "Hi! I'm Vibee 🐝\n\n"
            "Want to connect your team? Just send me the room key (e.g. A1B2C3D4).\n\n"
            "Or pick a scenario below. About data — /privacy."
        ),
        "onboarding.room_connected": (
            "Great! You're in the team now. Once all colleagues join, we will start collecting metrics."
        ),
        "onboarding.room_prompt": (
            "Want to connect your team? Just send me the 8-character room key (e.g. A1B2C3D4)."
        ),
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
        "subscribe.enabled": (
            "Subscription enabled. Notifications about closed published periods will arrive here."
        ),
        "subscribe.disabled": (
            "The subscription is saved, but server delivery is disabled. "
            "An administrator needs to configure delivery on the server."
        ),
        "guide.text": (
            "📖 Vibee Connection Guide:\n{url}\n\n"
            "Step-by-step guide: BotFather creation, .env configuration, running the project and connecting team chat."
        ),
        "guide.button": "📖 Open Guide",
        "help.title": "Vibee commands:",
        "help.start": "/start — scenario menu",
        "help.help": "/help — this help",
        "help.guide": "/guide — getting started and connection guide",
        "help.privacy": "/privacy — what is processed and where it is stored",
        "help.stop": "/stop — cancel the current check-in or transcription",
        "help.clean": "/clean — delete the bot's messages in this chat (up to 48 hours)",
        "help.lang": "/lang ru | en — bot reply language",
        "help.style": "/style — communication mode: classic, cute or straight",
        "help.stats": "/stats — team metrics; linked organizer only",
        "help.share": "/share — “Team pulse” card for the organizer",
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
        "error.network": (
            "🐝 Oops, looks like we're having network problems. We're fixing it! "
            "Please try again later."
        ),
        "reminder.text": (
            "🐝 Hey! We haven't seen your answers for a while. Don't forget to take your check-in this week."
        ),
        "reminder.button": "Take check-in",
        "button.retry": "Retry",
        "retry.expired": (
            "This check-in's answers are no longer saved. Please take the check-in again: /start."
        ),
        "lang.saved": "Language saved: English.",
        "lang.current": "Current language: {name}.",
        "lang.usage": "Switch: /lang ru or /lang en.",
        "lang.invalid": "Unknown language. Available: /lang ru or /lang en.",
        "style.current": (
            "Current mode: “{name}”. Pick a new one — it lasts until the bot restarts."
        ),
        "style.usage": "Switch: /style classic, /style cute or /style straight.",
        "style.saved": "Done: we now talk in “{name}” mode.",
        "style.invalid": "Unknown mode. Available: classic, cute, straight.",
        "style.private_only": "The communication mode can only be changed in a private chat with the bot.",
        "style.name.classic": "Classic",
        "style.name.cute": "Cute",
        "style.name.straight": "Straight talk",
        "stats.private_only": "Team metrics are available only in a private chat with the bot.",
        "stats.organizer_only": (
            "Team metrics are available only to the organizer whose Telegram account "
            "is linked to this team."
        ),
        "stats.no_connection": "Team metrics are unavailable: the bot is not connected to the server.",
        "stats.insufficient": "Not enough data for statistics yet. Invite your colleagues to the chat!",
        "stats.unavailable": (
            "Team metrics are not available yet: collection has not produced data. Try again later."
        ),
        "stats.header": "📊 Team metrics",
        "stats.outside_hours": "⏱ Outside work hours: {value}%",
        "stats.participation": "🤝 Participation: {value}%",
        "stats.recognition": "🙏 Thanks: {value}%",
        "stats.report": "Open the full report",
        "stats.error": "Could not read the team metrics. Try again later.",
        "share.private_only": "The “Team pulse” card is available only in a private chat with the bot.",
        "share.organizer_only": (
            "Only an organizer whose Telegram account is linked to this team can build the card."
        ),
        "share.no_connection": "The card is unavailable: the bot is not connected to the server.",
        "share.no_period": (
            "There is no published period yet. The card appears once a period closes "
            "and has enough answers."
        ),
        "share.unavailable": "The card is not available yet: the period is not published. Try again later.",
        "share.period_fallback": "this period",
        "share.caption": (
            "📊 Team pulse of {team} for {period}. Try Vibee for your team: {url}"
        ),
        "share.caption_no_name": "📊 Team pulse for {period}. Try Vibee for your team: {url}",
        "share.group_button": "Send to the group",
        "share.group_caption": (
            "📊 Team pulse of {team} for {period}. Details in the dashboard: {url}"
        ),
        "share.group_caption_no_name": (
            "📊 Team pulse for {period}. Details in the dashboard: {url}"
        ),
        "share.group_sent": "The card was sent to the team chat.",
        "share.group_no_chat": "The team chat is not connected yet: there is nowhere to send the card.",
        "share.group_paused": (
            "The card cannot go to the chat right now: collection is paused or consents are missing."
        ),
        "share.group_no_rights": (
            "The bot cannot post to the team chat: check its rights or add the bot to the chat."
        ),
        "share.group_failed": "Could not send the card to the chat. Please try again.",
        "cute.start.private": (
            "Hi there! I'm Vibee 🐝💛\n\n"
            "Want to connect your team? Just send me the room key (e.g. A1B2C3D4).\n\n"
            "Or pick what we're doing below 🌸 About data — /privacy."
        ),
        "cute.onboarding.room_connected": (
            "Great! You're in the team now 🐝✨ Once all colleagues join, we will start collecting metrics 💛"
        ),
        "cute.onboarding.room_prompt": (
            "Want to connect your team? Send me the room key (e.g. A1B2C3D4) 🌸"
        ),
        "cute.question.ask": (
            "{index}/{total} · {question}\n"
            "Rate it 1 to 5, however you feel 🌸 Changed your mind — /stop."
        ),
        "cute.consent.declined": "Okay, declined 💛 The draft is deleted. Menu — /start.",
        "cute.checkin.done.server": (
            "Thank you for sharing! 💛 The check-in is done: the three ratings flew to the server. "
            "The organizer will see only the aggregate summary. Menu — /start."
        ),
        "cute.checkin.done.paused": (
            "The check-in is done, but the server didn't accept it 😔 "
            "Check that you're a team member or message the organizer. Menu — /start."
        ),
        "cute.checkin.done.unknown": (
            "The check-in is done, but delivery couldn't be confirmed 😔 "
            "The answers may not have been saved — try again later. Menu — /start."
        ),
        "cute.checkin.done.demo": (
            "Thank you for sharing! 💛 The demo check-in is done and the answers stayed with us "
            "only. Menu — /start."
        ),
        "cute.stop.with_transport": (
            "Stopped the scenario 💛 The draft and transcription permission are cleared. "
            "Answers already sent are not deleted; use /clean for messages."
        ),
        "cute.stop.without_transport": (
            "Stopped the scenario 💛 The draft and transcription permission are cleared. "
            "Telegram messages stay — use /clean for them."
        ),
        "cute.subscribe.enabled": (
            "Subscription enabled 💛 Notifications about closed published periods will arrive here."
        ),
        "cute.style.saved": "Done: we now talk in “{name}” mode 💛",
        "cute.stats.header": "📊 Team metrics 💛",
        "cute.stats.insufficient": (
            "Not much data for statistics yet 🌱 Invite your colleagues to the chat and it will work!"
        ),
        "cute.stats.unavailable": (
            "The statistics are still brewing 🌸 Check back a little later and I'll show you."
        ),
        "straight.start.private": (
            "Hi. Vibee here. Want to connect your team? Send me the room key (e.g. A1B2C3D4).\n\n"
            "Or pick a scenario — no small talk, it's damn useless. Data — /privacy."
        ),
        "straight.onboarding.room_connected": (
            "Great. You're in the team now. Once all colleagues join, we will start collecting metrics."
        ),
        "straight.onboarding.room_prompt": (
            "Want to connect your team? Throw the 8-character room key here (e.g. A1B2C3D4)."
        ),
        "straight.question.ask": (
            "{index}/{total} · {question}\nRate 1 to 5. Done with it — /stop."
        ),
        "straight.consent.declined": "Fine, declined. The draft is deleted. Menu — /start.",
        "straight.checkin.done.server": (
            "Done. The ratings went to the server. The organizer sees only the aggregate "
            "summary. Menu — /start."
        ),
        "straight.checkin.done.paused": (
            "The check-in is done, but the server rejected it — what a mess. "
            "Check that you're on the team or message the organizer. Menu — /start."
        ),
        "straight.checkin.done.unknown": (
            "The check-in is done, but delivery wasn't confirmed. The answers may be lost — "
            "try again later. Menu — /start."
        ),
        "straight.checkin.done.demo": (
            "Done. The demo check-in is closed and nothing left the bot. Menu — /start."
        ),
        "straight.stop.with_transport": (
            "Stopped. The draft and transcription permission are cleared. "
            "Answers already sent are not deleted; use /clean for messages."
        ),
        "straight.stop.without_transport": (
            "Stopped. The draft and transcription permission are cleared. "
            "Telegram messages stay — use /clean for them."
        ),
        "straight.subscribe.enabled": (
            "Subscription on. Notifications about closed periods will arrive here."
        ),
        "straight.style.saved": "Done. Mode: “{name}”.",
        "straight.stats.header": "📊 Team metrics. No fluff.",
        "straight.stats.insufficient": (
            "Not enough data. Invite your colleagues to the chat — no people, no statistics."
        ),
        "straight.stats.unavailable": (
            "No statistics yet: there is nothing to collect. Come back later."
        ),
        "straight.stats.organizer_only": (
            "Statistics are for the organizer only. Nothing to see here for everyone else."
        ),
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


def style_name(language: object, style: object) -> str:
    """Название режима общения на выбранном языке."""
    code = styles.normalize_style(style) or styles.DEFAULT_STYLE
    return text(language, f"style.name.{code}")


def styled_text(language: object, style: object, key: str, **values: object) -> str:
    """Текст с учётом режима общения; у классика своих строк нет."""
    code = styles.normalize_style(style) or styles.DEFAULT_STYLE
    if code == styles.CLASSIC:
        return text(language, key, **values)
    styled_key = f"{code}.{key}"
    lang = normalize_language(language) or DEFAULT_LANGUAGE
    template = _TEXTS[lang].get(styled_key) or _TEXTS[DEFAULT_LANGUAGE].get(styled_key)
    if template is None:
        return text(language, key, **values)
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
        text(language, "help.guide"),
        text(language, "help.privacy"),
        text(language, "help.stop"),
        text(language, "help.clean"),
        text(language, "help.lang"),
        text(language, "help.style"),
        text(language, "help.stats"),
        text(language, "help.share"),
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
