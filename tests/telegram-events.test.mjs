import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createApp } from '../server/app.mjs'
import { createStore } from '../server/store.mjs'
import { initialConsentState, transitionConsent } from '../src/core/telegram.ts'

const secret = 'synthetic-telegram-events-test-secret-not-production'
const credential = '7'.repeat(64)
const policyVersion = 'synthetic-v1'
const bindingId = '11111111-1111-4111-8111-111111111111'
const eventId = '22222222-2222-4222-8222-222222222222'
const chatId = '-100000000001'

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'vibee-telegram-events-'))
  const dbPath = join(dir, 'synthetic.sqlite')
  const store = createStore({ path: dbPath, secret })
  const ownerToken = store.createWorkspace({ name: 'demo_binding_1', displayName: 'Synthetic owner' })
  const owner = store.authenticate(ownerToken)
  const people = [owner]
  for (let i = 1; i < 6; i++) {
    const token = store.join({
      token: store.invite(owner).token,
      displayName: `Synthetic member ${i}`,
    })
    people.push(store.authenticate(token))
  }
  store.close()

  const db = new DatabaseSync(dbPath)
  const state0 = transitionConsent(initialConsentState(), { type: 'bind', policyVersion }, 0)
  const state1 = transitionConsent(state0, { type: 'roster', members: people.map(person => person.id) }, state0.revision)
  const state2 = transitionConsent(state1, { type: 'company', accepted: true }, state1.revision)
  let state = state2
  for (const person of people) {
    state = transitionConsent(state, {
      type: 'decision',
      memberId: person.id,
      decision: 'accepted',
    }, state.revision)
  }
  state = transitionConsent(state, { type: 'resume' }, state.revision)

  db.prepare('INSERT INTO telegram_bindings(id,workspace_id,chat_id,state) VALUES(?,?,?,?)')
    .run(bindingId, owner.workspace_id, chatId, JSON.stringify(state))
  for (let i = 0; i < people.length; i++) {
    db.prepare('INSERT INTO telegram_links VALUES(?,?,?,?)')
      .run(bindingId, owner.workspace_id, people[i].id, String(300000001 + i))
  }
  db.prepare('INSERT INTO telegram_credentials(token_hash,workspace_id,binding_id) VALUES(?,?,?)')
    .run(createHash('sha256').update(credential).digest('hex'), owner.workspace_id, bindingId)

  const app = createApp({ dbPath, secret, telegramSynthetic: true })
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${app.server.address().port}/api`
  const request = async (path, body, token = credential) => {
    const response = await fetch(base + path, {
      method: 'POST',
      headers: {
        Connection: 'close',
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    })
    return { status: response.status, body: await response.json() }
  }
  t.after(async () => {
    await app.close()
    db.close()
    await rm(dir, { recursive: true, force: true })
  })

  return { db, people, request, state, ownerToken }
}

test('scoped Telegram event endpoint enforces schema, revision, consent and idempotency', async t => {
  const f = await fixture(t)
  const path = `/bot/v1/bindings/${bindingId}/events`
  const sentAt = new Date().toISOString()
  const input = {
    eventId,
    expectedRevision: f.state.revision,
    chatId,
    messageId: '42',
    senderId: '300000001',
    sentAt,
    text: 'demo_event_1',
  }

  assert.equal((await f.request(path, input, null)).status, 401)
  assert.deepEqual(await f.request(path, input), {
    status: 200,
    body: { eventId, result: 'accepted', revision: f.state.revision },
  })
  assert.deepEqual(await f.request(path, input), {
    status: 200,
    body: { eventId, result: 'duplicate', revision: f.state.revision },
  })
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_texts').get().n, 1)

  const invalid = await f.request(path, { ...input, fromDisplayName: 'not in contract' })
  assert.equal(invalid.status, 400)
  assert.equal(invalid.body.error.code, 'INVALID_INPUT')
  const stale = await f.request(path, { ...input, eventId: randomUUID(), expectedRevision: f.state.revision - 1 })
  assert.equal(stale.status, 409)
  assert.equal(stale.body.error.code, 'STALE_REVISION')
  const wrongBinding = await f.request('/bot/v1/bindings/33333333-3333-4333-8333-333333333333/events', input)
  assert.equal(wrongBinding.status, 404)
  assert.equal(wrongBinding.body.error.code, 'NOT_FOUND')

  const withdrawalRevision = f.state.revision
  const withdrawn = await f.request(`/bot/v1/bindings/${bindingId}/consents`, {
    requestId: randomUUID(),
    expectedRevision: withdrawalRevision,
    telegramUserId: '300000002',
    policyVersion,
    rosterVersion: 1,
    decision: 'withdrawn',
  })
  assert.equal(withdrawn.status, 200)
  assert.equal(withdrawn.body.phase, 'paused')
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_texts').get().n, 0)

  const afterWithdrawal = await f.request(path, {
    ...input,
    eventId: randomUUID(),
    expectedRevision: withdrawn.body.revision,
    messageId: '43',
  })
  assert.equal(afterWithdrawal.status, 409)
  assert.equal(afterWithdrawal.body.error.code, 'CONSENT_REQUIRED')
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_texts').get().n, 0)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_event_ids').get().n, 1)
})
