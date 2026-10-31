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

export async function recommendationProviderContent(provider, metrics, timeoutMs = 3000) {
  const context = { metrics: Object.freeze({ ...metrics }) }
  let timer
  try {
    const providerResult = Promise.resolve().then(() => provider.generate(context))
    const content = await Promise.race([
      providerResult,
      new Promise(resolve => { timer = setTimeout(() => resolve(null), timeoutMs) }),
    ])
    if (content && typeof content === 'object' && !Array.isArray(content)
      && Object.keys(content).length === CARD_FIELDS.length
      && Object.keys(content).every(key => CARD_FIELDS.includes(key))
      && CARD_FIELDS.every(key => typeof content[key] === 'string'
        && content[key].trim().length > 0 && content[key].length <= MAX_FIELD_LENGTH)) {
      return Object.fromEntries(CARD_FIELDS.map(key => [key, content[key]]))
    }
  } catch { /* A provider failure must not reveal partial or invented content. */ }
  finally { clearTimeout(timer) }
  return null
}
