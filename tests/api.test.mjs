import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createApp, resolveSecureCookies } from '../server/app.mjs'
import { createStore } from '../server/store.mjs'
import { DatabaseSync } from 'node:sqlite'

const secret = 'test-secret-used-only-in-automated-tests-123456789'
const normal = { energy: 4, clarity: 4, support: 4 }
const unclear = { energy: 4, clarity: 1, support: 4 }

test('health endpoint returns the Compose readiness response', async t => {
  const { client } = await start(t)
  const result = await client()('/health')
  assert.equal(result.status, 200)
  assert.deepEqual(result.body, { ok: true })
})

test('SPA fallback serves index.html for routes without file extension outside /api/', async t => {
  const staticDir = await mkdtemp(join(tmpdir(), 'vibee-test-spa-'))
  await writeFile(join(staticDir, 'index.html'), '<!doctype html><html><body>SPA</body></html>')

  const app = createApp({ secret, dbPath: ':memory:', staticDir })
  await new Promise(resolveListen => app.server.listen(0, '127.0.0.1', resolveListen))
  t.after(async () => {
    await app.close()
    await rm(staticDir, { recursive: true, force: true })
  })
  const base = 'http://127.0.0.1:' + app.server.address().port

  const rootRes = await fetch(base + '/')
  assert.equal(rootRes.status, 200)
  assert.equal(await rootRes.text(), '<!doctype html><html><body>SPA</body></html>')

  const demoRes = await fetch(base + '/demo')
  assert.equal(demoRes.status, 200)
  assert.equal(demoRes.headers.get('content-type'), 'text/html; charset=utf-8')
  assert.equal(await demoRes.text(), '<!doctype html><html><body>SPA</body></html>')

  const deepRes = await fetch(base + '/teams/settings')
  assert.equal(deepRes.status, 200)
  assert.equal(await deepRes.text(), '<!doctype html><html><body>SPA</body></html>')

  const missingFileRes = await fetch(base + '/missing.js')
  assert.equal(missingFileRes.status, 404)
})

test('allowed origins and production secure cookies are enforced', async t => {
  const { client } = await start(t, undefined, {
    secureCookies: true,
    allowedOrigins: ['https://app.example'],
  })
  const trusted = await client()('/workspaces', { name: 'Synthetic', displayName: 'Owner' },
    { Origin: 'https://app.example' })
  assert.equal(trusted.status, 201)
  assert.match(trusted.setCookie, /; HttpOnly;/)
  assert.match(trusted.setCookie, /; SameSite=Strict;/)
  assert.match(trusted.setCookie, /; Secure(?:;|$)/)
  assert.equal(trusted.headers['access-control-allow-origin'], undefined)

  const rejected = await client()('/workspaces', { name: 'Untrusted', displayName: 'Owner' },
    { Origin: 'https://untrusted.example' })
  assert.equal(rejected.status, 403)
  assert.equal(rejected.body.error.code, 'ORIGIN_REJECTED')
})

test('secure cookies default on in production and can be disabled for local HTTP', () => {
  assert.equal(resolveSecureCookies({ NODE_ENV: 'production' }), true)
  assert.equal(resolveSecureCookies({ NODE_ENV: 'production', COOKIE_SECURE: 'true' }), true)
  assert.equal(resolveSecureCookies({ NODE_ENV: 'production', COOKIE_SECURE: 'false' }), false)
  assert.equal(resolveSecureCookies({ NODE_ENV: 'development' }), false)
  assert.equal(resolveSecureCookies({ NODE_ENV: 'development', COOKIE_SECURE: 'true' }), true)
})

test('current web client header is accepted without the legacy header', async t => {
  const { client } = await start(t)
  const result = await client()('/workspaces', { name: 'Synthetic', displayName: 'Owner' },
    { 'X-VibeBot': '', 'X-Vibee': '1' })
  assert.equal(result.status, 201)
})

