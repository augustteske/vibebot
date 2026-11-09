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
