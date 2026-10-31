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
const bootstrapCredential = '3'.repeat(64)
const credentialHash = createHash('sha256').update(credential).digest('hex')
const policyVersion = 'synthetic-v1'
const DAY = 86400000
const demoIntervals = [1, 2, 3, 4, 5].map(day => ({ day, start: 540, end: 1080 }))

async function fixture(t, { enabled = true, seedLinks = true, seedBindings = true } = {}) {
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
  const foreignOwner = store.authenticate(foreignToken)
  const foreignPeople = [foreignOwner]
  for (let i = 1; i < 6; i++) {
    const token = store.join({ token: store.invite(foreignOwner).token, displayName: 'Foreign ' + i })
    foreignPeople.push(store.authenticate(token))
  }
  const roundId = store.snapshot(owner).round.id
  store.checkin(owner, { roundId, scores: { energy: 3, clarity: 4, support: 5 } })
  store.close()
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA foreign_keys=ON')
  const id = randomUUID()
  const otherBindingId = randomUUID()
  const state = transitionConsent(initialConsentState(), { type: 'bind', policyVersion }, 0)
  // Trusted synthetic fixture only. This does NOT implement token exchange or prove Telegram identity.
  if (seedBindings) for (const [bindingId, chatId] of [[id, '-100000000001'], [otherBindingId, '-100000000002']]) {
    db.prepare('INSERT INTO telegram_bindings(id,workspace_id,chat_id,state) VALUES(?,?,?,?)')
      .run(bindingId, owner.workspace_id, chatId, JSON.stringify(state))
  }
  if (seedLinks) for (let i = 0; i < people.length; i++) {
    db.prepare('INSERT INTO telegram_links VALUES(?,?,?,?)').run(id, owner.workspace_id, people[i].id, String(100000001 + i))
  }
  if (seedBindings) db.prepare('INSERT INTO telegram_credentials(token_hash,workspace_id,binding_id) VALUES(?,?,?)').run(credentialHash, owner.workspace_id, id)
  let clock = Date.now()
  let app, base
  const launch = async () => {
    app = createApp({ dbPath, secret, telegramBootstrapCredential: bootstrapCredential, telegramSynthetic: enabled, now: () => clock })
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
    { requestId: randomUUID(), token, telegramUserId, ...extra }, { Authorization: 'Bearer ' + bootstrapCredential })
  const bindingToken = (token = ownerToken, input = { requestId: randomUUID() }) => request('/telegram/binding-tokens',
    input, { Cookie: 'vibebot_session=' + token, 'X-Vibee': '1' })
  const bind = (input, auth = bootstrapCredential) => request('/bot/v1/bindings', input, { Authorization: 'Bearer ' + auth })
  const closePeriod = (input, token = ownerToken, bindingId = id) => request('/telegram/bindings/' + bindingId + '/periods/close',
    input, { Cookie: 'vibebot_session=' + token, 'X-Vibee': '1' })
  const summary = (token = ownerToken, bindingId = id) => request('/telegram/bindings/' + bindingId + '/summary',
    undefined, { Cookie: 'vibebot_session=' + token })
  const recommendation = (periodId, token = ownerToken, bindingId = id) => request(
    '/telegram/bindings/' + bindingId + '/periods/' + periodId + '/recommendation', undefined,
    { Cookie: 'vibebot_session=' + token })
  const confirmAction = (periodId, input, token = ownerToken, bindingId = id) => request(
    '/telegram/bindings/' + bindingId + '/periods/' + periodId + '/action', input,
    { Cookie: 'vibebot_session=' + token, 'X-Vibee': '1' })
  const chatFeedback = (periodId, kind, input, token = ownerToken, bindingId = id) => request(
    '/telegram/bindings/' + bindingId + '/periods/' + periodId + '/feedback/' + kind,
    input, { Cookie: 'vibebot_session=' + token, 'X-Vibee': '1' })
  const closeChatFeedback = (periodId, kind, input, token = ownerToken, bindingId = id) => request(
    '/telegram/bindings/' + bindingId + '/periods/' + periodId + '/feedback/' + kind + '/close',
    input, { Cookie: 'vibebot_session=' + token, 'X-Vibee': '1' })
  const profile = (input, token = ownerToken) => request('/telegram/profile', input,
    { Cookie: 'vibebot_session=' + token, 'X-Vibee': '1' })
  const setProfile = () => profile({ requestId: randomUUID(), expectedVersion: 0,
    timeZone: 'Asia/Omsk', intervals: demoIntervals })
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
  return { db, id, otherBindingId, owner, people, tokens, foreignToken, foreignOwner, foreignPeople, request, web, bot, linkToken, link, bindingToken, bind, closePeriod, summary, recommendation, confirmAction, chatFeedback, closeChatFeedback, profile, setProfile, command, status,
    mutate, decision, prepare, activate, time: () => clock, advance: ms => { clock += ms }, setTime: ms => { clock = ms },
    restart: async () => { await app.close(); await launch() } }
}

const error = (result, status, code) => {
  assert.equal(result.status, status, JSON.stringify(result.body))
  assert.equal(result.body.error.code, code)
}
const textEvent = (f, expectedRevision, fields = {}) => ({ eventId: randomUUID(), expectedRevision,
  chatId: '-100000000001', messageId: '42', senderId: '100000001',
  sentAt: new Date(f.time()).toISOString(), text: 'Synthetic allowed text', ...fields })