test('organizer work schedule is saved and returned while Telegram ingestion remains disabled', async t => {
  const { owner } = await team(t, 1)
  assert.deepEqual((await owner('/telegram/profile')).body, {
    version: 0,
    timeZone: null,
    intervals: [],
  })

  const saved = await owner('/telegram/profile', {
    requestId: randomUUID(),
    expectedVersion: 0,
    timeZone: 'Asia/Omsk',
    intervals: [
      { day: 1, start: 600, end: 1140 },
      { day: 2, start: 600, end: 1140 },
      { day: 3, start: 600, end: 1140 },
      { day: 4, start: 600, end: 1140 },
      { day: 5, start: 600, end: 1140 },
    ],
  })
  assert.equal(saved.status, 200)
  assert.equal(saved.body.version, 1)
  assert.equal(saved.body.timeZone, 'Asia/Omsk')
  assert.equal(saved.body.intervals.length, 5)
  assert.deepEqual((await owner('/telegram/profile')).body, saved.body)
  assert.equal((await owner('/telegram/binding-tokens', { requestId: randomUUID() })).body.error.code, 'UNAVAILABLE')
})

async function start(t, dbPath, appOptions = {}) {
  const app = createApp({ ...appOptions, secret, dbPath })
  await new Promise(resolveListen => app.server.listen(0, '127.0.0.1', resolveListen))
  let closed = false
  const close = async () => { if (!closed) { closed = true; await app.close() } }
  t.after(close)
  const base = 'http://127.0.0.1:' + app.server.address().port
  const client = () => {
    let cookie = ''
    return async (path, input, extraHeaders = {}) => {
      const response = await fetch(base + '/api' + path, {
        method: input === undefined ? 'GET' : 'POST',
        headers: { ...(input === undefined ? {} : { 'Content-Type': 'application/json', 'X-VibeBot': '1' }), ...(cookie ? { Cookie: cookie } : {}), ...extraHeaders },
        ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      })
      const setCookie = response.headers.get('set-cookie')
      if (setCookie) cookie = setCookie.split(';')[0]
      return {
        status: response.status,
        body: await response.json(),
        setCookie,
        headers: Object.fromEntries(response.headers.entries()),
      }
    }
  }
  return { client, close }
}

async function team(t, size) {
  const env = await start(t)
  const owner = env.client()
  const created = await owner('/workspaces', { name: 'РўРµСЃС‚РѕРІР°СЏ РєРѕРјР°РЅРґР°', displayName: 'РћСЂРіР°РЅРёР·Р°С‚РѕСЂ' })
  assert.equal(created.status, 201)
  const people = [owner]
  for (let i = 1; i < size; i++) {
    const invitation = await owner('/invitations', {})
    const person = env.client()
    assert.equal((await person('/join', { token: invitation.body.token, displayName: 'РЈС‡Р°СЃС‚РЅРёРє ' + i })).status, 201)
    people.push(person)
  }
  return { ...env, owner, people, roundId: created.body.round.id }
}

