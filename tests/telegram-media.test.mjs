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

const bindingId = '11111111-1111-4111-8111-111111111111'
const chatId = '-100000000001'
const credential = '7'.repeat(64)
const secret = 'synthetic-media-test-secret-not-production'

async function fixture(t, policyVersion = 'synthetic-media-v1') {
  const dir = await mkdtemp(join(tmpdir(), 'vibee-media-'))
  const dbPath = join(dir, 'test.sqlite')
  let clock = Date.now()
  const store = createStore({ path: dbPath, secret })
  const owner = store.authenticate(store.createWorkspace({ name: 'media_test', displayName: 'Owner' }))
  const people = [owner]
  for (let i = 1; i < 6; i++) {
    people.push(store.authenticate(store.join({ token: store.invite(owner).token, displayName: `Person ${i}` })))
  }
  store.close()
  const db = new DatabaseSync(dbPath)
  let state = transitionConsent(initialConsentState(), { type: 'bind', policyVersion }, 0)
  state = transitionConsent(state, { type: 'roster', members: people.map(person => person.id) }, state.revision)
  state = transitionConsent(state, { type: 'company', accepted: true }, state.revision)
  for (const person of people) state = transitionConsent(state,
    { type: 'decision', memberId: person.id, decision: 'accepted' }, state.revision)
  state = transitionConsent(state, { type: 'resume' }, state.revision)
  db.prepare('INSERT INTO telegram_bindings(id,workspace_id,chat_id,state) VALUES(?,?,?,?)')
    .run(bindingId, owner.workspace_id, chatId, JSON.stringify(state))
  for (let i = 0; i < people.length; i++) db.prepare('INSERT INTO telegram_links VALUES(?,?,?,?)')
    .run(bindingId, owner.workspace_id, people[i].id, String(300000001 + i))
  db.prepare('INSERT INTO telegram_credentials(token_hash,workspace_id,binding_id) VALUES(?,?,?)')
    .run(createHash('sha256').update(credential).digest('hex'), owner.workspace_id, bindingId)
  const app = createApp({ dbPath, secret, telegramSynthetic: true, now: () => clock })
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${app.server.address().port}/api/bot/v1/bindings/${bindingId}`
  const send = async (path, input, token = credential) => {
    const response = await fetch(base + path, { method: 'POST', headers: {
      Connection: 'close', 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }, body: JSON.stringify(input) })
    return { status: response.status, body: await response.json() }
  }
  const event = (media = { kind: 'document', mimeType: 'text/plain', fileSize: 128, caption: 'Тестовая подпись' }) => ({
    eventId: randomUUID(), expectedRevision: state.revision, chatId, messageId: '42',
    senderId: '300000001', sentAt: new Date(clock).toISOString(), media,
  })
  t.after(async () => { await app.close(); db.close(); await rm(dir, { recursive: true, force: true }) })
  return { db, dbPath, send, event, state, setClock: value => { clock = value }, clock }
}

test('media requires its own fully consented policy and scoped credential', async t => {
  const f = await fixture(t, 'synthetic-v1')
  const input = f.event()
  assert.equal((await f.send('/media-observations', input, null)).status, 401)
  const denied = await f.send('/media-observations', input)
  assert.equal(denied.status, 409)
  assert.equal(denied.body.error.code, 'CONSENT_REQUIRED')
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_media_observations').get().n, 0)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_event_ids').get().n, 0)
})

test('allowed media metadata is temporary, deduplicated across text, and excluded from metrics', async t => {
  const f = await fixture(t)
  const input = f.event()
  assert.equal((await f.send('/media-observations', input)).body.result, 'accepted')
  assert.equal((await f.send('/media-observations', input)).body.result, 'duplicate')
  const stored = f.db.prepare('SELECT media,expires FROM telegram_media_observations').get()
  assert.deepEqual(JSON.parse(stored.media), input.media)
  assert.equal(stored.expires, f.clock + 900000)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_open_periods').get().n, 0)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_texts').get().n, 0)
  const changed = await f.send('/media-observations', { ...input, media: { ...input.media, caption: 'Изменено' } })
  assert.equal(changed.body.error.code, 'EVENT_CONFLICT')
  const text = { ...input, eventId: randomUUID(), text: 'Спасибо' }
  delete text.media
  assert.equal((await f.send('/events', text)).body.error.code, 'EVENT_CONFLICT')
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_event_ids').get().n, 1)
  f.setClock(f.clock + 900001)
  const restarted = createStore({ path: f.dbPath, secret, telegramSynthetic: true, now: () => f.clock + 900001 })
  restarted.close()
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_media_observations').get().n, 0)
})

test('limits, unknown fields and unsupported formats leave no rows; unknown sender purges media', async t => {
  const f = await fixture(t)
  for (const media of [
    { kind: 'voice', mimeType: 'audio/ogg', fileSize: 10 * 1048576 + 1, durationSeconds: 30 },
    { kind: 'video_note', mimeType: 'video/mp4', fileSize: 10, durationSeconds: 61 },
    { kind: 'document', mimeType: 'application/zip', fileSize: 10 },
    { kind: 'document', mimeType: 'text/plain', fileSize: 10, fileId: 'secret' },
    { kind: 'document', mimeType: 'text/plain', fileSize: 10, caption: 'x'.repeat(1025) },
  ]) assert.notEqual((await f.send('/media-observations', f.event(media))).status, 200)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_media_observations').get().n, 0)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_event_ids').get().n, 0)
  assert.equal((await f.send('/media-observations', f.event({
    kind: 'voice', mimeType: 'audio/ogg', fileSize: 10 * 1048576, durationSeconds: 120,
  }))).body.result, 'accepted')
  const unknown = await f.send('/media-observations', { ...f.event(), messageId: '43', senderId: '999999999' })
  assert.equal(unknown.body.result, 'paused')
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_media_observations').get().n, 0)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_event_ids').get().n, 1)
  const after = await f.send('/media-observations', { ...f.event(), messageId: '44', expectedRevision: unknown.body.revision })
  assert.equal(after.body.error.code, 'CONSENT_REQUIRED')
})

test('withdrawal removes retained media and prevents another observation', async t => {
  const f = await fixture(t)
  assert.equal((await f.send('/media-observations', f.event())).body.result, 'accepted')
  const withdrawn = await f.send('/consents', {
    requestId: randomUUID(), expectedRevision: f.state.revision,
    telegramUserId: '300000002', policyVersion: 'synthetic-media-v1',
    rosterVersion: 1, decision: 'withdrawn',
  })
  assert.equal(withdrawn.status, 200)
  assert.equal(withdrawn.body.phase, 'paused')
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_media_observations').get().n, 0)
  const denied = await f.send('/media-observations', { ...f.event(), messageId: '43',
    expectedRevision: withdrawn.body.revision })
  assert.equal(denied.body.error.code, 'CONSENT_REQUIRED')
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_message_ids').get().n, 1)
})