const sendMany = async (f, revision, count, authors, firstMessageId, thanks = 0,
  { bindingId = f.id, credential: botCredential = credential, chatId = '-100000000001', senderBase = 100000001 } = {}) => {
  for (let i = 0; i < count; i++) {
    const result = await f.bot('events', textEvent(f, revision, {
      chatId, messageId: String(firstMessageId + i), senderId: String(senderBase + i % authors),
      text: i < thanks ? 'Спасибо за помощь' : 'Synthetic routine update',
    }), bindingId, botCredential)
    assert.equal(result.status, 200, JSON.stringify(result))
  }
}
const closeCurrent = (f, revision, token, bindingId) => f.closePeriod({ requestId: randomUUID(), expectedRevision: revision, periodId: randomUUID() }, token, bindingId)
const publishForRecommendation = async f => {
  const active = await f.activate()
  assert.equal((await f.setProfile()).status, 200)
  const base = Date.parse('2026-11-02T03:00:00.000Z')
  let periodId
  for (let day = 0; day < 3; day++) {
    f.setTime(base + day * DAY)
    await sendMany(f, active.revision, 20, 5, 3000 + day * 100, 4)
    periodId = randomUUID()
    const closed = await f.closePeriod({ requestId: randomUUID(), expectedRevision: active.revision, periodId })
    assert.equal(closed.body.status, day === 2 ? 'published' : 'calibrating')
    if (day < 2) error(await f.recommendation(periodId), 409, 'STALE_PERIOD')
  }
  return { periodId, revision: active.revision }
}
const activateForeign = async f => {
  const bindingId = randomUUID(), botCredential = '4'.repeat(64), chatId = '-100000000009'
  const state = transitionConsent(initialConsentState(), { type: 'bind', policyVersion }, 0)
  f.db.prepare('INSERT INTO telegram_bindings(id,workspace_id,chat_id,state) VALUES(?,?,?,?)')
    .run(bindingId, f.foreignOwner.workspace_id, chatId, JSON.stringify(state))
  for (let i = 0; i < f.foreignPeople.length; i++) {
    f.db.prepare('INSERT INTO telegram_links VALUES(?,?,?,?)')
      .run(bindingId, f.foreignOwner.workspace_id, f.foreignPeople[i].id, String(200000001 + i))
  }
  f.db.prepare('INSERT INTO telegram_credentials(token_hash,workspace_id,binding_id) VALUES(?,?,?)')
    .run(createHash('sha256').update(botCredential).digest('hex'), f.foreignOwner.workspace_id, bindingId)
  let current = await f.bot('', undefined, bindingId, botCredential)
  for (const [operation, fields] of [
    ['roster', { memberIds: f.foreignPeople.map(person => person.id), verified: true }],
    ['company', { accepted: true, authorityConfirmed: true, policyVersion }],
  ]) {
    current = await f.web(operation, f.command(current.body.revision, fields), f.foreignToken, bindingId)
    assert.equal(current.status, 200)
  }
  for (let i = 0; i < f.foreignPeople.length; i++) {
    current = await f.bot('consents', f.command(current.body.revision, {
      telegramUserId: String(200000001 + i), policyVersion, rosterVersion: current.body.rosterVersion,
      decision: 'accepted',
    }), bindingId, botCredential)
    assert.equal(current.status, 200)
  }
  current = await f.web('control', f.command(current.body.revision, { action: 'resume' }), f.foreignToken, bindingId)
  assert.equal(current.body.phase, 'active')
  return { bindingId, credential: botCredential, chatId, senderBase: 200000001, revision: current.body.revision }
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
  assert.equal(reopened.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE 'telegram_%'").get().n, 22)
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
  const post = body => f.request('/bot/v1/links', body, { Authorization: 'Bearer ' + bootstrapCredential })
  const first = await post(input)
  assert.deepEqual(first, { status: 200, body: { linked: true } })
  const journal = f.db.prepare('SELECT actor_key,digest,response FROM telegram_identity_requests WHERE request_id=?').get(input.requestId)
  assert.deepEqual(JSON.parse(journal.response), { linked: true })
  assert.ok(Object.values(journal).every(value => !value.includes(issued.body.token)))
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_links WHERE binding_id=?').get(f.id).n, 1)

  await f.restart()
  assert.deepEqual(await post(input), first)
  error(await post({ ...input, telegramUserId: '100000003' }), 409, 'EVENT_CONFLICT')
  error(await post({ ...input, token: 'f'.repeat(64) }), 409, 'EVENT_CONFLICT')
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_links WHERE binding_id=?').get(f.id).n, 1)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_identity_requests WHERE request_id=?').get(input.requestId).n, 1)
})