test('complete shared flow: private check-ins, frozen summary, confirmed action and closed feedback', async t => {
  const { owner, people, roundId } = await team(t, 6)
  for (let i = 0; i < people.length; i++) {
    assert.equal((await people[i]('/checkins', { roundId, scores: i < 3 ? unclear : normal })).status, 200)
  }
  assert.deepEqual((await owner('/summary')).body, { status: 'open' })
  const before = (await people[1]('/session')).body
  assert.deepEqual(before.round.summary, { status: 'open' })
  assert.equal(before.round.mySubmitted, true)
  assert.equal(before.suggestions.some(s => s.id === 'clarity'), false)
  assert.equal((await people[1]('/rounds/close', { roundId })).status, 403)
  const closed = await owner('/rounds/close', { roundId })
  assert.equal(closed.body.round.summary.status, 'published')
  assert.deepEqual((await owner('/summary')).body, closed.body.round.summary)
  assert.deepEqual(closed.body.round.summary.needs, ['clarity'])
  assert.equal(closed.body.round.summary.means.clarity, 2.5)
  assert.doesNotMatch(JSON.stringify(closed.body), /voter_key|token_hash|"answers"|"scores"|"participants"/)
  assert.equal((await people[0]('/checkins', { roundId, scores: normal })).status, 409)
  const accepted = await people[2]('/actions', { roundId, suggestionId: 'clarity', goal: 'РЎРµРіРѕРґРЅСЏ РґРѕРІРѕРґРёРј РѕСЃРЅРѕРІРЅРѕР№ СЃС†РµРЅР°СЂРёР№ РґРѕ РґРµРјРѕ' })
  assert.equal(accepted.status, 200)
  const actionId = accepted.body.actions[0].id
  assert.equal((await people[4]('/session')).body.actions[0].goal, 'РЎРµРіРѕРґРЅСЏ РґРѕРІРѕРґРёРј РѕСЃРЅРѕРІРЅРѕР№ СЃС†РµРЅР°СЂРёР№ РґРѕ РґРµРјРѕ')
  assert.equal((await owner('/actions', { roundId, suggestionId: 'clarity', goal: 'Р”СѓР±Р»СЊ' })).status, 409)
  for (let i = 0; i < people.length; i++) {
    const result = await people[i]('/actions/' + actionId + '/feedback', { helpful: i < 5 })
    assert.equal(result.status, 200)
    assert.deepEqual(result.body.actions[0].feedback, { status: 'open' })
  }
  const feedback = await owner('/actions/' + actionId + '/close-feedback', {})
  assert.deepEqual(feedback.body.actions[0].feedback, { status: 'published', helpfulPercent: 83 })
  assert.equal((await people[1]('/actions/' + actionId + '/feedback', { helpful: false })).status, 409)
  const next = await owner('/rounds/open', {})
  assert.notEqual(next.body.round.id, roundId)
  assert.deepEqual(next.body.round.summary, { status: 'open' })
  assert.equal(next.body.actions[0].id, actionId)
  assert.equal((await owner('/checkins', { roundId, scores: normal })).body.error.code, 'STALE_ROUND')
})

test('repeated answers by four memberships cannot satisfy the threshold', async t => {
  const { owner, people, roundId } = await team(t, 4)
  for (const person of people) {
    for (let i = 0; i < 3; i++) assert.equal((await person('/checkins', { roundId, scores: unclear })).status, 200)
  }
  const closed = await owner('/rounds/close', { roundId })
  assert.deepEqual(closed.body.round.summary, { status: 'insufficient' })
  assert.deepEqual(closed.body.suggestions.map(s => s.id), ['recognition'])
})

test('editing one answer replaces it instead of increasing its weight', async t => {
  const { owner, people, roundId } = await team(t, 5)
  for (const person of people) await person('/checkins', { roundId, scores: normal })
  for (let i = 0; i < 4; i++) await owner('/checkins', { roundId, scores: unclear })
  const closed = await owner('/rounds/close', { roundId })
  assert.deepEqual(closed.body.round.summary.needs, [])
  assert.equal(closed.body.round.summary.means.clarity, 3.4)
})

test('feedback below threshold remains hidden after closure', async t => {
  const { owner, people, roundId } = await team(t, 4)
  const accepted = await owner('/actions', { roundId, suggestionId: 'recognition', goal: 'РќР°Р·РѕРІС‘Рј РєРѕРЅРєСЂРµС‚РЅС‹Р№ РІРєР»Р°Рґ РєРѕР»Р»РµРіРё' })
  const id = accepted.body.actions[0].id
  for (const person of people) await person('/actions/' + id + '/feedback', { helpful: true })
  const closed = await owner('/actions/' + id + '/close-feedback', {})
  assert.deepEqual(closed.body.actions[0].feedback, { status: 'insufficient' })
})

