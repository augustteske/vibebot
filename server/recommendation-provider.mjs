// The provider receives only published aggregate metrics, never chat text or identities.
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
    if (content && ['observation', 'explanation', 'limitation', 'action']
      .every(key => typeof content[key] === 'string' && content[key].length > 0)) {
      return Object.fromEntries(['observation', 'explanation', 'limitation', 'action']
        .map(key => [key, content[key]]))
    }
  } catch { /* A provider failure must not reveal partial or invented content. */ }
  return templateRecommendationProvider.generate(context)
}