test('HTTP/SQLite: expired, foreign and conflicting links are rejected without consuming tokens', async t => {
  const f = await fixture(t, { seedLinks: false })
  const foreign = await f.linkToken(f.foreignToken)
  assert.equal((await f.link(foreign.body.token, '100000009')).status, 200)
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

test('HTTP/SQLite: binding ACK replay restores scoped credential without storing secrets', async t => {
  const f = await fixture(t, { seedLinks: false, seedBindings: false })
  const identityToken = await f.linkToken()
  assert.equal((await f.link(identityToken.body.token, '100000001')).status, 200)
  const issued = await f.bindingToken()
  assert.equal(issued.status, 201)
  const input = { requestId: randomUUID(), token: issued.body.token,
    chatId: '-100000000003', initiatorId: '100000001' }
  const first = await f.bind(input)
  assert.equal(first.status, 200)
  assert.equal(first.body.phase, 'awaiting_consents')
  assert.match(first.body.credential, /^[a-f0-9]{64}$/)
  const bindingId = first.body.bindingId
  const journal = f.db.prepare('SELECT * FROM telegram_binding_requests WHERE request_id=?').get(input.requestId)
  assert.ok(Object.values(journal).every(value => !String(value).includes(input.token) && !String(value).includes(first.body.credential)))
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_credentials WHERE token_hash=?')
    .get(createHash('sha256').update(first.body.credential).digest('hex')).n, 1)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_credentials WHERE token_hash=?').get(first.body.credential).n, 0)
  await f.restart()
  assert.deepEqual(await f.bind(input), first)
  error(await f.bind({ ...input, chatId: '-100000000004' }), 409, 'EVENT_CONFLICT')
  error(await f.bind({ ...input, initiatorId: '100000002' }), 409, 'EVENT_CONFLICT')
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_bindings WHERE chat_id=?').get(input.chatId).n, 1)
  const scopedStatus = await f.bot('', undefined, bindingId, first.body.credential)
  assert.equal(scopedStatus.status, 200)
  error(await f.bot('', undefined, bindingId, bootstrapCredential), 401, 'BOT_AUTH_REQUIRED')
  error(await f.bot('pause', f.command(first.body.revision, { reason: 'manual' }), bindingId, bootstrapCredential), 401, 'BOT_AUTH_REQUIRED')
  error(await f.bind(input, first.body.credential), 401, 'BOT_AUTH_REQUIRED')
  error(await f.request('/bot/v1/links', { requestId: randomUUID(), token: identityToken.body.token,
    telegramUserId: '100000001' }, { Authorization: 'Bearer ' + first.body.credential }), 401, 'BOT_AUTH_REQUIRED')
})

test('HTTP/SQLite: binding requires organizer identity, live token and unique chat across teams', async t => {
  const f = await fixture(t, { seedLinks: false, seedBindings: false })
  error(await f.request('/telegram/binding-tokens', { requestId: randomUUID() }, { 'X-Vibee': '1' }), 401, 'SIGN_IN_REQUIRED')
  error(await f.bindingToken(f.tokens[1]), 403, 'FORBIDDEN')
  const issued = await f.bindingToken()
  const input = { requestId: randomUUID(), token: issued.body.token,
    chatId: '-100000000005', initiatorId: '100000001' }
  error(await f.bind(input), 403, 'FORBIDDEN') // No verified web-to-Telegram identity yet.
  const memberLink = await f.linkToken(f.tokens[1])
  assert.equal((await f.link(memberLink.body.token, '100000001')).status, 200)
  error(await f.bind(input), 403, 'FORBIDDEN') // Linked participant cannot act for organizer.
  const ownerLink = await f.linkToken()
  assert.equal((await f.link(ownerLink.body.token, '100000002')).status, 200)
  error(await f.bind(input), 403, 'FORBIDDEN') // Initiator ID differs from organizer's verified ID.
  const accepted = { ...input, initiatorId: '100000002' }
  assert.equal((await f.bind(accepted)).status, 200)
  error(await f.bind({ ...accepted, requestId: randomUUID() }), 409, 'TOKEN_EXPIRED')
  const foreignLink = await f.linkToken(f.foreignToken)
  assert.equal((await f.link(foreignLink.body.token, '100000009')).status, 200)
  const foreignBinding = await f.bindingToken(f.foreignToken)
  error(await f.bind({ requestId: randomUUID(), token: foreignBinding.body.token,
    chatId: accepted.chatId, initiatorId: '100000009' }), 409, 'LINK_CONFLICT')
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_bindings WHERE chat_id=?').get(accepted.chatId).n, 1)
  const expiring = await f.bindingToken()
  f.advance(600001)
  await f.restart()
  error(await f.bind({ requestId: randomUUID(), token: expiring.body.token,
    chatId: '-100000000006', initiatorId: '100000002' }), 409, 'TOKEN_EXPIRED')
})

test('HTTP/SQLite: active consent admits one fresh text and deduplicates both Telegram keys', async t => {
  const f = await fixture(t)
  const active = await f.activate()
  const input = textEvent(f, active.revision)
  assert.deepEqual(await f.bot('events', input),
    { status: 200, body: { eventId: input.eventId, result: 'accepted', revision: active.revision } })
  assert.equal(f.db.prepare('SELECT text FROM telegram_texts WHERE binding_id=?').get(f.id).text, input.text)
  assert.equal((await f.bot('events', input)).body.result, 'duplicate')
  assert.equal((await f.bot('events', { ...input, eventId: randomUUID() })).body.result, 'duplicate')
  error(await f.bot('events', { ...input, text: 'different' }), 409, 'EVENT_CONFLICT')
  error(await f.bot('events', { ...input, eventId: randomUUID(), text: 'different' }), 409, 'EVENT_CONFLICT')
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_texts').get().n, 1)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_message_ids').get().n, 1)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_event_ids').get().n, 2)
})