test('invitations are single-use and ordinary participants cannot create them', async t => {
  const { owner, client, people } = await team(t, 2)
  const invite = await owner('/invitations', {})
  const results = await Promise.all([client(), client()].map(person => person('/join', { token: invite.body.token, displayName: 'РќРѕРІС‹Р№ СѓС‡Р°СЃС‚РЅРёРє' })))
  assert.deepEqual(results.map(r => r.status).sort(), [201, 400])
  assert.equal((await people[1]('/invitations', {})).status, 403)
})

test('room key is generated on workspace creation and allows fast participant onboarding via /join-by-key', async t => {
  const { client } = await start(t)
  const owner = client()
  const created = await owner('/workspaces', { name: 'Альфа', displayName: 'Тимлид' })
  assert.equal(created.status, 201)
  const roomKey = created.body.workspace.roomKey
  assert.equal(typeof roomKey, 'string')
  assert.match(roomKey, /^[A-F0-9]{8}$/)

  const participant = client()
  const joined = await participant('/join-by-key', { roomKey: roomKey.toLowerCase() })
  assert.equal(joined.status, 201)
  assert.equal(joined.body.workspace.name, 'Альфа')
  assert.equal(joined.body.member.role, 'participant')
  assert.equal(joined.body.workspace.roomKey, undefined)

  const badJoin = await client()('/join-by-key', { roomKey: 'ZZZZ9999' })
  assert.equal(badJoin.status, 400)
  assert.equal(badJoin.body.error.code, 'INVALID_ROOM_KEY')
})

test('session, JSON values, request origin and workspace boundaries are enforced', async t => {
  const { owner, client, roundId } = await team(t, 1)
  const outsider = client()
  assert.equal((await outsider('/session')).status, 401)
  assert.equal((await outsider('/summary')).status, 401)
  assert.equal((await owner('/checkins', { roundId, scores: { ...normal, energy: 0 } })).status, 400)
  assert.equal((await owner('/checkins', { roundId, scores: { ...normal, energy: 2.5 } })).status, 400)
  assert.equal((await owner('/checkins', { roundId, scores: normal }, { Origin: 'https://other.example' })).status, 403)
  assert.equal((await owner('/checkins', { roundId, scores: normal }, { 'X-VibeBot': '' })).status, 403)
  const accepted = await owner('/actions', { roundId, suggestionId: 'recognition', goal: 'РЎРїР°СЃРёР±Рѕ РєРѕРјР°РЅРґРµ' })
  await outsider('/workspaces', { name: 'Р”СЂСѓРіР°СЏ РєРѕРјР°РЅРґР°', displayName: 'Р”СЂСѓРіРѕР№ РѕСЂРіР°РЅРёР·Р°С‚РѕСЂ' })
  assert.equal((await outsider('/actions/' + accepted.body.actions[0].id + '/feedback', { helpful: true })).status, 404)
  assert.equal((await owner('/checkins')).status, 404)
  await owner('/logout', {})
  assert.equal((await owner('/session')).status, 401)
})

test('accepted actions are capped at two per workspace in a rolling day', async t => {
  const { owner, roundId } = await team(t, 1)
  await owner('/actions', { roundId, suggestionId: 'recognition', goal: 'РџРµСЂРІС‹Р№ С€Р°Рі' })
  await owner('/rounds/close', { roundId })
  const second = (await owner('/rounds/open', {})).body.round.id
  await owner('/actions', { roundId: second, suggestionId: 'recognition', goal: 'Р’С‚РѕСЂРѕР№ С€Р°Рі' })
  await owner('/rounds/close', { roundId: second })
  const third = (await owner('/rounds/open', {})).body.round.id
  assert.equal((await owner('/actions', { roundId: third, suggestionId: 'recognition', goal: 'РўСЂРµС‚РёР№ С€Р°Рі' })).body.error.code, 'DAILY_LIMIT')
})

