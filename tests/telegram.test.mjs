import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initialConsentState, transitionConsent, canProcessChat } from '../src/core/telegram.ts'

const apply = (s, e) => transitionConsent(s, e, s.revision)
function ready() {
  let s = apply(initialConsentState(), { type: 'bind', policyVersion: 'synthetic-v1' })
  s = apply(s, { type: 'roster', members: ['a', 'b', 'c'] })
  s = apply(s, { type: 'company', accepted: true })
  for (const memberId of s.roster) s = apply(s, { type: 'decision', memberId, decision: 'accepted' })
  return s
}

test('all verified members and company consent plus explicit resume are required', () => {
  let s = ready()
  assert.equal(canProcessChat(s), false)
  s = apply(s, { type: 'resume' })
  assert.equal(canProcessChat(s), true) // Publication threshold is a separate gate.
  s = apply(s, { type: 'decision', memberId: 'c', decision: 'withdrawn' })
  assert.equal(canProcessChat(s), false)
  assert.throws(() => apply(s, { type: 'resume' }), /CONSENT_REQUIRED/)
  s = apply(s, { type: 'decision', memberId: 'c', decision: 'accepted' })
  assert.equal(canProcessChat(s), false)
})

test('partial roster consent cannot activate; stale buttons cannot undo withdrawal', () => {
  let s = apply(ready(), { type: 'roster', members: ['a', 'b', 'c', 'd'] })
  for (const memberId of ['a', 'b']) s = apply(s, { type: 'decision', memberId, decision: 'accepted' })
  assert.throws(() => apply(s, { type: 'resume' }), /CONSENT_REQUIRED/)
  const revision = s.revision
  s = apply(s, { type: 'decision', memberId: 'a', decision: 'withdrawn' })
  assert.throws(() => transitionConsent(s, { type: 'decision', memberId: 'a', decision: 'accepted' }, revision), /STALE_REVISION/)
})

test('unknown sender, roster and policy changes invalidate consent; input stays immutable', () => {
  const active = apply(ready(), { type: 'resume' })
  for (const event of [
    { type: 'unknown_member' }, { type: 'roster', members: ['a', 'b', 'c', 'd'] },
    { type: 'policy', policyVersion: 'synthetic-v2' }, { type: 'company', accepted: false },
  ]) {
    const next = apply(active, event)
    assert.equal(canProcessChat(next), false)
    assert.throws(() => apply(next, { type: 'resume' }), /CONSENT_REQUIRED/)
  }
  assert.equal(canProcessChat(active), true)
  assert.throws(() => apply(active, { type: 'decision', memberId: 'stranger', decision: 'accepted' }), /UNKNOWN_MEMBER/)
})

test('disconnect and transport pause stop processing; invalid transitions fail closed', () => {
  const active = apply(ready(), { type: 'resume' })
  assert.equal(canProcessChat(apply(active, { type: 'pause' })), false)
  const gone = apply(active, { type: 'disconnect' })
  assert.deepEqual(gone.roster, [])
  assert.throws(() => apply(gone, { type: 'resume' }), /INVALID_TRANSITION/)
  assert.throws(() => apply(active, { type: 'roster', members: ['a', 'a'] }), /INVALID_ROSTER/)
})