test('HTTP/SQLite: incomplete consent, wrong chat and invalid event never write text or state', async t => {
  const f = await fixture(t)
  const current = await f.status()
  error(await f.bot('events', textEvent(f, current.revision)), 409, 'CONSENT_REQUIRED')
  const active = await f.activate()
  for (const fields of [
    { chatId: '-100000000002' }, { expectedRevision: active.revision - 1 },
    { sentAt: new Date(f.time() - 60001).toISOString() },
    { sentAt: new Date(f.time() + 30001).toISOString() },
    { text: 'x'.repeat(4097) }, { text: ' ' }, { workspaceId: f.owner.workspace_id },
  ]) {
    const result = await f.bot('events', textEvent(f, active.revision, fields))
    assert.ok([400, 404, 409].includes(result.status), JSON.stringify(result))
  }
  error(await f.bot('events', textEvent(f, active.revision), f.otherBindingId), 404, 'NOT_FOUND')
  error(await f.bot('events', textEvent(f, active.revision), f.id, bootstrapCredential), 401, 'BOT_AUTH_REQUIRED')
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_texts').get().n, 0)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_event_ids').get().n, 0)
  assert.deepEqual(await f.status(), active)
})

test('HTTP/SQLite: unknown sender pauses chat and withdrawal removes retained text', async t => {
  const f = await fixture(t)
  const active = await f.activate()
  assert.equal((await f.bot('events', textEvent(f, active.revision))).body.result, 'accepted')
  const unknown = await f.bot('events', textEvent(f, active.revision,
    { eventId: randomUUID(), messageId: '43', senderId: '999999999' }))
  assert.equal(unknown.body.result, 'paused')
  assert.equal(unknown.body.revision, active.revision + 1)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_texts').get().n, 0)
  error(await f.bot('events', textEvent(f, unknown.body.revision, { messageId: '44' })), 409, 'CONSENT_REQUIRED')
  await f.prepare()
  for (let i = 0; i < 6; i++) await f.decision(i)
  const resumed = await f.mutate('control', { action: 'resume' })
  assert.equal((await f.bot('events', textEvent(f, resumed.body.revision, { messageId: '45' }))).body.result, 'accepted')
  await f.decision(0, 'withdrawn')
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_texts').get().n, 0)
})

test('HTTP/SQLite: raw text expires at 15 minutes, metadata at 24 hours across restart', async t => {
  const f = await fixture(t)
  const active = await f.activate()
  const input = textEvent(f, active.revision)
  assert.equal((await f.bot('events', input)).body.result, 'accepted')
  f.advance(900001)
  await f.restart()
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_texts').get().n, 0)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_event_ids').get().n, 1)
  f.advance(86400000)
  await f.restart()
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_event_ids').get().n, 0)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_message_ids').get().n, 0)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM checkins').get().n, 1)
})

test('HTTP/SQLite: four authors or 19 messages yield insufficient without numbers', async t => {
  const f = await fixture(t)
  const active = await f.activate()
  assert.equal((await f.setProfile()).status, 200)
  f.setTime(Date.parse('2026-11-02T03:00:00.000Z'))
  await sendMany(f, active.revision, 20, 4, 100)
  const firstClose = { requestId: randomUUID(), expectedRevision: active.revision, periodId: randomUUID() }
  assert.deepEqual(await f.closePeriod(firstClose), { status: 200, body: { status: 'insufficient' } })
  assert.deepEqual(await f.closePeriod(firstClose), { status: 200, body: { status: 'insufficient' } })
  error(await f.closePeriod({ ...firstClose, periodId: randomUUID() }), 409, 'EVENT_CONFLICT')
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_closed_periods').get().n, 1)
  assert.equal(f.db.prepare('SELECT metrics FROM telegram_closed_periods ORDER BY rowid DESC LIMIT 1').get().metrics, null)
  f.advance(DAY)
  await sendMany(f, active.revision, 19, 5, 200)
  assert.deepEqual(await closeCurrent(f, active.revision), { status: 200, body: { status: 'insufficient' } })
  assert.deepEqual((await f.summary()).body, { status: 'insufficient' })
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_period_authors').get().n, 0)
})