test('personal access key restores the same identity and role; rotation invalidates the old key', async t => {
  const { owner, client, roundId } = await team(t, 1)
  await owner('/checkins', { roundId, scores: unclear })
  const first = await owner('/recovery-key', {})
  const second = await owner('/recovery-key', {})
  assert.equal(first.status, 201)
  assert.notEqual(first.body.key, second.body.key)
  await owner('/logout', {})
  const restored = client()
  assert.equal((await restored('/restore', { key: first.body.key })).status, 400)
  const result = await restored('/restore', { key: second.body.key })
  assert.equal(result.status, 201)
  assert.equal(result.body.member.role, 'organizer')
  assert.equal(result.body.round.mySubmitted, true)
  await restored('/checkins', { roundId, scores: normal })
  assert.deepEqual((await restored('/rounds/close', { roundId })).body.round.summary, { status: 'insufficient' })
})

test('SQLite preserves shared state across server restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'vibee-test-sqlite-'))
  const path = join(directory, 'test.sqlite')
  let first = null
  let second = null
  t.after(async () => {
    if (first) await first.close()
    if (second) await second.close()
    await rm(directory, { recursive: true, force: true })
  })
  first = await start(t, path)
  const owner = first.client()
  const created = await owner('/workspaces', { name: 'РџРѕСЃС‚РѕСЏРЅРЅР°СЏ РєРѕРјР°РЅРґР°', displayName: 'РћСЂРіР°РЅРёР·Р°С‚РѕСЂ' })
  const invitation = await owner('/invitations', {})
  const roundId = created.body.round.id
  await owner('/checkins', { roundId, scores: normal })
  await owner('/rounds/close', { roundId })
  const action = await owner('/actions', { roundId, suggestionId: 'recognition', goal: 'РЎРѕС…СЂР°РЅС‘РЅРЅС‹Р№ С€Р°Рі' })
  const actionId = action.body.actions[0].id
  await owner('/actions/' + actionId + '/feedback', { helpful: true })
  await owner('/actions/' + actionId + '/close-feedback', {})
  await first.close()
  first = null

  second = await start(t, path)
  const participant = second.client()
  const joined = await participant('/join', { token: invitation.body.token, displayName: 'РЈС‡Р°СЃС‚РЅРёРє' })
  assert.equal(joined.body.workspace.name, 'РџРѕСЃС‚РѕСЏРЅРЅР°СЏ РєРѕРјР°РЅРґР°')
  assert.equal(joined.body.actions[0].goal, 'РЎРѕС…СЂР°РЅС‘РЅРЅС‹Р№ С€Р°Рі')
  await second.close()
  second = null

  const inspection = new DatabaseSync(path)
  try {
    assert.equal(inspection.prepare('SELECT COUNT(*) AS n FROM checkins').get().n, 0)
    assert.equal(inspection.prepare('SELECT COUNT(*) AS n FROM feedback').get().n, 0)
  } finally { inspection.close() }
})

