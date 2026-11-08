import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

test('weekly pulse renders real periods and hides insufficient, calibrating and paused metrics', async t => {
  const vite = await createServer({ server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
  t.after(() => vite.close())
  const { PulseHistory, TeamPulse } = await vite.ssrLoadModule('/src/features/insights/TeamPulse.tsx')
  const period = { id: 'synthetic', start: '2026-11-02T03:00:00.000Z', end: '2026-11-02T04:00:00.000Z' }
  const history = { status: 'active', demo: true, window: period, periods: [] }
  const render = data => renderToStaticMarkup(createElement(PulseHistory, { history: data }))
  assert.match(render(history), /нет сохранённых закрытых периодов/)
  for (const status of ['calibrating', 'insufficient']) {
    const html = render({ ...history, periods: [{ status, period }] })
    assert.match(html, /2 ноября 2026/)
    assert.doesNotMatch(html, /team-pulse__values|%|<details/)
  }
  const published = { status: 'published', period, demo: true,
    metrics: { outsideHoursPercent: 25, participationEvenness: 89.8, recognitionPercent: 20 } }
  const html = render({ ...history, periods: [published] })
  assert.match(html, /25%/)
  assert.match(html, /89\.8%/)
  assert.match(html, /20%/)
  assert.match(html, /<details open/)
  assert.match(html, /Демо/)
  assert.match(html, /share-card-trigger/)
  assert.doesNotMatch(render({ ...history, status: 'paused', periods: [published] }), /25%|89\.8%|20%|<details|share-card-trigger/)
  const current = renderToStaticMarkup(createElement(TeamPulse, {
    view: { status: 'insufficient' }, loading: false, error: null, onRetry() {},
  }))
  assert.match(current, /<option value="week">Неделя/)
  assert.match(current, /<option value="month" disabled/)
  assert.doesNotMatch(current, /share-card-trigger/)
})
