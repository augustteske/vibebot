import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

test('share card: short period, text version and button only for published aggregates', async t => {
  const vite = await createServer({ server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
  t.after(() => vite.close())
  const share = await vite.ssrLoadModule('/src/features/insights/shareCard.ts')
  const { TeamPulse } = await vite.ssrLoadModule('/src/features/insights/TeamPulse.tsx')

  assert.equal(share.formatSharePeriod('2026-11-05T06:00:00.000Z', '2026-11-12T06:00:00.000Z', 'UTC'), '5–12 ноября')
  assert.equal(share.formatSharePeriod('2026-10-28T06:00:00.000Z', '2026-11-03T06:00:00.000Z', 'UTC'), '28 октября – 3 ноября')
  assert.equal(share.formatSharePeriod('2026-11-02T03:00:00.000Z', '2026-11-02T04:00:00.000Z', 'UTC'), '2 ноября')
  assert.equal(share.formatSharePeriod('2026-12-29T06:00:00.000Z', '2027-01-04T06:00:00.000Z', 'UTC'), '29 декабря 2026 – 4 января 2027')

  const text = share.shareCardText({
    periodLabel: '5–12 ноября', teamName: 'Дизайнеры', demo: true,
    metrics: { outsideHoursPercent: 25, participationEvenness: 89.8, recognitionPercent: 20 },
  })
  assert.match(text, /Пульс команды «Дизайнеры» · 5–12 ноября/)
  assert.match(text, /Вне рабочих часов: 25%/)
  assert.match(text, /Равномерность участия: 89,8%/)
  assert.match(text, /Благодарности: 20%/)
  assert.match(text, /Демо: вымышленные данные/)
  assert.match(text, /Почувствовать команду\. Сделать следующий шаг\./)

  const period = { id: 'synthetic', start: '2026-11-05T06:00:00.000Z', end: '2026-11-12T06:00:00.000Z' }
  const render = view => renderToStaticMarkup(createElement(TeamPulse, { view, loading: false, error: null, onRetry() {} }))
  const published = render({ status: 'published', period, demo: true,
    metrics: { outsideHoursPercent: 25, participationEvenness: 89, recognitionPercent: 20 } })
  assert.match(published, /share-card-trigger/)
  assert.match(published, /Поделиться/)
  for (const status of ['insufficient', 'calibrating', 'open', 'paused']) {
    assert.doesNotMatch(render({ status }), /share-card-trigger/)
  }
})