test('anonymous Telegram check-in stats: organizer-only, k-anonymity, workspace isolation and TTL', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'vibee-stats-test-'))
  const path = join(directory, 'test.sqlite')
  const env = await start(t, path)
  t.after(async () => {
    await env.close()
    await rm(directory, { recursive: true, force: true })
  })
  const owner = env.client()
  const created = await owner('/workspaces', { name: 'Команда статистики', displayName: 'Организатор' })
  assert.equal(created.status, 201)
  const person = env.client()
  const invitation = await owner('/invitations', {})
  assert.equal((await person('/join', { token: invitation.body.token, displayName: 'Участник' })).status, 201)

  // Прямые вставки в БД делаем короткими сессиями: открыли соединение, записали,
  // закрыли — чтобы не держать второе соединение к WAL-базе параллельно с сервером.
  const seed = fn => {
    const db = new DatabaseSync(path)
    try { return fn(db) } finally { db.close() }
  }
  const bindingId = randomUUID()
  seed(db => {
    const workspaceId = db.prepare('SELECT id FROM workspaces LIMIT 1').get().id
    db.prepare('INSERT INTO telegram_bindings(id,workspace_id,chat_id,state) VALUES(?,?,?,?)')
      .run(bindingId, workspaceId, null, '{}')
    const insert = db.prepare('INSERT INTO telegram_checkins(binding_id,nonce,digest,energy,clarity,support,created_at,expires) VALUES(?,?,?,?,?,?,?,?)')
    for (let i = 0; i < 4; i++) insert.run(bindingId, 'a' + i + 'b' + i, 'd' + i, 4, 3, 5, Date.now(), Date.now() + 86400000)
  })

  // Меньше пяти ответов — показатели скрыты.
  const hidden = await owner('/telegram-checkin-stats')
  assert.equal(hidden.status, 200)
  assert.deepEqual(hidden.body, { status: 'hidden', reason: 'insufficient_responses', total: 4 })

  // Пятый ответ открывает агрегаты.
  seed(db => db.prepare('INSERT INTO telegram_checkins(binding_id,nonce,digest,energy,clarity,support,created_at,expires) VALUES(?,?,?,?,?,?,?,?)')
    .run(bindingId, 'a4b4', 'd4', 2, 4, 1, Date.now(), Date.now() + 86400000))
  const visible = await owner('/telegram-checkin-stats')
  assert.equal(visible.status, 200)
  assert.equal(visible.body.status, 'visible')
  assert.equal(visible.body.total, 5)
  assert.deepEqual(visible.body.metrics.energy, { average: 3.6, distribution: { 1: 0, 2: 1, 3: 0, 4: 4, 5: 0 } })
  assert.equal(visible.body.metrics.clarity.average, 3.2)
  assert.equal(visible.body.metrics.support.average, 4.2)
  const serialized = JSON.stringify(visible.body)
  assert.ok(!serialized.includes('nonce') && !serialized.includes('digest') && !serialized.includes('binding'))

  // Участник не имеет доступа.
  const denied = await person('/telegram-checkin-stats')
  assert.equal(denied.status, 403)
  assert.equal(denied.body.error.code, 'FORBIDDEN')

  // Без сессии — 401.
  assert.equal((await env.client()('/telegram-checkin-stats')).status, 401)

  // Чек-ины другой команды не попадают в статистику: отдельный workspace,
  // свой binding и свой чек-ин.
  seed(db => {
    const foreignWorkspace = randomUUID()
    db.prepare('INSERT INTO workspaces(id,name) VALUES(?,?)').run(foreignWorkspace, 'Чужая команда')
    const foreignBinding = randomUUID()
    db.prepare('INSERT INTO telegram_bindings(id,workspace_id,chat_id,state) VALUES(?,?,?,?)')
      .run(foreignBinding, foreignWorkspace, null, '{}')
    db.prepare('INSERT INTO telegram_checkins(binding_id,nonce,digest,energy,clarity,support,created_at,expires) VALUES(?,?,?,?,?,?,?,?)')
      .run(foreignBinding, 'z0', 'z0', 1, 1, 1, Date.now(), Date.now() + 86400000)
  })
  assert.equal((await owner('/telegram-checkin-stats')).body.total, 5)

  // Просроченные записи не учитываются.
  seed(db => db.prepare("UPDATE telegram_checkins SET expires=? WHERE binding_id=? AND nonce='a0b0'").run(Date.now() - 1, bindingId))
  const afterExpiry = await owner('/telegram-checkin-stats')
  assert.deepEqual(afterExpiry.body, { status: 'hidden', reason: 'insufficient_responses', total: 4 })
})

