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

const secret = 'synthetic-telegram-api-test-secret-not-for-production'
const credential = '1'.repeat(64)
const credentialHash = createHash('sha256').update(credential).digest('hex')
const policyVersion = 'synthetic-v1'

async function fixture(t, { enabled = true, seedLinks = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'vibee-telegram-test-'))
  const dbPath = join(dir, 'synthetic.sqlite')
  const store = createStore({ path: dbPath, secret })
  const ownerToken = store.createWorkspace({ name: 'Synthetic A', displayName: 'Owner A' })
  const owner = store.authenticate(ownerToken)
  const people = [owner]
  const tokens = [ownerToken]
  for (let i = 1; i < 6; i++) {
    const token = store.join({ token: store.invite(owner).token, displayName: 'Synthetic ' + i })
    tokens.push(token); people.push(store.authenticate(token))
  }
  const foreignToken = store.createWorkspace({ name: 'Synthetic B', displayName: 'Owner B' })
  const roundId = store.snapshot(owner).round.id
  store.checkin(owner, { roundId, scores: { energy: 3, clarity: 4, support: 5 } })
  store.close()
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA foreign_keys=ON')
  const id = randomUUID()
  const otherBindingId = randomUUID()
  const state = transitionConsent(initialConsentState(), { type: 'bind', policyVersion }, 0)
  // Trusted synthetic fixture only. This does NOT implement token exchange or prove Telegram identity.
  for (const [bindingId, chatId] of [[id, '-100000000001'], [otherBindingId, '-100000000002']]) {
    db.prepare('INSERT INTO telegram_bindings(id,workspace_id,chat_id,state) VALUES(?,?,?,?)')
      .run(bindingId, owner.workspace_id, chatId, JSON.stringify(state))
  }
  if (seedLinks) for (let i = 0; i < people.length; i++) {
    db.prepare('INSERT INTO telegram_links VALUES(?,?,?,?)').run(id, owner.workspace_id, people[i].id, String(100000001 + i))
  }
  db.prepare('INSERT INTO telegram_credentials(token_hash,workspace_id,binding_id) VALUES(?,?,?)').run(credentialHash, owner.workspace_id, id)
  let clock = Date.now()
  let app, base
  const launch = async () => {
    app = createApp({ dbPath, secret, telegramSynthetic: enabled, now: () => clock })
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve))
    base = 'http://127.0.0.1:' + app.server.address().port + '/api'
  }
  await launch()
  t.after(async () => { await app.close(); db.close(); await rm(dir, { recursive: true, force: true }) })
  const request = async (path, input, headers = {}) => {
    const response = await fetch(base + path, {
      method: input === undefined ? 'GET' : 'POST',
      headers: { Connection: 'close', ...(input === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    })
    return { status: response.status, body: await response.json() }
  }
  const web = (operation, input, token = ownerToken, bindingId = id, extra = {}) => request(
    '/telegram/bindings/' + bindingId + '/' + operation, input,
    { Cookie: 'vibebot_session=' + token, 'X-Vibee': '1', ...extra })
  const bot = (operation, input, bindingId = id, token = credential) => request(
    '/bot/v1/bindings/' + bindingId + (operation ? '/' + operation : ''), input, { Authorization: 'Bearer ' + token })
  const linkToken = (token = ownerToken, input = { requestId: randomUUID() }) => request(
    '/telegram/link-tokens', input, { Cookie: 'vibebot_session=' + token, 'X-Vibee': '1' })
  const link = (token, telegramUserId, extra = {}) => request('/bot/v1/links',
    { requestId: randomUUID(), token, telegramUserId, ...extra }, { Authorization: 'Bearer ' + credential })
  const command = (expectedRevision, fields) => ({ requestId: randomUUID(), expectedRevision, ...fields })
  const status = async () => {
    const result = await bot('')
    assert.equal(result.status, 200)
    assert.deepEqual(Object.keys(result.body).sort(), ['bindingId', 'phase', 'policyVersion', 'revision', 'rosterVersion'])
    return result.body
  }
  const mutate = async (operation, fields, via = web) => {
    const current = await status()
    return via(operation, command(current.revision, fields))
  }
  const decision = async (index, value = 'accepted') => {
    const current = await status()
    return bot('consents', command(current.revision, { telegramUserId: String(100000001 + index),
      policyVersion: current.policyVersion, rosterVersion: current.rosterVersion, decision: value }))
  }
  const prepare = async () => {
    assert.equal((await mutate('roster', { memberIds: people.map(person => person.id), verified: true })).status, 200)
    assert.equal((await mutate('company', { accepted: true, authorityConfirmed: true, policyVersion })).status, 200)
  }
  const activate = async () => {
    await prepare()
    for (let i = 0; i < people.length; i++) assert.equal((await decision(i)).status, 200)
    const result = await mutate('control', { action: 'resume' })
    assert.equal(result.body.phase, 'active')
    return result.body
  }
  return { db, id, otherBindingId, owner, people, tokens, foreignToken, request, web, bot, linkToken, link, command, status,
    mutate, decision, prepare, activate, advance: ms => { clock += ms },
    restart: async () => { await app.close(); await launch() } }
}

const error = (result, status, code) => {
  assert.equal(result.status, status, JSON.stringify(result.body))
  assert.equal(result.body.error.code, code)
}

test('SQLite: adding Telegram tables preserves existing workspace, member and check-in rows', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'vibee-telegram-legacy-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'legacy.sqlite')
  const workspaceId = randomUUID(), memberId = randomUUID(), roundId = randomUUID()
  const legacy = new DatabaseSync(path)
  legacy.exec(`
    CREATE TABLE workspaces(id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE members(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), name TEXT NOT NULL, role TEXT NOT NULL);
    CREATE TABLE rounds(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), created_at TEXT NOT NULL, closed_at TEXT, summary TEXT);
    CREATE TABLE checkins(round_id TEXT NOT NULL REFERENCES rounds(id), voter_key TEXT NOT NULL, energy INTEGER NOT NULL, clarity INTEGER NOT NULL, support INTEGER NOT NULL, PRIMARY KEY(round_id,voter_key));
  `)
  legacy.prepare('INSERT INTO workspaces VALUES(?,?)').run(workspaceId, 'Legacy team')
  legacy.prepare('INSERT INTO members VALUES(?,?,?,?)').run(memberId, workspaceId, 'Legacy member', 'organizer')
  legacy.prepare('INSERT INTO rounds(id,workspace_id,created_at) VALUES(?,?,?)').run(roundId, workspaceId, '2026-10-30T00:00:00.000Z')
  legacy.prepare('INSERT INTO checkins VALUES(?,?,?,?,?)').run(roundId, 'legacy-voter', 2, 3, 4)
  legacy.close()

  const migrated = createStore({ path, secret })
  migrated.close()
  const reopened = new DatabaseSync(path)
  assert.equal(reopened.prepare('SELECT name FROM workspaces WHERE id=?').get(workspaceId).name, 'Legacy team')
  assert.equal(reopened.prepare('SELECT name FROM members WHERE id=?').get(memberId).name, 'Legacy member')
  assert.deepEqual({ ...reopened.prepare('SELECT energy,clarity,support FROM checkins WHERE round_id=?').get(roundId) },
    { energy: 2, clarity: 3, support: 4 })
  assert.equal(reopened.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE 'telegram_%'").get().n, 5)
  reopened.close()
})

test('HTTP/SQLite: a web member links only themself once; link survives restart', async t => {
  const f = await fixture(t, { seedLinks: false })
  const issued = await f.linkToken(f.tokens[1])
  assert.equal(issued.status, 201)
  assert.match(issued.body.token, /^[a-f0-9]{64}$/)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_link_tokens WHERE token_hash=?')
    .get(createHash('sha256').update(issued.body.token).digest('hex')).n, 1)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_link_tokens WHERE token_hash=?')
    .get(issued.body.token).n, 0)
  assert.equal((await f.link(issued.body.token, '100000002')).status, 200)
  error(await f.link(issued.body.token, '100000002'), 409, 'TOKEN_EXPIRED')
  await f.restart()
  assert.equal(f.db.prepare('SELECT member_id FROM telegram_links WHERE binding_id=? AND telegram_user_id=?')
    .get(f.id, '100000002').member_id, f.people[1].id)
  error(await f.link(issued.body.token, '100000002'), 409, 'TOKEN_EXPIRED')
})

