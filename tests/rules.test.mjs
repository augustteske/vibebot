import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aggregateRound } from '../src/core/rules.ts'
const good = { energy: 4, clarity: 4, support: 4 }
const low = { energy: 4, clarity: 2, support: 4 }
test('four participants: no values or needs are exposed', () => {
  assert.deepEqual(aggregateRound({ closed: true, answers: Array(4).fill(low) }), { status: 'insufficient' })
})
test('open round suppresses results even with sufficient responses', () => {
  assert.deepEqual(aggregateRound({ closed: false, answers: Array(6).fill(low) }), { status: 'open' })
})
test('40 percent inclusive threshold triggers only the appropriate dimension', () => {
  const result = aggregateRound({ closed: true, answers: [low, low, good, good, good] })
  assert.equal(result.status, 'published')
  assert.deepEqual(result.needs, ['clarity'])
  assert.equal(result.means.clarity, 3.2)
})
test('below 40 percent does not trigger a need', () => {
  const result = aggregateRound({ closed: true, answers: [low, good, good, good, good] })
  assert.deepEqual(result.needs, [])
})
test('invalid input is rejected', () => {
  assert.throws(() => aggregateRound({ closed: true, answers: Array(5).fill({ ...good, energy: 6 }) }))
})