test('HTTP/SQLite: three synthetic closed dates publish only aggregate metrics and expire after seven days', async t => {
  const f = await fixture(t)
  const active = await f.activate()
  assert.equal((await f.setProfile()).status, 200)
  const base = Date.parse('2026-11-02T03:00:00.000Z')
  for (let day = 0; day < 2; day++) {
    f.setTime(base + day * DAY)
    await sendMany(f, active.revision, 20, 5, 300 + day * 100, 4)
    assert.deepEqual(await closeCurrent(f, active.revision), { status: 200, body: { status: 'calibrating' } })
  }
  f.setTime(base + 2 * DAY - 3600000)
  await sendMany(f, active.revision, 5, 5, 500, 4)
  f.advance(3600000)
  await f.restart() // The first five raw texts expired; only aggregate counters survive.
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_texts').get().n, 0)
  await sendMany(f, active.revision, 15, 5, 505)
  const published = await closeCurrent(f, active.revision)
  assert.equal(published.status, 200)
  assert.equal(published.body.status, 'published')
  assert.equal(published.body.demo, true)
  assert.deepEqual(published.body.metrics, {
    outsideHoursPercent: 25, participationEvenness: 89.8, recognitionPercent: 20,
  })
  assert.equal(published.body.comparison, null)
  assert.equal(JSON.stringify(published.body).includes('100000001'), false)
  assert.deepEqual((await f.summary()).body, published.body)
  await f.mutate('pause', { reason: 'manual' }, f.bot)
  assert.deepEqual((await f.summary()).body, { status: 'paused' })
  await f.mutate('control', { action: 'resume' })
  assert.deepEqual((await f.summary()).body, { status: 'insufficient' })
  f.advance(7 * DAY + 1)
  await f.restart()
  assert.deepEqual((await f.summary()).body, { status: 'insufficient' })
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_closed_periods').get().n, 0)
})

test('HTTP/SQLite: template card and edited chat action are scoped, replayable, and revoked', async t => {
  const f = await fixture(t)
  const { periodId, revision } = await publishForRecommendation(f)
  const earlier = f.db.prepare('SELECT period_id FROM telegram_closed_periods ORDER BY closed_at LIMIT 1').get().period_id
  error(await f.recommendation(earlier), 409, 'STALE_PERIOD')
  error(await f.recommendation(periodId, f.foreignToken), 404, 'NOT_FOUND')
  error(await f.recommendation(periodId, f.tokens[1]), 403, 'FORBIDDEN')
  error(await f.recommendation(periodId, ''), 401, 'SIGN_IN_REQUIRED')
  const cardResult = await f.recommendation(periodId)
  assert.equal(cardResult.status, 200)
  const card = cardResult.body
  assert.equal(card.periodId, periodId)
  assert.equal(card.profileVersion, 1)
  assert.equal(card.dataSource, 'chat')
  assert.equal(card.source, 'template')
  for (const field of ['observation', 'explanation', 'limitation', 'action']) assert.ok(card[field].length)
  const input = { requestId: randomUUID(), expectedRevision: revision, periodId,
    recommendationId: card.id, action: 'Обсудить удобное время на встрече.' }
  error(await f.confirmAction(periodId, input, f.foreignToken), 404, 'NOT_FOUND')
  error(await f.confirmAction(periodId, input, f.tokens[1]), 403, 'FORBIDDEN')
  error(await f.confirmAction(periodId, input, ''), 401, 'SIGN_IN_REQUIRED')
  error(await f.confirmAction(randomUUID(), input), 400, 'INVALID_INPUT')
  error(await f.confirmAction(periodId, { ...input, expectedRevision: revision - 1 }), 409, 'STALE_REVISION')
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_chat_actions').get().n, 0)
  const accepted = await f.confirmAction(periodId, input)
  assert.equal(accepted.status, 200)
  assert.equal(accepted.body.action, input.action)
  await f.restart()
  assert.deepEqual(await f.confirmAction(periodId, input), accepted)
  error(await f.confirmAction(periodId, { ...input, action: 'Другой шаг' }), 409, 'EVENT_CONFLICT')
  error(await f.confirmAction(periodId, { ...input, requestId: randomUUID() }), 409, 'EVENT_CONFLICT')
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_chat_actions').get().n, 1)
  assert.equal((await f.decision(1, 'withdrawn')).status, 200)
  error(await f.recommendation(periodId), 409, 'CONSENT_REQUIRED')
  error(await f.confirmAction(periodId, input), 409, 'CONSENT_REQUIRED')
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_chat_actions').get().n, 0)
})

test('HTTP/SQLite: expired published card and action disappear after restart', async t => {
  const f = await fixture(t)
  const { periodId, revision } = await publishForRecommendation(f)
  const card = (await f.recommendation(periodId)).body
  const input = { requestId: randomUUID(), expectedRevision: revision, periodId,
    recommendationId: card.id, action: 'Согласовать время обсуждений.' }
  assert.equal((await f.confirmAction(periodId, input)).status, 200)
  f.advance(7 * DAY + 1)
  await f.restart()
  error(await f.recommendation(periodId), 409, 'STALE_PERIOD')
  error(await f.confirmAction(periodId, input), 409, 'STALE_PERIOD')
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_chat_actions').get().n, 0)
})

test('HTTP/SQLite: hidden and expired periods have no recommendation or chat action', async t => {
  const f = await fixture(t)
  const active = await f.activate()
  await f.setProfile()
  const unknownPeriod = randomUUID()
  error(await f.recommendation(unknownPeriod), 409, 'STALE_PERIOD')
  f.setTime(Date.parse('2026-11-02T03:00:00.000Z'))
  await sendMany(f, active.revision, 19, 5, 5000)
  const insufficientId = randomUUID()
  assert.equal((await f.closePeriod({ requestId: randomUUID(), expectedRevision: active.revision, periodId: insufficientId })).body.status, 'insufficient')
  error(await f.recommendation(insufficientId), 409, 'STALE_PERIOD')
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_chat_actions').get().n, 0)
})