test('HTTP/SQLite: lost link ACK replays after restart without saving the raw token', async t => {
  const f = await fixture(t, { seedLinks: false })
  const issued = await f.linkToken(f.tokens[1])
  const input = { requestId: randomUUID(), token: issued.body.token, telegramUserId: '100000002' }
  const post = body => f.request('/bot/v1/links', body, { Authorization: 'Bearer ' + credential })
  const first = await post(input)
  assert.deepEqual(first, { status: 200, body: { linked: true } })
  const journal = f.db.prepare('SELECT actor_key,digest,response FROM telegram_requests WHERE request_id=?').get(input.requestId)
  assert.deepEqual(JSON.parse(journal.response), { linked: true })
  assert.ok(Object.values(journal).every(value => !value.includes(issued.body.token)))
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_links WHERE binding_id=?').get(f.id).n, 1)

  await f.restart()
  assert.deepEqual(await post(input), first)
  error(await post({ ...input, telegramUserId: '100000003' }), 409, 'EVENT_CONFLICT')
  error(await post({ ...input, token: 'f'.repeat(64) }), 409, 'EVENT_CONFLICT')
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_links WHERE binding_id=?').get(f.id).n, 1)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_requests WHERE request_id=?').get(input.requestId).n, 1)
})

test('HTTP/SQLite: expired, foreign and conflicting links are rejected without consuming tokens', async t => {
  const f = await fixture(t, { seedLinks: false })
  const foreign = await f.linkToken(f.foreignToken)
  error(await f.link(foreign.body.token, '100000009'), 404, 'NOT_FOUND')
  const owner = await f.linkToken()
  assert.equal((await f.link(owner.body.token, '100000001')).status, 200)
  const sameMember = await f.linkToken()
  error(await f.link(sameMember.body.token, '100000007'), 409, 'LINK_CONFLICT')
  const otherMember = await f.linkToken(f.tokens[1])
  error(await f.link(otherMember.body.token, '100000001'), 409, 'LINK_CONFLICT')
  assert.equal(f.db.prepare('SELECT used FROM telegram_link_tokens WHERE token_hash=?')
    .get(createHash('sha256').update(otherMember.body.token).digest('hex')).used, 0)
  const expiring = await f.linkToken(f.tokens[2])
  f.advance(600001)
  await f.restart()
  error(await f.link(expiring.body.token, '100000003'), 409, 'TOKEN_EXPIRED')
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_links WHERE binding_id=?').get(f.id).n, 1)
})

