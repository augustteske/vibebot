import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as share from '../src/features/insights/shareCard.ts'

test('share card: short period and text version for published aggregates', () => {
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
})
