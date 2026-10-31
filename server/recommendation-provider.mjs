// The provider receives only published aggregate metrics, never chat text or identities.
const CARD_FIELDS = ['observation', 'explanation', 'limitation', 'action']
const MAX_FIELD_LENGTH = 500

export const templateRecommendationProvider = Object.freeze({
  generate({ metrics }) {
    return {
      observation: `Вне рабочих интервалов отправлено ${metrics.outsideHoursPercent}% сообщений периода.`,
      explanation: 'Возможно, часть обсуждений приходится на время вне согласованного расписания.',
      limitation: 'Это доля сообщений, а не оценка нагрузки или благополучия участников; причины неизвестны.',
      action: 'Обсудить с командой удобное время для рабочих сообщений.',
    }
  },
})

export function templateRecommendationContent(provider, metrics) {
  const context = { metrics: Object.freeze({ ...metrics }) }
  try {
    const content = provider.generate(context)
    if (content && typeof content === 'object' && !Array.isArray(content)
      && Object.keys(content).length === CARD_FIELDS.length
      && Object.keys(content).every(key => CARD_FIELDS.includes(key))
      && CARD_FIELDS.every(key => typeof content[key] === 'string'
        && content[key].trim().length > 0 && content[key].length <= MAX_FIELD_LENGTH)) {
      return Object.fromEntries(CARD_FIELDS.map(key => [key, content[key]]))
    }
  } catch { /* A provider failure must not reveal partial or invented content. */ }
  return templateRecommendationProvider.generate(context)
}