test('HTTP/SQLite: link endpoints require a session or bot credential and reject identity fields', async t => {
  const f = await fixture(t, { seedLinks: false })
  error(await f.request('/telegram/link-tokens', { requestId: randomUUID() }, { 'X-Vibee': '1' }), 401, 'SIGN_IN_REQUIRED')
  error(await f.request('/telegram/link-tokens', { requestId: randomUUID() },
    { Cookie: 'vibebot_session=' + f.tokens[0], 'X-Vibee': '1', Origin: 'https://untrusted.invalid' }), 403, 'ORIGIN_REJECTED')
  error(await f.linkToken(f.tokens[1], { requestId: randomUUID(), memberId: f.people[0].id }), 400, 'INVALID_INPUT')
  error(await f.linkToken(f.tokens[1], { requestId: randomUUID(), workspaceId: f.owner.workspace_id }), 400, 'INVALID_INPUT')
  const requestId = randomUUID()
  const issued = await f.linkToken(f.tokens[1], { requestId })
  error(await f.linkToken(f.tokens[1], { requestId }), 409, 'EVENT_CONFLICT')
  error(await f.request('/bot/v1/links', { requestId: randomUUID(), token: issued.body.token,
    telegramUserId: '100000002' }), 401, 'BOT_AUTH_REQUIRED')
  error(await f.link(issued.body.token, '100000002', { memberId: f.people[0].id }), 400, 'INVALID_INPUT')
  error(await f.link(issued.body.token, '100000002', { workspaceId: f.owner.workspace_id }), 400, 'INVALID_INPUT')
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_links').get().n, 0)
})