test('unhandled 500 error logs error name and stack without sensitive request data', async t => {
  const originalError = console.error
  const logged = []
  console.error = (...args) => {
    logged.push(args)
  }
  t.after(() => {
    console.error = originalError
  })

  const directory = await mkdtemp(join(tmpdir(), 'vibee-test-500-'))
  const dbPath = join(directory, 'corrupt.sqlite')

  const { client, close } = await start(t, dbPath)
  t.after(async () => {
    await close()
    await rm(directory, { recursive: true, force: true })
  })

  // Corrupt the database table so store.workspace throws an unexpected SqliteError
  const db = new DatabaseSync(dbPath)
  db.exec('DROP TABLE workspaces;')
  db.close()

  const sensitivePayload = 'sensitive-password-12345'
  const sensitiveCookie = 'vibebot_session=sensitive-secret-token'
  const sensitiveHeader = 'sensitive-secret-header'

  const res = await client()('/workspaces', { name: sensitivePayload, displayName: 'Test' }, {
    Cookie: sensitiveCookie,
    'X-Custom-Secret': sensitiveHeader,
  })

  assert.equal(res.status, 500)
  assert.equal(res.body.error.code, 'INTERNAL_ERROR')

  assert.ok(logged.length > 0, 'console.error should have been called')
  const loggedString = logged.map(args => args.map(a => String(a?.stack ?? a)).join(' ')).join('\n')

  assert.ok(loggedString.includes('SqliteError') || loggedString.includes('Error'), 'Should log error name')
  assert.ok(loggedString.includes('no such table: workspaces'), 'Should log error message/stack')
  assert.ok(!loggedString.includes(sensitivePayload), 'Should not log request body')
  assert.ok(!loggedString.includes(sensitiveCookie), 'Should not log cookies')
  assert.ok(!loggedString.includes(sensitiveHeader), 'Should not log request headers')
})

test('unhandled 500 error without stack logs only error name without object properties', async t => {
  const originalError = console.error
  const logged = []
  console.error = (...args) => {
    logged.push(args)
  }
  t.after(() => {
    console.error = originalError
  })

  let shouldFail = false
  const now = () => {
    if (shouldFail) {
      const errorWithoutStack = { name: 'StacklessInternalError', sensitiveProperty: 'leaked-property-987' }
      throw errorWithoutStack
    }
    return 1700000000000
  }

  const { client, close } = await start(t, undefined, { now })
  t.after(close)

  shouldFail = true

  const res = await client()('/workspaces', { name: 'TestWorkspace', displayName: 'Organizer' })
  assert.equal(res.status, 500)
  assert.equal(res.body.error.code, 'INTERNAL_ERROR')

  assert.ok(logged.length > 0, 'console.error should have been called')
  assert.equal(logged[0].length, 1, 'Only error name should be passed to console.error when stack is absent')
  assert.equal(logged[0][0], 'StacklessInternalError')

  const loggedString = logged.map(args => args.map(a => String(a)).join(' ')).join('\n')
  assert.ok(!loggedString.includes('leaked-property-987'), 'Should not log properties of error object')
})

test('store cleanup removes expired sessions, invitations, and recovery keys from SQLite tables', async t => {
  let currentTime = 1000000
  const now = () => currentTime
  const directory = await mkdtemp(join(tmpdir(), 'vibee-test-cleanup-'))
  const dbPath = join(directory, 'cleanup.sqlite')
  let currentStore = null
  t.after(async () => {
    if (currentStore) try { currentStore.close() } catch {}
    await rm(directory, { recursive: true, force: true })
  })

  currentStore = createStore({ path: dbPath, secret, now })
  const wsToken = currentStore.createWorkspace({ name: 'Команда', displayName: 'Алиса' })
  const member = currentStore.authenticate(wsToken)
  currentStore.invite(member)
  currentStore.recoveryKey(member)
  currentStore.close()
  currentStore = null

  const db = new DatabaseSync(dbPath)
  try {
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM invitations').get().n, 1)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM recovery_keys').get().n, 1)
  } finally {
    db.close()
  }

  // Re-open store with advanced time (31 days later)
  currentTime += 31 * 86400000
  currentStore = createStore({ path: dbPath, secret, now })
  assert.equal(typeof currentStore.cleanup, 'function', 'store.cleanup should be a function')
  currentStore.cleanup()
  currentStore.close()
  currentStore = null

  const dbAfter = new DatabaseSync(dbPath)
  try {
    assert.equal(dbAfter.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0)
    assert.equal(dbAfter.prepare('SELECT COUNT(*) AS n FROM invitations').get().n, 0)
    assert.equal(dbAfter.prepare('SELECT COUNT(*) AS n FROM recovery_keys').get().n, 0)
  } finally {
    dbAfter.close()
  }
})

