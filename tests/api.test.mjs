import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve, join, sep } from 'node:path'
import { createApp } from '../server/app.mjs'
import { DatabaseSync } from 'node:sqlite'

const secret = 'test-secret-used-only-in-automated-tests-123456789'
const normal = { energy: 4, clarity: 4, support: 4 }
const unclear = { energy: 4, clarity: 1, support: 4 }

async function start(t, dbPath) {
  const app = createApp({ secret, dbPath })
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
      return { status: response.status, body: await response.json(), setCookie }
    }
  }
  return { client, close }
}

async function team(t, size) {
  const env = await start(t)
  const owner = env.client()
  const created = await owner('/workspaces', { name: 'Тестовая команда', displayName: 'Организатор' })
  assert.equal(created.status, 201)
  const people = [owner]
  for (let i = 1; i < size; i++) {
    const invitation = await owner('/invitations', {})
    const person = env.client()
    assert.equal((await person('/join', { token: invitation.body.token, displayName: 'Участник ' + i })).status, 201)
    people.push(person)
  }
  return { ...env, owner, people, roundId: created.body.round.id }
}

test('complete shared flow: private check-ins, frozen summary, confirmed action and closed feedback', async t => {
  const { owner, people, roundId } = await team(t, 6)
  for (let i = 0; i < people.length; i++) {
    assert.equal((await people[i]('/checkins', { roundId, scores: i < 3 ? unclear : normal })).status, 200)
  }
  const before = (await people[1]('/session')).body
  assert.deepEqual(before.round.summary, { status: 'open' })
  assert.equal(before.round.mySubmitted, true)
  assert.equal(before.suggestions.some(s => s.id === 'clarity'), false)
  assert.equal((await people[1]('/rounds/close', { roundId })).status, 403)
  const closed = await owner('/rounds/close', { roundId })
  assert.equal(closed.body.round.summary.status, 'published')
  assert.deepEqual(closed.body.round.summary.needs, ['clarity'])
  assert.equal(closed.body.round.summary.means.clarity, 2.5)
  assert.doesNotMatch(JSON.stringify(closed.body), /voter_key|token_hash|"answers"|"scores"|"participants"/)
  assert.equal((await people[0]('/checkins', { roundId, scores: normal })).status, 409)
  const accepted = await people[2]('/actions', { roundId, suggestionId: 'clarity', goal: 'Сегодня доводим основной сценарий до демо' })
  assert.equal(accepted.status, 200)
  const actionId = accepted.body.actions[0].id
  assert.equal((await people[4]('/session')).body.actions[0].goal, 'Сегодня доводим основной сценарий до демо')
  assert.equal((await owner('/actions', { roundId, suggestionId: 'clarity', goal: 'Дубль' })).status, 409)
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
  const accepted = await owner('/actions', { roundId, suggestionId: 'recognition', goal: 'Назовём конкретный вклад коллеги' })
  const id = accepted.body.actions[0].id
  for (const person of people) await person('/actions/' + id + '/feedback', { helpful: true })
  const closed = await owner('/actions/' + id + '/close-feedback', {})
  assert.deepEqual(closed.body.actions[0].feedback, { status: 'insufficient' })
})

test('invitations are single-use and ordinary participants cannot create them', async t => {
  const { owner, client, people } = await team(t, 2)
  const invite = await owner('/invitations', {})
  const results = await Promise.all([client(), client()].map(person => person('/join', { token: invite.body.token, displayName: 'Новый участник' })))
  assert.deepEqual(results.map(r => r.status).sort(), [201, 400])
  assert.equal((await people[1]('/invitations', {})).status, 403)
})

test('session, JSON values, request origin and workspace boundaries are enforced', async t => {
  const { owner, client, roundId } = await team(t, 1)
  const outsider = client()
  assert.equal((await outsider('/session')).status, 401)
  assert.equal((await owner('/checkins', { roundId, scores: { ...normal, energy: 0 } })).status, 400)
  assert.equal((await owner('/checkins', { roundId, scores: { ...normal, energy: 2.5 } })).status, 400)
  assert.equal((await owner('/checkins', { roundId, scores: normal }, { Origin: 'https://other.example' })).status, 403)
  assert.equal((await owner('/checkins', { roundId, scores: normal }, { 'X-VibeBot': '' })).status, 403)
  const accepted = await owner('/actions', { roundId, suggestionId: 'recognition', goal: 'Спасибо команде' })
  await outsider('/workspaces', { name: 'Другая команда', displayName: 'Другой организатор' })
  assert.equal((await outsider('/actions/' + accepted.body.actions[0].id + '/feedback', { helpful: true })).status, 404)
  assert.equal((await owner('/checkins')).status, 404)
  await owner('/logout', {})
  assert.equal((await owner('/session')).status, 401)
})

test('accepted actions are capped at two per workspace in a rolling day', async t => {
  const { owner, roundId } = await team(t, 1)
  await owner('/actions', { roundId, suggestionId: 'recognition', goal: 'Первый шаг' })
  await owner('/rounds/close', { roundId })
  const second = (await owner('/rounds/open', {})).body.round.id
  await owner('/actions', { roundId: second, suggestionId: 'recognition', goal: 'Второй шаг' })
  await owner('/rounds/close', { roundId: second })
  const third = (await owner('/rounds/open', {})).body.round.id
  assert.equal((await owner('/actions', { roundId: third, suggestionId: 'recognition', goal: 'Третий шаг' })).body.error.code, 'DAILY_LIMIT')
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
  const root = resolve('.data')
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(join(root, 'api-test-'))
  t.after(async () => { if (!directory.startsWith(root + sep)) throw new Error('Unexpected test directory'); await rm(directory, { recursive: true, force: true }) })
  const path = join(directory, 'test.sqlite')
  const first = await start(t, path)
  const owner = first.client()
  const created = await owner('/workspaces', { name: 'Постоянная команда', displayName: 'Август' })
  const invitation = await owner('/invitations', {})
  const roundId = created.body.round.id
  await owner('/checkins', { roundId, scores: normal })
  await owner('/rounds/close', { roundId })
  const action = await owner('/actions', { roundId, suggestionId: 'recognition', goal: 'Сохранённый шаг' })
  const actionId = action.body.actions[0].id
  await owner('/actions/' + actionId + '/feedback', { helpful: true })
  await owner('/actions/' + actionId + '/close-feedback', {})
  await first.close()
  const second = await start(t, path)
  const participant = second.client()
  const joined = await participant('/join', { token: invitation.body.token, displayName: 'Участник' })
  assert.equal(joined.body.workspace.name, 'Постоянная команда')
  assert.equal(joined.body.actions[0].goal, 'Сохранённый шаг')
  await second.close()
  const inspection = new DatabaseSync(path)
  try {
    assert.equal(inspection.prepare('SELECT COUNT(*) AS n FROM checkins').get().n, 0)
    assert.equal(inspection.prepare('SELECT COUNT(*) AS n FROM feedback').get().n, 0)
  } finally { inspection.close() }
})
