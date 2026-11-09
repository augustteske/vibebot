/**
 * Extended analytics engine for team communication metrics.
 *
 * Privacy-preserving server aggregates:
 * - Unanswered questions percentage (messages with '?' that received no response within 24 hours)
 * - Response median time in minutes (median interval between consecutive messages by different authors)
 * - Positivity index (frequency of gratitude, appreciation and encouragement words)
 * - Intensity index (frequency of emotionally charged/slang/swear expressions, counter only, no words persisted)
 * - Work rhythm distribution (aggregate message volume by day-of-week and hour)
 * - Period-over-period comparison trends
 */

export const POSITIVE_WORDS = new Set([
  'спасибо', 'благодарю', 'благодарим', 'отлично', 'супер', 'класс', 'классно',
  'круто', 'здорово', 'молодец', 'молодцы', 'браво', 'огонь', 'топ', 'кайф',
  'плюсую', 'замечательно', 'прекрасно', 'красавчик', 'красава', 'ура',
  'thanks', 'thank', 'great', 'awesome', 'super', 'cool', 'good', 'excellent',
  'amazing', 'kudos', 'cheers', 'nice', 'love', 'perfect',
])

export const INTENSITY_WORDS = new Set([
  'блин', 'капец', 'жесть', 'хрен', 'нафиг', 'пофиг', 'черт', 'чёрт', 'ппц',
  'нахер', 'нах', 'бля', 'блять', 'дерьмо', 'говно', 'мудак', 'херня', 'жопа',
  'ебать', 'пипец', 'офигеть', 'задолбал', 'задолбали', 'отвали',
  'wtf', 'damn', 'hell', 'crap', 'shit', 'fuck', 'asshole', 'freaking', 'fucking', 'bullshit',
])

const DAYS_OF_WEEK = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']

export function roundOne(value) {
  return Math.round(value * 10) / 10
}

function validCount(value) {
  return Number.isSafeInteger(value) && value >= 0
}

/**
 * Checks whether the text contains a question mark.
 */
export function isQuestionMessage(text) {
  if (typeof text !== 'string') return false
  return text.includes('?') || text.includes('¿')
}

/**
 * Computes percentage of questions that remained unanswered.
 */
export function calculateUnansweredQuestionsPercent(unansweredCount, totalQuestionCount) {
  if (!validCount(unansweredCount) || !validCount(totalQuestionCount)) {
    throw new RangeError('Question counts must be non-negative integers')
  }
  if (totalQuestionCount === 0) return 0
  if (unansweredCount > totalQuestionCount) {
    throw new RangeError('Unanswered count cannot exceed total question count')
  }
  return roundOne((100 * unansweredCount) / totalQuestionCount)
}

/**
 * Computes median response time in minutes from an array of deltas in seconds.
 */
export function calculateResponseMedianMinutes(deltasInSeconds) {
  if (!Array.isArray(deltasInSeconds) || deltasInSeconds.length === 0) {
    return null
  }
  const validDeltas = deltasInSeconds.filter(d => typeof d === 'number' && Number.isFinite(d) && d >= 0)
  if (validDeltas.length === 0) return null

  const sorted = [...validDeltas].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const medianSec = sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2

  return roundOne(medianSec / 60)
}

/**
 * Extracts words using Unicode letter matching.
 */
export function extractWords(text) {
  if (typeof text !== 'string') return []
  return Array.from(text.toLowerCase().matchAll(/\p{L}+/gu), m => m[0])
}

/**
 * Checks whether message contains positive / appreciation / support expressions.
 */
export function isPositiveMessage(text) {
  const words = extractWords(text)
  return words.some(w => POSITIVE_WORDS.has(w))
}

/**
 * Computes positivity index (percentage of messages with positive signals).
 */
export function calculatePositivityIndex(positiveCount, totalCount) {
  if (!validCount(positiveCount) || !Number.isSafeInteger(totalCount) || totalCount <= 0 || positiveCount > totalCount) {
    throw new RangeError('Positivity counts must be non-negative integers with positive total')
  }
  return roundOne((100 * positiveCount) / totalCount)
}

/**
 * Checks whether message contains sharp/slang/intense vocabulary.
 */
export function isIntensityMessage(text) {
  const words = extractWords(text)
  return words.some(w => INTENSITY_WORDS.has(w))
}

/**
 * Computes intensity index (percentage of messages with sharp/slang vocabulary).
 */