test('HTTP/SQLite: pause blocks a previously published card and confirmation', async t => {
  const f = await fixture(t)
  const { periodId, revision } = await publishForRecommendation(f)
  const card = (await f.recommendation(periodId)).body
  const paused = await f.mutate('pause', { reason: 'manual' }, f.bot)
  assert.equal(paused.body.phase, 'paused')
  error(await f.recommendation(periodId), 409, 'CONSENT_REQUIRED')
  error(await f.confirmAction(periodId, { requestId: randomUUID(), expectedRevision: revision,
    periodId, recommendationId: card.id, action: 'Обсудить график.' }), 409, 'CONSENT_REQUIRED')
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_chat_actions').get().n, 0)
})

test('HTTP/SQLite: four interpretation votes stay hidden and are deleted on close', async t => {
  const f = await fixture(t)
  const { periodId, revision } = await publishForRecommendation(f)
  const card = (await f.recommendation(periodId)).body
  const input = { requestId: randomUUID(), expectedRevision: revision,
    recommendationId: card.id, value: 'useful' }
  error(await f.chatFeedback(periodId, 'interpretation', input, f.foreignToken), 404, 'NOT_FOUND')
  error(await f.chatFeedback(periodId, 'interpretation', input, ''), 401, 'SIGN_IN_REQUIRED')
  for (let i = 1; i <= 4; i++) {
    assert.deepEqual(await f.chatFeedback(periodId, 'interpretation', { ...input, requestId: randomUUID() }, f.tokens[i]),
      { status: 200, body: { accepted: true } })
  }
  assert.deepEqual((await f.chatFeedback(periodId, 'interpretation', undefined)).body, { status: 'collecting' })
  error(await f.chatFeedback(periodId, 'interpretation', undefined, f.tokens[1]), 403, 'FORBIDDEN')
  const closeInput = { requestId: randomUUID(), expectedRevision: revision }
  assert.deepEqual((await f.closeChatFeedback(periodId, 'interpretation', closeInput)).body, { status: 'insufficient' })
  assert.deepEqual((await f.chatFeedback(periodId, 'interpretation', undefined)).body, { status: 'insufficient' })
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_feedback_votes').get().n, 0)
  error(await f.chatFeedback(periodId, 'interpretation', input, f.tokens[5]), 409, 'FEEDBACK_CLOSED')
  await f.restart()
  assert.deepEqual((await f.closeChatFeedback(periodId, 'interpretation', closeInput)).body, { status: 'insufficient' })
  error(await f.closeChatFeedback(periodId, 'interpretation', { requestId: randomUUID(), expectedRevision: revision }), 409, 'FEEDBACK_CLOSED')
})

test('HTTP/SQLite: five outcome votes publish only aggregate and withdrawal clears it', async t => {
  const f = await fixture(t)
  const { periodId, revision } = await publishForRecommendation(f)
  const card = (await f.recommendation(periodId)).body
  const action = (await f.confirmAction(periodId, { requestId: randomUUID(), expectedRevision: revision,
    periodId, recommendationId: card.id, action: 'Проверить удобное время.' })).body
  const feedback = { requestId: randomUUID(), expectedRevision: revision, actionId: action.id, value: 'helped' }
  error(await f.chatFeedback(randomUUID(), 'outcome', feedback, f.tokens[1]), 409, 'STALE_PERIOD')
  error(await f.chatFeedback(periodId, 'outcome', { ...feedback, actionId: randomUUID() }, f.tokens[1]), 409, 'STALE_PERIOD')
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_feedback_votes').get().n, 0)
  assert.deepEqual(await f.chatFeedback(periodId, 'outcome', feedback, f.tokens[1]),
    { status: 200, body: { accepted: true } })
  await f.restart()
  assert.deepEqual(await f.chatFeedback(periodId, 'outcome', feedback, f.tokens[1]),
    { status: 200, body: { accepted: true } })
  error(await f.chatFeedback(periodId, 'outcome', { ...feedback, value: 'not_helped' }, f.tokens[1]), 409, 'EVENT_CONFLICT')
  error(await f.chatFeedback(periodId, 'outcome', { ...feedback, requestId: randomUUID() }, f.tokens[1]), 409, 'EVENT_CONFLICT')
  error(await f.chatFeedback(periodId, 'outcome', feedback, f.foreignToken), 404, 'NOT_FOUND')
  error(await f.closeChatFeedback(periodId, 'outcome', { requestId: randomUUID(), expectedRevision: revision }, f.foreignToken), 404, 'NOT_FOUND')
  for (const i of [0, 2, 3, 4]) {
    assert.equal((await f.chatFeedback(periodId, 'outcome', { ...feedback,
      requestId: randomUUID(), value: i === 4 ? 'not_helped' : 'helped' }, f.tokens[i])).status, 200)
  }
  assert.deepEqual((await f.chatFeedback(periodId, 'outcome', undefined)).body, { status: 'collecting' })
  const closeInput = { requestId: randomUUID(), expectedRevision: revision }
  assert.deepEqual((await f.closeChatFeedback(periodId, 'outcome', closeInput)).body,
    { status: 'published', demo: true, kind: 'outcome', total: 5, counts: { helped: 4, not_helped: 1 } })
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_feedback_votes').get().n, 0)
  assert.deepEqual((await f.chatFeedback(periodId, 'outcome', undefined)).body,
    { status: 'published', demo: true, kind: 'outcome', total: 5, counts: { helped: 4, not_helped: 1 } })
  await f.restart()
  assert.deepEqual(await f.chatFeedback(periodId, 'outcome', feedback, f.tokens[1]),
    { status: 200, body: { accepted: true } })
  error(await f.chatFeedback(periodId, 'outcome', { ...feedback, requestId: randomUUID() }, f.tokens[5]), 409, 'FEEDBACK_CLOSED')
  for (let i = 0; i < 5; i++) {
    assert.equal((await f.chatFeedback(periodId, 'interpretation', { requestId: randomUUID(),
      expectedRevision: revision, recommendationId: card.id,
      value: i === 4 ? 'usual_joke' : 'useful' }, f.tokens[i])).status, 200)
  }
  assert.deepEqual((await f.closeChatFeedback(periodId, 'interpretation', { requestId: randomUUID(), expectedRevision: revision })).body,
    { status: 'published', demo: true, kind: 'interpretation', total: 5,
      counts: { useful: 4, incorrect: 0, usual_joke: 1 } })
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_feedback_votes').get().n, 0)
  assert.equal((await f.decision(2, 'withdrawn')).status, 200)
  error(await f.chatFeedback(periodId, 'outcome', undefined), 409, 'CONSENT_REQUIRED')
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_feedback_collections').get().n, 0)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_feedback_requests').get().n, 0)
})

