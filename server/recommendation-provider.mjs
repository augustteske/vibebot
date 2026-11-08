// The provider receives only published aggregate metrics, never chat text or identities.
const CARD_FIELDS = ['observation', 'explanation', 'limitation', 'action']
const MAX_FIELD_LENGTH = 500
const PROVIDERS = {
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    requiresApiKey: true,
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    requiresApiKey: true,
  },
  ollama: {
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'llama3.2',
    requiresApiKey: false,
  },
}

// Пороги, после которых показатель считается заметным отклонением.
const THRESHOLDS = Object.freeze({
  outsideHoursPercent: 50,
  participationEvenness: 50,
  recognitionPercent: 10,
})

// Насколько показатель ушёл за свой порог: 0 — в норме, 1 — максимально заметно.
function severity(value, threshold, direction) {
  if (direction === 'above') {
    return value > threshold ? (value - threshold) / (100 - threshold) : 0
  }
  return value < threshold ? (threshold - value) / threshold : 0
}

function scheduleCard(metrics) {
  return {
    observation: `Вне рабочих интервалов отправлено ${metrics.outsideHoursPercent}% сообщений периода.`,
    explanation: 'Возможно, часть обсуждений приходится на время вне согласованного расписания.',
    limitation: 'Это доля сообщений, а не оценка нагрузки или благополучия участников; причины неизвестны.',
    action: 'Обсудить с командой удобное время для рабочих сообщений.',
  }
}

function participationCard(metrics) {
  return {
    observation: `Равномерность участия — ${metrics.participationEvenness}%: вклад участников заметно различается.`,
    explanation: 'Возможно, кто-то стал меньше писать из-за загрузки или нехватки контекста.',
    limitation: 'Показатель описывает распределение сообщений, а не вовлечённость или отношение людей; причины неизвестны.',
    action: 'Проверить загрузку команды и уточнить, не нужна ли кому-то поддержка.',
  }
}

function recognitionCard(metrics) {
  return {
    observation: `Благодарности — ${metrics.recognitionPercent}% сообщений периода: это мало.`,
    explanation: 'Возможно, вклад участников остаётся незамеченным.',
    limitation: 'Доля благодарностей зависит от стиля общения и не измеряет реальную поддержку в команде.',
    action: 'Отметить чей-то вклад: короткое «спасибо» за конкретную помощь.',
  }
}

function balancedCard() {
  return {
    observation: 'Заметных отклонений по расписанию, участию и благодарностям нет.',
    explanation: 'Показатели периода держатся в спокойных пределах.',
    limitation: 'Метрики не показывают причин и не оценивают людей; это только повод для разговора.',
    action: 'Продолжать текущий ритм и следить за изменениями.',
  }
}

// Правила проверяются по порядку; при равной заметности выигрывает верхнее.
const TEMPLATE_RULES = Object.freeze([
  { card: scheduleCard, weight: metrics => severity(metrics.outsideHoursPercent, THRESHOLDS.outsideHoursPercent, 'above') },
  { card: participationCard, weight: metrics => severity(metrics.participationEvenness, THRESHOLDS.participationEvenness, 'below') },
  { card: recognitionCard, weight: metrics => severity(metrics.recognitionPercent, THRESHOLDS.recognitionPercent, 'below') },
])

function templateRecommendationCard(metrics) {
  let best = null
  for (const rule of TEMPLATE_RULES) {
    const weight = rule.weight(metrics)
    if (weight > 0 && (best === null || weight > best.weight)) best = { card: rule.card, weight }
  }
  return best ? best.card(metrics) : balancedCard()
}

export const templateRecommendationProvider = Object.freeze({
  source: 'template',
  generate({ metrics }) {
    return templateRecommendationCard(metrics)
  },
})

export function createRecommendationProvider({
  provider = 'template',
  apiKey,
  baseUrl,
  model,
  fetchImpl = fetch,
} = {}) {
  if (provider === 'template') return templateRecommendationProvider
  const config = PROVIDERS[provider]
  if (!config) throw new Error('LLM_PROVIDER must be template, groq, openai, or ollama')
  if (config.requiresApiKey && !apiKey) throw new Error(`LLM_API_KEY is required for ${provider}`)

  const endpoint = `${(baseUrl || config.baseUrl).replace(/\/+$/, '')}/chat/completions`
  return Object.freeze({
    source: 'ai',
    async generate({ metrics }) {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: model || config.model,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: 'Write a concise, cautious team communication recommendation using only the supplied aggregate metrics. Do not diagnose people, infer individual behavior, or claim causation. Return only a JSON object with exactly these string fields: observation, explanation, limitation, action. Each value must be 1-500 characters.',
            },
            { role: 'user', content: JSON.stringify({ metrics }) },
          ],
        }),
        signal: AbortSignal.timeout(2500),
      })
      if (!response.ok) throw new Error('Recommendation provider request failed')
      const payload = await response.json()
      const content = payload?.choices?.[0]?.message?.content
      if (typeof content !== 'string') throw new Error('Recommendation provider returned an invalid response')
      return JSON.parse(content)
    },
  })
}

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