export function calculateIntensityIndex(intensityCount, totalCount) {
  if (!validCount(intensityCount) || !Number.isSafeInteger(totalCount) || totalCount <= 0 || intensityCount > totalCount) {
    throw new RangeError('Intensity counts must be non-negative integers with positive total')
  }
  return roundOne((100 * intensityCount) / totalCount)
}

/**
 * Initializes a clean activity distribution structure.
 */
export function createActivityDistribution() {
  const byDay = { 'Пн': 0, 'Вт': 0, 'Ср': 0, 'Чт': 0, 'Пт': 0, 'Сб': 0, 'Вс': 0 }
  const byHour = {}
  for (let h = 0; h < 24; h++) byHour[h] = 0
  return { byDay, byHour }
}

/**
 * Increments activity distribution counters for a given timestamp and time zone.
 */
export function recordActivity(distribution, sentAtTimestamp, timeZone = 'UTC') {
  const dist = distribution && distribution.byDay && distribution.byHour
    ? distribution
    : createActivityDistribution()

  try {
    const date = new Date(sentAtTimestamp)
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'UTC',
      weekday: 'short',
      hour: 'numeric',
      hourCycle: 'h23',
    })
    const parts = formatter.formatToParts(date)
    const weekdayPart = parts.find(p => p.type === 'weekday')?.value || 'Mon'
    const hourPart = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10)

    const dayMap = {
      'Mon': 'Пн', 'Tue': 'Вт', 'Wed': 'Ср', 'Thu': 'Чт',
      'Fri': 'Пт', 'Sat': 'Сб', 'Sun': 'Вс',
    }
    const ruDay = dayMap[weekdayPart] || 'Пн'
    dist.byDay[ruDay] = (dist.byDay[ruDay] || 0) + 1
    dist.byHour[hourPart] = (dist.byHour[hourPart] || 0) + 1
  } catch {
    // Fallback to UTC getDay
    const date = new Date(sentAtTimestamp)
    const dayName = DAYS_OF_WEEK[date.getUTCDay()] || 'Пн'
    const hour = date.getUTCHours()
    dist.byDay[dayName] = (dist.byDay[dayName] || 0) + 1
    dist.byHour[hour] = (dist.byHour[hour] || 0) + 1
  }
  return dist
}

/**
 * Computes period-over-period comparison trends.
 */
export function calculateComparisonTrends(current, previous) {
  if (!current || !previous) return null

  const diff = {}

  if (typeof current.outsideHoursPercent === 'number' && typeof previous.outsideHoursPercent === 'number') {
    diff.outsideHoursPercentDiff = roundOne(current.outsideHoursPercent - previous.outsideHoursPercent)
  }
  if (typeof current.participationEvenness === 'number' && typeof previous.participationEvenness === 'number') {
    diff.participationEvennessDiff = roundOne(current.participationEvenness - previous.participationEvenness)
  }
  if (typeof current.recognitionPercent === 'number' && typeof previous.recognitionPercent === 'number') {
    diff.recognitionPercentDiff = roundOne(current.recognitionPercent - previous.recognitionPercent)
  }
  if (typeof current.unansweredQuestionsPercent === 'number' && typeof previous.unansweredQuestionsPercent === 'number') {
    diff.unansweredQuestionsPercentDiff = roundOne(current.unansweredQuestionsPercent - previous.unansweredQuestionsPercent)
  }
  if (typeof current.responseMedianMinutes === 'number' && typeof previous.responseMedianMinutes === 'number') {
    diff.responseMedianMinutesDiff = roundOne(current.responseMedianMinutes - previous.responseMedianMinutes)
  }
  if (typeof current.positivityIndex === 'number' && typeof previous.positivityIndex === 'number') {
    diff.positivityIndexDiff = roundOne(current.positivityIndex - previous.positivityIndex)
  }
  if (typeof current.intensityIndex === 'number' && typeof previous.intensityIndex === 'number') {
    diff.intensityIndexDiff = roundOne(current.intensityIndex - previous.intensityIndex)
  }

  return Object.keys(diff).length > 0 ? diff : null
}

/**
 * Computes the overall Team Health Score (0-100) combining communication metrics.
 * 100 is ideal healthy balance, 0 is critical risk.
 *
 * Base score: 50
 * + High participation (>70): up to +15 pts (low <50: up to -15 pts)
 * + Low outside hours (<20): up to +15 pts (high >30: up to -20 pts)
 * + High positivity/recognition (>10): up to +15 pts (<3: -5 pts)
 * - High intensity/slang (>5): up to -20 pts
 * - High unanswered questions (>20): up to -20 pts (<=10: +5 pts)
 * Clamped strictly to 0..100 integer.
 */