test('HTTP/SQLite: withdrawal, roster change and transport gap discard an open period', async t => {
  const f = await fixture(t)
  const active = await f.activate()
  assert.equal((await f.setProfile()).status, 200)
  f.setTime(Date.parse('2026-11-02T03:00:00.000Z'))
  await sendMany(f, active.revision, 1, 1, 600)
  error(await f.closePeriod({ requestId: randomUUID(), expectedRevision: active.revision,
    periodId: randomUUID() }, f.foreignToken), 404, 'NOT_FOUND')
  error(await f.closePeriod({ requestId: randomUUID(), expectedRevision: active.revision,
    periodId: randomUUID() }, f.tokens[1]), 403, 'FORBIDDEN')
  await f.decision(0, 'withdrawn')
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_open_periods').get().n, 0)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_texts').get().n, 0)
  error(await closeCurrent(f, active.revision), 409, 'STALE_REVISION')
  await f.decision(0)
  const resumed = await f.mutate('control', { action: 'resume' })
  await sendMany(f, resumed.body.revision, 1, 1, 601)
  await f.mutate('pause', { reason: 'transport_gap' }, f.bot)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_open_periods').get().n, 0)
  const resumedAgain = await f.mutate('control', { action: 'resume' })
  error(await closeCurrent(f, resumedAgain.body.revision), 409, 'STALE_PERIOD')
  await sendMany(f, resumedAgain.body.revision, 1, 1, 602)
  await f.mutate('roster', { memberIds: f.people.map(person => person.id), verified: true })
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_open_periods').get().n, 0)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_closed_periods').get().n, 0)
})

test('HTTP/SQLite: without a schedule the active chat calibrates without invented values', async t => {
  const f = await fixture(t)
  const active = await f.activate()
  assert.deepEqual((await f.profile()).body, { version: 0, timeZone: null, intervals: [] })
  assert.deepEqual((await f.summary()).body, { status: 'calibrating' })
  await sendMany(f, active.revision, 20, 5, 700)
  assert.deepEqual((await f.summary()).body, { status: 'calibrating' })
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_open_periods').get().n, 0)
  error(await closeCurrent(f, active.revision), 409, 'STALE_PERIOD')
})