test('HTTP/SQLite: all consent and explicit resume; withdrawal persists and old buttons fail', async t => {
  const f = await fixture(t)
  await f.prepare()
  for (let i = 0; i < 5; i++) assert.equal((await f.decision(i)).status, 200)
  const before = await f.status()
  error(await f.mutate('control', { action: 'resume' }), 409, 'CONSENT_REQUIRED')
  assert.deepEqual(await f.status(), before) // Failed transition writes neither state nor replay result.
  assert.equal((await f.decision(5)).body.phase, 'paused')
  const active = await f.mutate('control', { action: 'resume' })
  assert.equal(active.body.phase, 'active')
  const withdrawn = await f.decision(2, 'withdrawn')
  assert.equal(withdrawn.body.phase, 'paused')
  const stale = f.command(active.body.revision, { telegramUserId: '100000003', policyVersion,
    rosterVersion: active.body.rosterVersion, decision: 'accepted' })
  error(await f.bot('consents', stale), 409, 'STALE_REVISION')
  await f.restart()
  assert.deepEqual(await f.status(), withdrawn.body)
  error(await f.mutate('control', { action: 'resume' }), 409, 'CONSENT_REQUIRED')
  assert.equal((await f.decision(2)).body.phase, 'paused')
  assert.equal((await f.mutate('control', { action: 'resume' })).body.phase, 'active')
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM checkins').get().n, 1)
})

test('HTTP/SQLite: decline, company withdrawal and unknown member stop the whole binding', async t => {
  const f = await fixture(t)
  await f.activate()
  assert.equal((await f.decision(1, 'declined')).body.phase, 'paused')
  error(await f.mutate('control', { action: 'resume' }), 409, 'CONSENT_REQUIRED')
  await f.decision(1)
  await f.mutate('control', { action: 'resume' })
  assert.equal((await f.mutate('company', { accepted: false, authorityConfirmed: true, policyVersion })).body.phase, 'paused')
  error(await f.mutate('control', { action: 'resume' }), 409, 'CONSENT_REQUIRED')
  await f.mutate('company', { accepted: true, authorityConfirmed: true, policyVersion })
  await f.mutate('control', { action: 'resume' })
  assert.equal((await f.mutate('pause', { reason: 'unknown_member' }, f.bot)).body.phase, 'paused')
  const saved = JSON.parse(f.db.prepare('SELECT state FROM telegram_bindings WHERE id=?').get(f.id).state)
  assert.equal(saved.rosterVerified, false)
  assert.deepEqual(saved.decisions, {})
  error(await f.mutate('control', { action: 'resume' }), 409, 'CONSENT_REQUIRED')
})

test('HTTP/SQLite: authorization scopes, linked identities, roles and CSRF cannot be bypassed', async t => {
  const f = await fixture(t)
  await f.prepare()
  const current = await f.status()
  const input = f.command(current.revision, { action: 'pause' })
  error(await f.web('control', input, f.foreignToken), 404, 'NOT_FOUND')
  error(await f.web('control', input, f.tokens[1]), 403, 'FORBIDDEN')
  error(await f.bot('', undefined, f.otherBindingId), 404, 'NOT_FOUND')
  error(await f.bot('pause', f.command(current.revision, { reason: 'manual' }), f.otherBindingId), 404, 'NOT_FOUND')
  error(await f.bot('', undefined, f.id, '2'.repeat(64)), 401, 'BOT_AUTH_REQUIRED')
  error(await f.request('/bot/v1/bindings/' + f.id), 401, 'BOT_AUTH_REQUIRED')
  error(await f.web('control', input, f.tokens[0], f.id, { Origin: 'https://untrusted.invalid' }), 403, 'ORIGIN_REJECTED')
  error(await f.web('control', input, f.tokens[0], f.id, { 'X-Vibee': '' }), 403, 'REQUEST_REJECTED')
  error(await f.bot('consents', f.command(current.revision, { telegramUserId: '999999999', policyVersion,
    rosterVersion: current.rosterVersion, decision: 'accepted' })), 403, 'FORBIDDEN')
  error(await f.web('consents', {}), 404, 'NOT_FOUND')
  assert.deepEqual(await f.status(), current)
  f.db.prepare('UPDATE telegram_credentials SET revoked=1').run()
  error(await f.bot(''), 401, 'BOT_AUTH_REQUIRED')
})