export function calculateTeamHealthScore(metrics) {
  if (!metrics || typeof metrics !== 'object') {
    return 50
  }

  let score = 50

  // 1. Participation evenness (0..100)
  const participation = typeof metrics.participationEvenness === 'number'
    ? metrics.participationEvenness
    : 70
  if (participation > 70) {
    score += Math.min(15, (participation - 70) * 0.5)
  } else if (participation < 50) {
    score -= Math.min(15, (50 - participation) * 0.5)
  }

  // 2. Outside hours percent (0..100)
  const outside = typeof metrics.outsideHoursPercent === 'number'
    ? metrics.outsideHoursPercent
    : 20
  if (outside < 20) {
    score += Math.min(15, (20 - outside) * 0.75)
  } else if (outside > 30) {
    score -= Math.min(20, (outside - 30) * 0.5)
  }

  // 3. Positivity / Recognition (0..100)
  const positive = typeof metrics.positivityIndex === 'number'
    ? metrics.positivityIndex
    : (typeof metrics.recognitionPercent === 'number' ? metrics.recognitionPercent : 10)
  if (positive > 10) {
    score += Math.min(15, (positive - 10) * 0.6)
  } else if (positive < 3) {
    score -= 5
  }

  // 4. Intensity index (0..100)
  const intensity = typeof metrics.intensityIndex === 'number'
    ? metrics.intensityIndex
    : 0
  if (intensity > 5) {
    score -= Math.min(20, (intensity - 5) * 2)
  }

  // 5. Unanswered questions percent (0..100)
  const unanswered = typeof metrics.unansweredQuestionsPercent === 'number'
    ? metrics.unansweredQuestionsPercent
    : 15
  if (unanswered > 20) {
    score -= Math.min(20, (unanswered - 20) * 0.6)
  } else if (unanswered <= 10) {
    score += 5
  }

  return Math.max(0, Math.min(100, Math.round(score)))
}

/**
 * Generates an actionable, targeted checklist (3-5 items) based on team communication metrics and trends.
 *
 * @param {object} metrics - Current team metrics
 * @param {object} [trends] - Period-over-period comparison trends
 * @returns {Array<{ id: string, title: string, description: string, difficulty: 'easy'|'medium'|'hard', estimatedTime: string, isPriority?: boolean }>}
 */