test('HTTP/SQLite: invalid profiles and foreign actors cannot alter a team profile or open period', async t => {
  const f = await fixture(t)
  const active = await f.activate()
  const saved = await f.setProfile()
  assert.equal(saved.body.version, 1)
  f.setTime(Date.parse('2026-11-02T04:00:00.000Z'))
  await sendMany(f, active.revision, 1, 1, 710)
  const open = f.db.prepare('SELECT * FROM telegram_open_periods WHERE binding_id=?').get(f.id)
  const base = { requestId: randomUUID(), expectedVersion: 1, timeZone: 'Asia/Omsk', intervals: demoIntervals }
  for (const changes of [
    { timeZone: 'Mars/Olympus' }, { intervals: [{ day: 0, start: 1, end: 2 }] },
    { intervals: [{ day: 1, start: 600, end: 600 }] },
    { intervals: [{ day: 1, start: 600, end: 700 }, { day: 1, start: 699, end: 800 }] },
    { intervals: [{ day: 1, start: 0, end: 1441 }] },
    { intervals: [{ day: 1, start: 1320, end: 360 }] },
    { workspaceId: f.foreignOwner.workspace_id },
  ]) error(await f.profile({ ...base, requestId: randomUUID(), ...changes }), 400, 'INVALID_INPUT')
  error(await f.profile({ ...base, requestId: randomUUID() }, f.tokens[1]), 403, 'FORBIDDEN')
  error(await f.profile({ ...base, requestId: randomUUID(), workspaceId: f.owner.workspace_id }, f.foreignToken), 400, 'INVALID_INPUT')
  assert.deepEqual((await f.profile()).body, saved.body)
  assert.deepEqual(f.db.prepare('SELECT * FROM telegram_open_periods WHERE binding_id=?').get(f.id), open)
  const foreign = await f.profile({ requestId: randomUUID(), expectedVersion: 0,
    timeZone: 'UTC', intervals: [{ day: 1, start: 0, end: 1440 }] }, f.foreignToken)
  assert.equal(foreign.body.version, 1)
  assert.deepEqual((await f.profile()).body, saved.body)
  const splitNight = await f.profile({ requestId: randomUUID(), expectedVersion: 1,
    timeZone: 'UTC', intervals: [{ day: 1, start: 1320, end: 1440 }, { day: 2, start: 0, end: 360 }] }, f.foreignToken)
  assert.equal(splitNight.body.version, 2)
  const update = { requestId: randomUUID(), expectedVersion: 1, timeZone: 'UTC', intervals: demoIntervals }
  const changed = await f.profile(update)
  assert.equal(changed.body.version, 2)
  assert.deepEqual(await f.profile(update), changed)
  error(await f.profile({ ...update, timeZone: 'Asia/Omsk' }), 409, 'EVENT_CONFLICT')
  error(await f.profile({ ...update, requestId: randomUUID() }), 409, 'STALE_REVISION')
  await f.restart()
  assert.deepEqual((await f.profile()).body, changed.body)
  assert.deepEqual((await f.profile(undefined, f.foreignToken)).body, splitNight.body)
})

test('HTTP/SQLite: profile version discards open work and starts calibration again', async t => {
  const f = await fixture(t)
  const active = await f.activate()
  await f.setProfile()
  const base = Date.parse('2026-11-02T04:00:00.000Z')
  for (let day = 0; day < 2; day++) {
    f.setTime(base + day * DAY)
    await sendMany(f, active.revision, 20, 5, 800 + day * 100)
    assert.equal((await closeCurrent(f, active.revision)).body.status, 'calibrating')
  }
  f.setTime(base + 2 * DAY)
  await sendMany(f, active.revision, 1, 1, 1000)
  const changed = await f.profile({ requestId: randomUUID(), expectedVersion: 1,
    timeZone: 'UTC', intervals: demoIntervals })
  assert.equal(changed.body.version, 2)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_open_periods').get().n, 0)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_closed_periods').get().n, 0)
  await sendMany(f, active.revision, 20, 5, 1001)
  assert.deepEqual((await closeCurrent(f, active.revision)).body, { status: 'calibrating' })
  assert.equal(f.db.prepare('SELECT profile_version FROM telegram_closed_periods').get().profile_version, 2)
})

test('HTTP/SQLite: two teams with different schedules get different aggregate outside-hours values', async t => {
  const f = await fixture(t)
  const active = await f.activate()
  const foreign = await activateForeign(f)
  assert.equal((await f.setProfile()).body.version, 1)
  assert.equal((await f.profile({ requestId: randomUUID(), expectedVersion: 0, timeZone: 'Asia/Omsk',
    intervals: [1, 2, 3, 4, 5].map(day => ({ day, start: 1080, end: 1380 })) }, f.foreignToken)).body.version, 1)
  const base = Date.parse('2026-11-02T04:00:00.000Z')
  let ownView, foreignView
  for (let day = 0; day < 3; day++) {
    f.setTime(base + day * DAY)
    await sendMany(f, active.revision, 20, 5, 1100 + day * 100)
    await sendMany(f, foreign.revision, 20, 5, 1100 + day * 100, 0, foreign)
    ownView = await closeCurrent(f, active.revision)
    foreignView = await closeCurrent(f, foreign.revision, f.foreignToken, foreign.bindingId)
  }
  assert.equal(ownView.body.status, 'published')
  assert.equal(foreignView.body.status, 'published')
  assert.equal(ownView.body.metrics.outsideHoursPercent, 0)
  assert.equal(foreignView.body.metrics.outsideHoursPercent, 100)
  assert.equal(ownView.body.metrics.participationEvenness, foreignView.body.metrics.participationEvenness)
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
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_identities WHERE workspace_id=?').get(f.owner.workspace_id).n, 0)
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

test('Telegram synthetic gate defaults off and unfinished summary routes remain absent', async t => {
  const f = await fixture(t, { enabled: false })
  error(await f.bot(''), 503, 'UNAVAILABLE')
  error(await f.web('control', f.command(1, { action: 'resume' })), 503, 'UNAVAILABLE')
  error(await f.bot('events', { text: 'synthetic text must not be stored' }), 503, 'UNAVAILABLE')
  error(await f.request('/telegram/link-tokens', { requestId: randomUUID() }), 503, 'UNAVAILABLE')
  error(await f.recommendation(randomUUID()), 503, 'UNAVAILABLE')
  error(await f.chatFeedback(randomUUID(), 'interpretation', undefined), 503, 'UNAVAILABLE')
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_requests').get().n, 0)
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE 'telegram_%'").get().n, 22)
})