test('HTTP/SQLite: durable replay is atomic, canonical, scoped to actor and never reverses withdrawal', async t => {
  const f = await fixture(t)
  const active = await f.activate()
  const input = f.command(active.revision, { action: 'pause' })
  const replies = await Promise.all([f.web('control', input), f.web('control', input)])
  assert.deepEqual(replies[0], replies[1])
  assert.equal(replies[0].body.revision, active.revision + 1)
  await f.restart()
  const reordered = Object.fromEntries(Object.entries(input).reverse())
  assert.deepEqual(await f.web('control', reordered), replies[0])
  error(await f.web('control', { ...input, action: 'resume' }), 409, 'EVENT_CONFLICT')
  const resume = f.command(replies[0].body.revision, { action: 'resume' })
  const oldResponse = await f.web('control', resume)
  const withdrawn = await f.decision(0, 'withdrawn')
  assert.deepEqual(await f.web('control', resume), oldResponse)
  assert.deepEqual(await f.status(), withdrawn.body) // Replay is a historical ACK, never a current-state authorization.
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_requests WHERE request_id=?').get(input.requestId).n, 1)
  error(await f.web('control', input, f.foreignToken), 404, 'NOT_FOUND')
})

test('HTTP/SQLite: concurrent decisions with one revision have one winner; losing request can be retried explicitly', async t => {
  const f = await fixture(t)
  await f.prepare()
  const current = await f.status()
  const inputs = [0, 1].map(i => f.command(current.revision, { telegramUserId: String(100000001 + i),
    policyVersion, rosterVersion: current.rosterVersion, decision: 'accepted' }))
  const results = await Promise.all(inputs.map(input => f.bot('consents', input)))
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409])
  const loser = results.findIndex(result => result.status === 409)
  error(results[loser], 409, 'STALE_REVISION')
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_requests WHERE request_id=?').get(inputs[loser].requestId).n, 0)
  const next = await f.status()
  assert.equal((await f.bot('consents', { ...inputs[loser], expectedRevision: next.revision })).status, 200)
})

test('HTTP/SQLite: strict schemas and current policy/roster versions; invalid roster leaves state intact', async t => {
  const f = await fixture(t)
  await f.prepare()
  const current = await f.status()
  for (const fields of [{ workspaceId: f.owner.workspace_id }, { text: 'synthetic forbidden field' },
    { expectedRevision: -1 }, { requestId: 'not-a-uuid' }, { action: 'bind' }]) {
    error(await f.web('control', { ...f.command(current.revision, { action: 'pause' }), ...fields }), 400, 'INVALID_INPUT')
  }
  for (const memberIds of [[], [f.people[0].id, f.people[0].id], [randomUUID()]]) {
    error(await f.web('roster', f.command(current.revision, { memberIds, verified: true })), 400, 'INVALID_INPUT')
  }
  for (const fields of [{ policyVersion: 'old-v0' }, { rosterVersion: 0 }]) {
    error(await f.bot('consents', f.command(current.revision, { telegramUserId: '100000001', policyVersion,
      rosterVersion: current.rosterVersion, decision: 'accepted', ...fields })), 409, 'STALE_REVISION')
  }
  error(await f.web('company', f.command(current.revision, { accepted: true, authorityConfirmed: false, policyVersion })), 400, 'INVALID_INPUT')
  assert.deepEqual(await f.status(), current)
  const path = '/bot/v1/bindings/' + f.id + '/pause'
  error(await f.request(path, { text: 'x'.repeat(33000) }, { Authorization: 'Bearer ' + credential }), 413, 'TOO_LARGE')
  error(await f.request(path, {}, { Authorization: 'Bearer ' + credential, 'Content-Type': 'text/plain' }), 415, 'JSON_REQUIRED')
})