test('createApp cleans up expired records on startup and periodic interval', async t => {
  let currentTime = 1000000
  const now = () => currentTime
  const directory = await mkdtemp(join(tmpdir(), 'vibee-test-app-cleanup-'))
  const dbPath = join(directory, 'app-cleanup.sqlite')

  const store = createStore({ path: dbPath, secret, now })
  const wsToken = store.createWorkspace({ name: 'Команда', displayName: 'Алиса' })
  const member = store.authenticate(wsToken)
  store.invite(member)
  store.recoveryKey(member)
  store.close()

  currentTime += 31 * 86400000

  const app = createApp({ secret, dbPath, now })
  t.after(async () => {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  })

  const db = new DatabaseSync(dbPath)
  try {
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM invitations').get().n, 0)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM recovery_keys').get().n, 0)
  } finally {
    db.close()
  }
})

test('store testability: custom now controls sessions, invitations, and 24h action limit', async t => {
  let currentTime = 1700000000000
  const now = () => currentTime
  const store = createStore({ path: ':memory:', secret, now })
  t.after(() => store.close())

  // 1. Workspace and session
  const token = store.createWorkspace({ name: 'Тестовая команда', displayName: 'Организатор' })
  const member = store.authenticate(token)
  assert.ok(member, 'Session should be valid immediately')

  // 2. Invitation
  const invitation = store.invite(member)
  assert.ok(invitation.token, 'Invitation token generated')

  // 3. Close round and add two actions
  const round = store.snapshot(member).round
  store.closeRound(member, { roundId: round.id })
  store.accept(member, { roundId: round.id, suggestionId: 'recognition', goal: 'Первый шаг' })

  // Open next round to accept another action
  store.openRound(member)
  const round2 = store.snapshot(member).round
  store.closeRound(member, { roundId: round2.id })
  store.accept(member, { roundId: round2.id, suggestionId: 'recognition', goal: 'Второй шаг' })

  // 4. Third action within 24 hours must fail due to DAILY_LIMIT
  store.openRound(member)
  const round3 = store.snapshot(member).round
  store.closeRound(member, { roundId: round3.id })
  assert.throws(
    () => store.accept(member, { roundId: round3.id, suggestionId: 'recognition', goal: 'Третий шаг' }),
    err => err?.code === 'DAILY_LIMIT'
  )

  // 5. Advance time by 24 hours + 10 seconds:
  // - Daily limit resets (new action can be accepted)
  // - Invitation expires (join throws INVALID_INVITATION)
  // - Session is still active (7 days TTL)
  currentTime += 86400000 + 10000

  // Check invitation expired:
  assert.throws(
    () => store.join({ token: invitation.token, displayName: 'Участник' }),
    err => err?.code === 'INVALID_INVITATION'
  )

  // Check daily limit reset:
  store.accept(member, { roundId: round3.id, suggestionId: 'recognition', goal: 'Третий шаг на следующий день' })
  assert.equal(store.snapshot(member).actions.length, 3)

  // Check session still active:
  assert.ok(store.authenticate(token), 'Session should still be active after 24h')

  // 6. Advance time past 7 days (e.g. + 7 * 86400000):
  // Session must expire
  currentTime += 7 * 86400000
  assert.equal(store.authenticate(token), null, 'Session should expire after 7 days')
})
