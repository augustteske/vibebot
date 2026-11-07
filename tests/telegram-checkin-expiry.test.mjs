import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve, join, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createStore } from '../server/store.mjs'
import { initialConsentState, transitionConsent } from '../src/core/telegram.ts'

const secret = 'synthetic-checkin-expiry-test-secret-not-for-production'
const policyVersion = 'synthetic-v1'
const DAY = 86400000
const credential = '5'.repeat(64)

async function fixture(t) {
  const root = resolve('.data')
  await mkdir(root, { recursive: true })
  const dir = await mkdtemp(join(root, 'checkin-expiry-'))
  const dbPath = join(dir, 'synthetic.sqlite')
  let clock = Date.now()
  const launch = () => createStore({
    path: dbPath, secret, telegramSynthetic: true, now: () => clock,
  })
  let store = launch()
  const owner = store.authenticate(store.createWorkspace({ name: 'Synthetic A', displayName: 'Owner A' }))
  const foreignOwner = store.authenticate(store.createWorkspace({ name: 'Synthetic B', displayName: 'Owner B' }))
  store.close()

  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA foreign_keys=ON')
  const bindingId = randomUUID()
  const foreignBindingId = randomUUID()
  const activeState = memberId => {
    let state = transitionConsent(initialConsentState(), { type: 'bind', policyVersion }, 0)
    state = transitionConsent(state, { type: 'roster', members: [memberId] }, state.revision)
    state = transitionConsent(state, { type: 'company', accepted: true }, state.revision)
    state = transitionConsent(state, { type: 'decision', memberId, decision: 'accepted' }, state.revision)
    return transitionConsent(state, { type: 'resume' }, state.revision)
  }
  db.prepare('INSERT INTO telegram_bindings(id,workspace_id,chat_id,state) VALUES(?,?,?,?)')
    .run(bindingId, owner.workspace_id, '-100000000001', JSON.stringify(activeState(owner.id)))
  db.prepare('INSERT INTO telegram_bindings(id,workspace_id,chat_id,state) VALUES(?,?,?,?)')
    .run(foreignBindingId, foreignOwner.workspace_id, '-100000000002', JSON.stringify(activeState(foreignOwner.id)))
  db.prepare('INSERT INTO telegram_links VALUES(?,?,?,?)')
    .run(bindingId, owner.workspace_id, owner.id, '100000001')
  db.prepare('INSERT INTO telegram_links VALUES(?,?,?,?)')
    .run(foreignBindingId, foreignOwner.workspace_id, foreignOwner.id, '100000002')
  db.prepare('INSERT INTO telegram_credentials(token_hash,workspace_id,binding_id) VALUES(?,?,?)')
    .run(createHash('sha256').update(credential).digest('hex'), owner.workspace_id, bindingId)

  store = launch()
  t.after(async () => {
    store.close()
    db.close()
    if (dir.startsWith(root + sep)) await rm(dir, { recursive: true, force: true })
  })

  const bot = store.telegram.authenticate('Bearer ' + credential)
  const submit = (nonce, scores = { energy: 3, clarity: 3, support: 3 }) => store.telegram.acceptCheckin(bot, bindingId, {
    telegramUserId: '100000001', nonce, scores, submittedAt: new Date(clock).toISOString(),
  })
  const insertCheckin = (binding, expires, created = clock) => db.prepare(
    'INSERT INTO telegram_checkins(binding_id,nonce,digest,energy,clarity,support,created_at,expires) VALUES(?,?,?,?,?,?,?,?)',
  ).run(binding, randomUUID().replace(/-/g, '').slice(0, 16), randomUUID(), 3, 3, 3, created, expires)
  const count = binding => db.prepare('SELECT COUNT(*) AS n FROM telegram_checkins WHERE binding_id=?').get(binding).n

  return {
    store, db, owner, foreignOwner, bindingId, foreignBindingId, submit, insertCheckin, count,
    time: () => clock,
    setTime: value => { clock = value },
    restart: () => { store.close(); store = launch() },
  }
}

const nonce = index => 'a0b0c0d0e0f001' + String(index).padStart(2, '0')

test('personal check-in exists until the 30-day boundary and cleanup deletes it at expires', async t => {
  const f = await fixture(t)
  assert.deepEqual(f.submit(nonce(1)), { accepted: true, duplicate: false })

  const row = f.db.prepare('SELECT created_at,expires FROM telegram_checkins WHERE binding_id=? AND nonce=?')
    .get(f.bindingId, nonce(1))
  assert.equal(row.created_at, f.time())
  assert.equal(row.expires, f.time() + 30 * DAY)
  assert.deepEqual(f.store.telegramCheckinStats(f.owner), {
    status: 'hidden', reason: 'insufficient_responses', total: 1,
  })

  f.setTime(row.expires - 1)
  f.store.telegram.cleanup()
  assert.equal(f.count(f.bindingId), 1, 'запись должна существовать до истечения срока')

  f.setTime(row.expires)
  f.store.telegram.cleanup()
  assert.equal(f.count(f.bindingId), 0, 'на границе expires запись удаляется очисткой')
})

test('cleanup keeps unexpired check-ins of another workspace', async t => {
  const f = await fixture(t)
  f.submit(nonce(2))
  f.insertCheckin(f.foreignBindingId, f.time() + 60 * DAY)
  const expires = f.db.prepare('SELECT expires FROM telegram_checkins WHERE binding_id=?').get(f.bindingId).expires

  f.setTime(expires)
  f.store.telegram.cleanup()

  assert.equal(f.count(f.bindingId), 0)
  assert.equal(f.count(f.foreignBindingId), 1, 'чужая команда не должна затрагиваться')
  assert.equal(f.store.telegramCheckinStats(f.foreignOwner).total, 1)
})

test('startup cleanup removes expired check-ins after a restart', async t => {
  const f = await fixture(t)
  f.submit(nonce(3))
  const expires = f.db.prepare('SELECT expires FROM telegram_checkins WHERE binding_id=?').get(f.bindingId).expires

  f.setTime(expires)
  f.restart()

  assert.equal(f.count(f.bindingId), 0)
})

test('expired answers are excluded from organizer stats and stay out after cleanup', async t => {
  const f = await fixture(t)
  for (let index = 4; index < 9; index++) f.submit(nonce(index))
  f.insertCheckin(f.bindingId, f.time() - 1)
  f.insertCheckin(f.bindingId, f.time() - 1)
  f.insertCheckin(f.foreignBindingId, f.time() + DAY)
  assert.equal(f.count(f.bindingId), 7, 'просроченные строки ещё физически лежат в SQLite')

  const stats = f.store.telegramCheckinStats(f.owner)
  assert.equal(stats.status, 'visible')
  assert.equal(stats.total, 5, 'просроченные и чужие ответы не входят в статистику')

  f.store.telegram.cleanup()
  assert.equal(f.count(f.bindingId), 5)
  assert.equal(f.store.telegramCheckinStats(f.owner).total, 5)
})
