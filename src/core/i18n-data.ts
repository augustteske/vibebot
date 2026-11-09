export type Language = 'ru' | 'en'

export const LANGUAGE_STORAGE_KEY = 'vibee:lang'

export function readLanguage(): Language {
  if (typeof window === 'undefined') return 'ru'
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
    if (stored === 'ru' || stored === 'en') return stored
    const browserLang = (window.navigator?.language || '').toLowerCase()
    return browserLang.startsWith('en') ? 'en' : 'ru'
  } catch {
    return 'ru'
  }
}

export function applyLanguage(lang: Language, persist = true): void {
  if (typeof window === 'undefined') return
  if (persist) {
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang)
    } catch {}
  }
  document.documentElement.lang = lang
  window.dispatchEvent(new CustomEvent('vibee-language-change', { detail: { lang } }))
}

export interface ContrastPairItem {
  id: string
  beforeTitle: string
  beforeText: string
  beforeDetail: string
  afterTitle: string
  afterText: string
  afterDetail: string
}

export interface FeatureItem {
  number: string
  title: string
  description: string
  icon: string
}

export interface StepItem {
  number: string
  label: string
  title: string
  description: string
}

export const translations = {
  ru: {
    nav: {
      ariaLabel: 'Навигация по странице',
      features: 'Преимущества',
      howItWorks: 'Как это работает',
      guide: 'Как подключить?',
      enter: 'Войти в кабинет',
    },
    hero: {
      eyebrow: 'VIBEE · ДЛЯ КОМАНД',
      titleBefore: 'Общайтесь.',
      titleHighlight: 'Замечайте главное.',
      lead: 'Общие сигналы помогают команде обсуждать рабочий ритм, выбирать бережные шаги и вместе проверять, что изменилось.',
      enterCta: 'Войти в кабинет',
      guideLink: 'Как подключить?',
      demoLink: 'Посмотреть демо',
      demoNote: 'Демонстрация на вымышленных данных',
      roomKeyLabel: 'У меня есть ключ комнаты',
      roomKeyPlaceholder: 'Код от тимлида (напр. A1B2C3D4)',
      roomKeySubmit: 'Войти',
      floatTop: 'Решения — за командой',
      floatBottom: 'Только общие сигналы',
    },
    contrast: {
      eyebrow: 'ПРОБЛЕМА → РЕШЕНИЕ',
      titleBefore: 'Было — хаос.',
      titleHighlight: 'Стало — ясность.',
      lead: 'Выберите любую ситуацию или переключите режим сравнения, чтобы увидеть, как меняется командный ритм.',
      tabSplit: 'Было / Стало',
      tabBefore: 'Было: проблема',
      tabAfter: 'Стало: решение',
      beforeBadge: 'БЫЛО · ПРОБЛЕМА',
      afterBadge: 'СТАЛО · РЕШЕНИЕ VIBEE',
      beforeHeader: 'Было: хаос в чатах, непонятные задачи',
      afterHeader: 'Стало: понятные метрики и рекомендации',
      videoPlaceholderTitle: 'Видео подключения',
      videoPlaceholderBadge: 'демо · без звука',
      ariaBefore: (idx: number, title: string) => `Было 0${idx + 1}: ${title}`,
      ariaAfter: (idx: number, title: string) => `Стало 0${idx + 1}: ${title}`,
    },
    features: {
      eyebrow: 'ПРИНЦИПЫ VIBEE',
      titleBefore: 'Больше ясности.',
      titleHighlight: 'Меньше шума.',
      lead: 'Инструменты для общего разговора — не для наблюдения за отдельными людьми.',
    },
    howItWorks: {
      eyebrow: 'ПРОСТОЙ ПУТЬ',
      titleBefore: 'От согласия',
      titleHighlight: 'к общему шагу.',
      lead: 'Каждый этап понятен участникам, а решение о следующем действии принимает сама команда.',
    },
    privacy: {
      eyebrow: 'ПРИВАТНОСТЬ И БЕЗОПАСНОСТЬ',
      titleBefore: 'Нет согласия —',
      titleHighlight: 'нет сбора.',
      lead: 'Мы не читаем переписку без разрешения. Участие абсолютно добровольное: каждый участник может отозвать согласие в любой момент — и мы сразу остановим анализ и удалим данные.',
      lockAriaLocked: 'Замок надёжно заблокирован. Нажмите, чтобы открыть и зафиксировать заново',
      lockAriaUnlocked: 'Замок открыт',
      lockTitle: 'Нажмите, чтобы проверить жест закрытия замка',
      lockBadgeLocked: '🔒 Защищено',
      lockBadgeUnlocked: '🔓 Нажмите',
      card1Title: 'Только агрегаты',
      card1Text: 'Никаких персональных рейтингов и оценок — команда видит только допустимые сводные метрики.',
      card2Title: 'Мгновенный отзыв',
      card2Text: 'Команда /stop в боте или кнопка в кабинете мгновенно стирает черновики и останавливает сбор.',
      card3Title: 'Защитный порог',
      card3Text: 'При менее 5 участниках метрики скрываются, чтобы защитить приватность каждого голоса.',
      note: 'Строгое соблюдение приватности: данные не передаются третьим сторонам и не используются для обучения внешних моделей.',
    },
    footer: {
      brandAria: 'Vibee — наверх',
      note: 'Общие сигналы. Решения — за командой.',
      documentation: 'Документация',
      license: 'MIT License',
    },
  },
  en: {
    nav: {
      ariaLabel: 'Page navigation',
      features: 'Features',
      howItWorks: 'How it works',
      guide: 'How to connect?',
      enter: 'Open Workspace',
    },
    hero: {
      eyebrow: 'VIBEE · FOR TEAMS',
      titleBefore: 'Communicate.',
      titleHighlight: 'Notice what matters.',
      lead: 'Shared signals help your team discuss work rhythm, take mindful steps, and verify progress together.',
      enterCta: 'Open Workspace',
      guideLink: 'How to connect?',
      demoLink: 'Explore Demo',
      demoNote: 'Demonstration with synthetic data',
      roomKeyLabel: 'I have a room key',
      roomKeyPlaceholder: 'Code from team lead (e.g. A1B2C3D4)',
      roomKeySubmit: 'Enter',
      floatTop: 'Decisions by the team',
      floatBottom: 'Shared signals only',
    },
    contrast: {
      eyebrow: 'PROBLEM → SOLUTION',
      titleBefore: 'Before — chaos.',
      titleHighlight: 'Now — clarity.',
      lead: 'Choose any scenario or toggle the view mode to see how the team rhythm changes.',
      tabSplit: 'Before / After',
      tabBefore: 'Before: problem',
      tabAfter: 'Now: solution',
      beforeBadge: 'BEFORE · THE PROBLEM',
      afterBadge: 'NOW · VIBEE SOLUTION',
      beforeHeader: 'Before: chat chaos and blurred tasks',
      afterHeader: 'Now: clear metrics & recommendations',
      videoPlaceholderTitle: 'Integration walkthrough',
      videoPlaceholderBadge: 'demo · muted',
      ariaBefore: (idx: number, title: string) => `Before 0${idx + 1}: ${title}`,
      ariaAfter: (idx: number, title: string) => `Now 0${idx + 1}: ${title}`,
    },
    features: {
      eyebrow: 'VIBEE PRINCIPLES',
      titleBefore: 'More clarity.',
      titleHighlight: 'Less noise.',
      lead: 'Tools for shared conversation — never for observing individuals.',
    },
    howItWorks: {
      eyebrow: 'SIMPLE PATH',
      titleBefore: 'From consent',
      titleHighlight: 'to a shared step.',
      lead: 'Every phase is clear to members, and the team makes its own decisions.',
    },
    privacy: {
      eyebrow: 'PRIVACY & SECURITY',
      titleBefore: 'No consent —',
      titleHighlight: 'no data collection.',
      lead: 'We never inspect chats without permission. Participation is strictly voluntary: any member can revoke consent at any time, immediately stopping analysis and deleting data.',
      lockAriaLocked: 'Lock is securely engaged. Click to unlock and re-engage',
      lockAriaUnlocked: 'Lock is open',
      lockTitle: 'Click to test the lock closure animation',
      lockBadgeLocked: '🔒 Protected',
      lockBadgeUnlocked: '🔓 Click',
      card1Title: 'Aggregates only',
      card1Text: 'Zero personal ratings or rankings — the team only ever sees privacy-safe aggregate metrics.',
      card2Title: 'Instant revocation',
      card2Text: 'The /stop command in the bot or a button in the workspace immediately clears drafts and stops collection.',
      card3Title: 'Protection threshold',
      card3Text: 'With fewer than 5 members, metrics remain strictly hidden to safeguard individual privacy.',
      note: 'Strict privacy compliance: data is never shared with third parties or used to train external models.',
    },
    footer: {
      brandAria: 'Vibee — to top',
      note: 'Shared signals. Decisions belong to the team.',
      documentation: 'Documentation',
      license: 'MIT License',
    },
  },
}