test('HTTP/SQLite: migration blocks resume; disconnect clears identity without deleting check-ins', async t => {
  const f = await fixture(t)
  await f.activate()
  assert.equal((await f.mutate('pause', { reason: 'chat_migration' }, f.bot)).body.phase, 'paused')
  await f.restart()
  error(await f.mutate('control', { action: 'resume' }), 409, 'CONSENT_REQUIRED')
  await f.prepare()
  for (let i = 0; i < 6; i++) await f.decision(i)
  error(await f.mutate('control', { action: 'resume' }), 409, 'CONSENT_REQUIRED')
  const disconnected = await f.mutate('control', { action: 'disconnect' })
  assert.equal(disconnected.body.phase, 'disconnected')
  const saved = f.db.prepare('SELECT * FROM telegram_bindings WHERE id=?').get(f.id)
  assert.equal(saved.chat_id, null)
  assert.deepEqual(JSON.parse(saved.state).roster, [])
  assert.deepEqual(JSON.parse(saved.state).decisions, {})
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_links WHERE binding_id=?').get(f.id).n, 0)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM checkins').get().n, 1)
})

test('HTTP/SQLite: replay and revoked consent evidence expire after 24h, including restart', async t => {
  const f = await fixture(t)
  await f.activate()
  const withdrawn = await f.decision(0, 'withdrawn')
  f.advance(86400000 + 1)
  await f.restart()
  const current = await f.status()
  assert.equal(current.phase, 'paused')
  assert.equal(current.revision, withdrawn.body.revision + 1)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_requests').get().n, 0)
  const saved = JSON.parse(f.db.prepare('SELECT state FROM telegram_bindings WHERE id=?').get(f.id).state)
  assert.deepEqual(saved.decisions, {})
  assert.equal(saved.companyAccepted, false)
  error(await f.mutate('control', { action: 'resume' }), 409, 'CONSENT_REQUIRED')
})

test('HTTP/SQLite: rejected requests cannot expire or change another binding', async t => {
  const f = await fixture(t)
  await f.activate()
  const withdrawn = await f.decision(0, 'withdrawn')
  const before = f.db.prepare('SELECT state,evidence_expires FROM telegram_bindings WHERE id=?').get(f.id)
  const requests = f.db.prepare('SELECT COUNT(*) AS n FROM telegram_requests').get().n
  f.advance(86400000 + 1)
  error(await f.web('control', f.command(withdrawn.body.revision, { action: 'resume' }), f.foreignToken), 404, 'NOT_FOUND')
  error(await f.web('control', f.command(withdrawn.body.revision, { action: 'resume' }), f.tokens[1]), 403, 'FORBIDDEN')
  error(await f.bot('pause', f.command(withdrawn.body.revision, { reason: 'manual' }), f.otherBindingId), 404, 'NOT_FOUND')
  assert.deepEqual(f.db.prepare('SELECT state,evidence_expires FROM telegram_bindings WHERE id=?').get(f.id), before)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_requests').get().n, requests)

  const current = await f.status()
  assert.equal(current.phase, 'paused')
  assert.equal(current.revision, withdrawn.body.revision + 1)
  const afterExpiry = f.db.prepare('SELECT state,evidence_expires FROM telegram_bindings WHERE id=?').get(f.id)
  error(await f.web('control', f.command(withdrawn.body.revision, { action: 'resume' })), 409, 'STALE_REVISION')
  assert.deepEqual(f.db.prepare('SELECT state,evidence_expires FROM telegram_bindings WHERE id=?').get(f.id), afterExpiry)
})

test('Telegram synthetic gate defaults off and text/bootstrap/summary routes remain absent', async t => {
  const f = await fixture(t, { enabled: false })
  error(await f.bot(''), 503, 'UNAVAILABLE')
  error(await f.web('control', f.command(1, { action: 'resume' })), 503, 'UNAVAILABLE')
  error(await f.bot('events', { text: 'synthetic text must not be stored' }), 404, 'NOT_FOUND')
  error(await f.request('/telegram/link-tokens', { requestId: randomUUID() }), 503, 'UNAVAILABLE')
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_requests').get().n, 0)
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE 'telegram_%'").get().n, 5)
})
