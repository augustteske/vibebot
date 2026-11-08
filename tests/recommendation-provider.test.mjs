import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createRecommendationProvider,
  recommendationProviderContent,
  templateRecommendationProvider,
} from '../server/recommendation-provider.mjs'

const metrics = { outsideHoursPercent: 25, participationEvenness: 89.8, recognitionPercent: 20 }
const recommendation = {
  observation: 'Aggregate observation',
  explanation: 'Possible explanation',
  limitation: 'No causal conclusion',
  action: 'Discuss a small change',
}

test('template provider remains the default without external calls', () => {
  const provider = createRecommendationProvider()
  assert.equal(provider.generate, templateRecommendationProvider.generate)
  assert.equal(provider.source, 'template')
})

test('OpenAI-compatible providers receive only published metrics', async () => {
  let request
  const provider = createRecommendationProvider({
    provider: 'groq',
    apiKey: 'test-key',
    fetchImpl: async (url, options) => {
      request = { url, options }
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(recommendation) } }] }) }
    },
  })

  assert.equal(provider.source, 'ai')
  assert.deepEqual(await provider.generate({ metrics }), recommendation)
  assert.equal(request.url, 'https://api.groq.com/openai/v1/chat/completions')
  assert.equal(request.options.headers.Authorization, 'Bearer test-key')
  const body = JSON.parse(request.options.body)
  assert.equal(body.model, 'llama-3.3-70b-versatile')
  assert.deepEqual(JSON.parse(body.messages[1].content), { metrics })
  assert.equal(JSON.stringify(body).includes('message text'), false)
})

test('provider configuration validates its name and required API key', () => {
  assert.throws(() => createRecommendationProvider({ provider: 'unknown' }), /LLM_PROVIDER/)
  assert.throws(() => createRecommendationProvider({ provider: 'openai' }), /LLM_API_KEY/)
  assert.doesNotThrow(() => createRecommendationProvider({ provider: 'ollama' }))
})

test('invalid provider response falls back to the template at the store boundary', async () => {
  const provider = createRecommendationProvider({
    provider: 'openai',
    apiKey: 'test-key',
    fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'not json' } }] }) }),
  })
  assert.equal(await recommendationProviderContent(provider, metrics), null)
})

test('schedule template is chosen when most messages are outside working hours', () => {
  const card = templateRecommendationProvider.generate({
    metrics: { ...metrics, outsideHoursPercent: 62 },
  })
  assert.match(card.observation, /Вне рабочих интервалов отправлено 62%/)
  assert.equal(card.action, 'Обсудить с командой удобное время для рабочих сообщений.')
})

test('participation template is chosen when contributions are uneven', () => {
  const card = templateRecommendationProvider.generate({
    metrics: { ...metrics, participationEvenness: 41 },
  })
  assert.match(card.observation, /Равномерность участия — 41%/)
  assert.match(card.explanation, /меньше писать/)
  assert.match(card.action, /загрузку/)
})

test('recognition template is chosen when thanks are rare', () => {
  const card = templateRecommendationProvider.generate({
    metrics: { ...metrics, recognitionPercent: 4 },
  })
  assert.match(card.observation, /Благодарности — 4%/)
  assert.match(card.explanation, /остаётся незамеченным/)
  assert.match(card.action, /спасибо/)
})

test('the most noticeable metric wins when several are out of range', () => {
  const uneven = templateRecommendationProvider.generate({
    metrics: { outsideHoursPercent: 60, participationEvenness: 10, recognitionPercent: 5 },
  })
  assert.match(uneven.observation, /Равномерность участия/)

  const rareThanks = templateRecommendationProvider.generate({
    metrics: { outsideHoursPercent: 60, participationEvenness: 49, recognitionPercent: 0 },
  })
  assert.match(rareThanks.observation, /Благодарности/)
})

test('thresholds are strict and in-range metrics give a balanced card', () => {
  const card = templateRecommendationProvider.generate({
    metrics: { outsideHoursPercent: 50, participationEvenness: 50, recognitionPercent: 10 },
  })
  assert.match(card.observation, /Заметных отклонений/)
})

test('every template branch passes the recommendation field validation', async () => {
  const scenarios = [
    metrics,
    { ...metrics, outsideHoursPercent: 80 },
    { ...metrics, participationEvenness: 20 },
    { ...metrics, recognitionPercent: 0 },
  ]
  for (const scenario of scenarios) {
    assert.notEqual(await recommendationProviderContent(templateRecommendationProvider, scenario), null)
  }
})