export const localizedFeatures: Record<Language, FeatureItem[]> = {
  ru: [
    {
      number: '01',
      title: 'Только общая картина',
      description: 'Показатели помогают заметить динамику команды — без персональных рейтингов и оценки отдельных людей.',
      icon: '↗',
    },
    {
      number: '02',
      title: 'Рекомендации — повод обсудить',
      description: 'Шаблонная гипотеза предлагает небольшой следующий шаг. Решение всегда остаётся за командой.',
      icon: '✳',
    },
    {
      number: '03',
      title: 'Обратная связь замыкает цикл',
      description: 'Команда отмечает, помог ли выбранный шаг, и использует этот опыт для следующего обсуждения.',
      icon: '✓',
    },
  ],
  en: [
    {
      number: '01',
      title: 'The big picture only',
      description: 'Signals illuminate team trends without individual rankings or performance appraisals.',
      icon: '↗',
    },
    {
      number: '02',
      title: 'Suggestions to spark discussion',
      description: 'A template hypothesis suggests a small next step. The final decision always belongs to the team.',
      icon: '✳',
    },
    {
      number: '03',
      title: 'Feedback closes the loop',
      description: 'The team rates whether the action helped, carrying that insight into the next round.',
      icon: '✓',
    },
  ],
}

export const localizedContrastPairs: Record<Language, ContrastPairItem[]> = {
  ru: [
    {
      id: 'focus',
      beforeTitle: 'Размытые приоритеты в потоке чатов',
      beforeText: 'Десятки параллельных обсуждений и срочных пингов: к середине дня непонятно, какая задача действительно главная.',
      beforeDetail: 'Хаотичные переписки отнимают время команды. Люди переключаются между тредами и теряют контекст важных договорённостей.',
      afterTitle: 'Понятный фокус на день',
      afterText: 'Короткий чек-ин и сводка показывают уровень ясности приоритетов и помогают команде выбрать одну главную цель.',
      afterDetail: 'Один вопрос утром задаёт единый фокус всей команде. В чате появляется прозрачность: каждый понимает приоритеты на сегодня.',
    },
    {
      id: 'rhythm',
      beforeTitle: 'Незаметная усталость и переработки',
      beforeText: 'Ночные сообщения и неравномерная вовлечённость видны только постфактум, когда у людей уже закончился ресурс.',
      beforeDetail: 'Поздние ответы создают негласное давление отвечать 24/7. Команда незаметно выгорает, а тимлид узнаёт об этом слишком поздно.',
      afterTitle: 'Бережные командные метрики',
      afterText: 'Агрегаты без личных рейтингов подсвечивают долю сообщений вне расписания, равномерность участия и уровень поддержки.',
      afterDetail: 'Анонимная агрегация фиксирует баланс общения и мягко сигнализирует о перегрузке без слежки за конкретными людьми.',
    },
    {
      id: 'action',
      beforeTitle: 'Обсуждения без конкретного шага',
      beforeText: 'Проблемы озвучиваются на созвонах, но теряются в переписке без понятной договорённости и проверки результата.',
      beforeDetail: 'Ретроспективы превращаются в бесконечные разговоры: много жалоб, но никто не фиксирует одно простое действие на следующую неделю.',
      afterTitle: 'Готовая рекомендация и обратная связь',
      afterText: 'Vibee предлагает конкретный следующий шаг по самому заметному сигналу, а команда отмечает, принёс ли он пользу.',
      afterDetail: 'Готовые шаблоны гипотез и голосование за 10 секунд: команда выбирает шаг и через неделю проверяет, стало ли лучше.',
    },
  ],
  en: [
    {
      id: 'focus',
      beforeTitle: 'Blurred priorities in chat noise',
      beforeText: 'Dozens of threads and urgent pings: by midday, nobody knows what task is truly most important.',
      beforeDetail: 'Chaotic chat threads drain the team. People jump between conversations and lose context on core agreements.',
      afterTitle: 'Clear focus for the day',
      afterText: 'A brief check-in and summary highlight clarity levels and help the team commit to one primary goal.',
      afterDetail: 'One morning question aligns the entire team. Transparent chats ensure everyone knows the day’s top priority.',
    },
    {
      id: 'rhythm',
      beforeTitle: 'Creeping exhaustion and overtime',
      beforeText: 'Late-night messages and lopsided participation only become visible once burn-out has already set in.',
      beforeDetail: 'Late replies create implicit 24/7 pressure. The team silently exhausts itself before leads notice.',
      afterTitle: 'Mindful team metrics',
      afterText: 'Safe aggregates spotlight off-hours messaging ratios, participation balance, and support levels.',
      afterDetail: 'Anonymous aggregation gently flags overload and restores communication balance without individual surveillance.',
    },
    {
      id: 'action',
      beforeTitle: 'Talks without concrete actions',
      beforeText: 'Issues are voiced on calls but dissolve in chat without a tangible commitment or accountability.',
      beforeDetail: 'Retrospectives turn into venting sessions: lots of complaints, but no single concrete step for the next week.',
      afterTitle: 'Actionable steps and feedback',
      afterText: 'Vibee suggests a focused next step from the strongest signal, and the team evaluates its helpfulness.',
      afterDetail: 'Turnkey hypothesis templates and 10-second polls: pick an action and check next week if things improved.',
    },
  ],
}