export function generateActionPlan(metrics, trends = null) {
  const safeMetrics = metrics && typeof metrics === 'object' ? metrics : {}
  const safeTrends = trends && typeof trends === 'object' ? trends : (safeMetrics.trends || {})

  const outside = safeMetrics.outsideHoursPercent ?? 20
  const unanswered = safeMetrics.unansweredQuestionsPercent ?? 10
  const participation = safeMetrics.participationEvenness ?? 70
  const positivity = safeMetrics.positivityIndex ?? (safeMetrics.recognitionPercent ?? 15)
  const intensity = safeMetrics.intensityIndex ?? 0
  const responseTime = safeMetrics.responseMedianMinutes ?? null

  const items = []

  // Rule 1: Outside working hours
  if (outside > 30 || safeTrends.outsideHoursPercentDiff > 3) {
    const isPriority = safeTrends.outsideHoursPercentDiff > 0
    items.push({
      id: 'action-outside-hours',
      title: isPriority
        ? '⚠️ Приоритет: Защитить границы рабочего времени'
        : 'Обсудить границы рабочего времени: договориться не писать после 19:00',
      description: 'Договориться не писать в чат после 19:00 и включить тихий режим уведомлений, чтобы снизить усталость команды.',
      difficulty: 'easy',
      estimatedTime: '10 минут',
      isPriority,
    })
  }

  // Rule 2: Unanswered questions
  if (unanswered > 20 || safeTrends.unansweredQuestionsPercentDiff > 2) {
    const isPriority = safeTrends.unansweredQuestionsPercentDiff > 0
    items.push({
      id: 'action-unanswered-questions',
      title: isPriority
        ? '⚠️ Приоритет: Снизить число повисших вопросов'
        : 'Выделить 15 минут в день на ответы на вопросы коллег',
      description: 'Ввести короткое фиксированное окно (например, в 11:30 или 16:00), когда каждый участник бегло проверяет чат и отвечает на теги.',
      difficulty: 'easy',
      estimatedTime: '15 минут',
      isPriority,
    })
  }

  // Rule 3: Low positivity / recognition
  if (positivity < 10 || safeTrends.positivityIndexDiff < 0 || safeTrends.recognitionPercentDiff < 0) {
    const isPriority = (safeTrends.positivityIndexDiff < 0 || safeTrends.recognitionPercentDiff < 0)
    items.push({
      id: 'action-positivity',
      title: isPriority
        ? '⚠️ Приоритет: Ввести практику благодарности'
        : 'Ввести практику благодарности: в конце недели отмечать вклад коллег',
      description: 'В пятницу в общем чате или на демо отмечать конкретный вклад коллег и говорить спасибо за выручку и поддержку.',
      difficulty: 'easy',
      estimatedTime: '10 минут',
      isPriority,
    })
  }

  // Rule 4: Participation unevenness
  if (participation < 55 || safeTrends.participationEvennessDiff < -3) {
    const isPriority = safeTrends.participationEvennessDiff < 0
    items.push({
      id: 'action-participation',
      title: isPriority
        ? '⚠️ Приоритет: Разобраться с тишиной в обсуждениях'
        : 'Провести ретроспективу: почему некоторые коллеги молчат?',
      description: 'Обсудить на ретро, почему часть команды не участвует в чате: возможно, каналы перегружены или не хватает адресных вопросов.',
      difficulty: 'medium',
      estimatedTime: '30 минут',
      isPriority,
    })
  }

  // Rule 5: High intensity / emotional charge
  if (intensity > 4 || safeTrends.intensityIndexDiff > 1) {
    const isPriority = safeTrends.intensityIndexDiff > 0
    items.push({
      id: 'action-intensity',
      title: isPriority
        ? '⚠️ Приоритет: Разрядить эмоциональный накал'
        : 'Перевести спорные вопросы в созвоны 1-on-1',
      description: 'Перевести накопившиеся разногласия из общего текстового чата в короткий созвон тет-а-тет, чтобы снять напряжение.',
      difficulty: 'medium',
      estimatedTime: '20 минут',
      isPriority,
    })
  }

  // Rule 6: Slow response time
  if (responseTime !== null && (responseTime > 20 || safeTrends.responseMedianMinutesDiff > 5)) {
    const isPriority = safeTrends.responseMedianMinutesDiff > 0
    items.push({
      id: 'action-response-speed',
      title: isPriority
        ? '⚠️ Приоритет: Синхронизировать ожидания по скорости ответа'
        : 'Синхронизировать ожидания по скорости ответа',
      description: 'Определить, какие каналы требуют быстрого ответа (до 15 минут), а какие допускают асинхронную реакцию в течение полудня.',
      difficulty: 'easy',
      estimatedTime: '15 минут',
      isPriority,
    })
  }

  // Default / proactive improvements if fewer than 3 items
  const fallbacks = [
    {
      id: 'action-kudos-board',
      title: 'Запустить виртуальную доску признания (Kudos Board)',
      description: 'Создать закреплённое сообщение в чате для спонтанных спасиб и тёплых отзывов о совместных победах.',
      difficulty: 'easy',
      estimatedTime: '10 минут',
      isPriority: false,
    },
    {
      id: 'action-team-rules',
      title: 'Описать правила командной гигиены общения в Notion/Wiki',
      description: 'Зафиксировать текущие отличные договорённости: тихие часы, шаблон формулировки вопросов и правила тегов.',
      difficulty: 'medium',
      estimatedTime: '25 минут',
      isPriority: false,
    },
    {
      id: 'action-coffee-break',
      title: 'Устроить неформальный 15-минутный coffee-break',
      description: 'Провести легкий созвон без рабочих повесток, чтобы пообщаться на свободные темы и укрепить доверие.',
      difficulty: 'easy',
      estimatedTime: '15 минут',
      isPriority: false,
    },
    {
      id: 'action-retro-celebrate',
      title: 'Отпраздновать высокий командный индекс на ретро',
      description: 'Подвести итоги недели и похвалить команду за высокий комфорт общения и зрелый ритм.',
      difficulty: 'easy',
      estimatedTime: '10 минут',
      isPriority: false,
    },
  ]

  for (const fallback of fallbacks) {
    if (items.length >= 3) break
    if (!items.some(i => i.id === fallback.id)) {
      items.push(fallback)
    }
  }

  // Sort priority items first, then limit to at most 5 items
  items.sort((a, b) => (b.isPriority ? 1 : 0) - (a.isPriority ? 1 : 0))

  return items.slice(0, 5)
}