export const localizedSteps: Record<Language, StepItem[]> = {
  ru: [
    {
      number: '01',
      label: 'СНАЧАЛА СОГЛАСИЕ',
      title: 'Подключите чат',
      description: 'Участие начинается только после согласия компании и каждого участника группы.',
    },
    {
      number: '02',
      label: 'ЗАТЕМ — ДАННЫЕ',
      title: 'Дождитесь периода',
      description: 'Система проверяет, достаточно ли сообщений для допустимых общих показателей.',
    },
    {
      number: '03',
      label: 'РЕШЕНИЕ ЗА КОМАНДОЙ',
      title: 'Обсудите сводку',
      description: 'В чате появляется сводка и карточка рекомендации для следующего шага.',
    },
    {
      number: '04',
      label: 'ОБРАТНАЯ СВЯЗЬ',
      title: 'Оцените пользу',
      description: 'Через несколько дней бот спросит, помогло ли действие.',
    },
  ],
  en: [
    {
      number: '01',
      label: 'CONSENT FIRST',
      title: 'Connect the chat',
      description: 'Participation only starts after consent from the organization and every group member.',
    },
    {
      number: '02',
      label: 'THEN — DATA',
      title: 'Wait for the period',
      description: 'The system verifies that enough messages exist to produce safe, aggregate metrics.',
    },
    {
      number: '03',
      label: 'DECISION BY TEAM',
      title: 'Discuss the summary',
      description: 'The chat receives an aggregate summary and an actionable recommendation card.',
    },
    {
      number: '04',
      label: 'FEEDBACK LOOP',
      title: 'Rate the outcome',
      description: 'A few days later, the bot asks whether the agreed action actually helped.',
    },
  ],
}
