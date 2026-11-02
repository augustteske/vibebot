import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createApp } from '../server/app.mjs'

const secret = 'synthetic-e2e-integration-test-secret'
const bootstrapCredential = '3'.repeat(64)
const policyVersion = 'synthetic-v1'
const chatId = '-100000000087'
const telegramUserIds = ['800000001', '800000002', '800000003', '800000004', '800000005']
const DAY = 86400000
const startOfPeriods = Date.parse('2026-11-02T03:00:00.000Z')

test('HTTP integration: creates and activates a Telegram binding, stores events, and aggregates them', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'vibee-integration-'))
  const dbPath = join(dir, 'integration.sqlite')
  let clock = startOfPeriods
  const app = createApp({
    dbPath,
    secret,
    telegramBootstrapCredential: bootstrapCredential,
    telegramSynthetic: true,
    now: () => clock,
  })
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve))
  const db = new DatabaseSync(dbPath)
  t.after(async () => {
    await app.close()
    db.close()
    await rm(dir, { recursive: true, force: true })
  })

  const base = 'http://127.0.0.1:' + app.server.address().port + '/api'
  const request = async (path, input, headers = {}) => {
    const response = await fetch(base + path, {
      method: input === undefined ? 'GET' : 'POST',
      headers: {
        Connection: 'close',
        ...(input === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    })
    return { status: response.status, body: await response.json() }
  }
  const webClient = () => {
    let cookie = ''
    return async (path, input) => {
      const response = await fetch(base + path, {
        method: input === undefined ? 'GET' : 'POST',
        headers: {
          Connection: 'close',
          ...(input === undefined ? {} : { 'Content-Type': 'application/json', 'X-Vibee': '1' }),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      })
      const setCookie = response.headers.get('set-cookie')
      if (setCookie) cookie = setCookie.split(';')[0]
      return { status: response.status, body: await response.json() }
    }
  }
  const owner = webClient()
  const created = await owner('/workspaces', { name: 'Synthetic E2E team', displayName: 'Synthetic organizer' })
  assert.equal(created.status, 201, JSON.stringify(created.body))

  const members = [{ name: 'Synthetic organizer', client: owner }]
  for (let index = 1; index < 5; index++) {
    const invitation = await owner('/invitations', {})
    assert.equal(invitation.status, 201, JSON.stringify(invitation.body))
    const client = webClient()
    const joined = await client('/join', {
      token: invitation.body.token,
      displayName: 'Synthetic participant ' + index,
    })
    assert.equal(joined.status, 201, JSON.stringify(joined.body))
    members.push({ name: 'Synthetic participant ' + index, client })
  }

  const workspaceId = created.body.workspace.id
  const memberIds = members.map(({ name }) => {
    const row = db.prepare('SELECT id FROM members WHERE workspace_id=? AND name=?').get(workspaceId, name)
    assert.ok(row, 'Expected API-created member ' + name + ' to exist in SQLite')
    return row.id
  })

  for (let index = 0; index < members.length; index++) {
    const linkToken = await members[index].client('/telegram/link-tokens', { requestId: randomUUID() })
    assert.equal(linkToken.status, 201, JSON.stringify(linkToken.body))
    const linked = await request('/bot/v1/links', {
      requestId: randomUUID(),
      token: linkToken.body.token,
      telegramUserId: telegramUserIds[index],
    }, { Authorization: 'Bearer ' + bootstrapCredential })
    assert.equal(linked.status, 200, JSON.stringify(linked.body))
    assert.deepEqual(linked.body, { linked: true })
  }

  const bindingToken = await owner('/telegram/binding-tokens', { requestId: randomUUID() })
  assert.equal(bindingToken.status, 201, JSON.stringify(bindingToken.body))
  const bound = await request('/bot/v1/bindings', {
    requestId: randomUUID(),
    token: bindingToken.body.token,
    chatId,
    initiatorId: telegramUserIds[0],
  }, { Authorization: 'Bearer ' + bootstrapCredential })
  assert.equal(bound.status, 200, JSON.stringify(bound.body))
  assert.equal(bound.body.phase, 'awaiting_consents')
  const { bindingId, credential } = bound.body

  const botHeaders = { Authorization: 'Bearer ' + credential }
  const status = async () => {
    const result = await request('/bot/v1/bindings/' + bindingId, undefined, botHeaders)
    assert.equal(result.status, 200, JSON.stringify(result.body))
    return result.body
  }
  const mutateWeb = async (operation, fields) => {
    const current = await status()
    return members[0].client('/telegram/bindings/' + bindingId + '/' + operation, {
      requestId: randomUUID(),
      expectedRevision: current.revision,
      ...fields,
    })
  }

  const roster = await mutateWeb('roster', { memberIds, verified: true })
  assert.equal(roster.status, 200, JSON.stringify(roster.body))
  const company = await mutateWeb('company', {
    accepted: true,
    authorityConfirmed: true,
    policyVersion,
  })
  assert.equal(company.status, 200, JSON.stringify(company.body))

  for (const telegramUserId of telegramUserIds) {
    const current = await status()
    const consent = await request('/bot/v1/bindings/' + bindingId + '/consents', {
      requestId: randomUUID(),
      expectedRevision: current.revision,
      telegramUserId,
      policyVersion: current.policyVersion,
      rosterVersion: current.rosterVersion,
      decision: 'accepted',
    }, botHeaders)
    assert.equal(consent.status, 200, JSON.stringify(consent.body))
  }

  const beforeResume = await status()
  const resumed = await members[0].client('/telegram/bindings/' + bindingId + '/control', {
    requestId: randomUUID(),
    expectedRevision: beforeResume.revision,
    action: 'resume',
  })
  assert.equal(resumed.status, 200, JSON.stringify(resumed.body))
  assert.equal(resumed.body.phase, 'active')

  const profile = await members[0].client('/telegram/profile', {
    requestId: randomUUID(),
    expectedVersion: 0,
    timeZone: 'UTC',
    intervals: Array.from({ length: 7 }, (_, index) => ({ day: index + 1, start: 0, end: 1440 })),
  })
  assert.equal(profile.status, 200, JSON.stringify(profile.body))

  const closedPeriods = []
  for (let day = 0; day < 3; day++) {
    clock = startOfPeriods + day * DAY
    for (let index = 0; index < 20; index++) {
      const senderIndex = index % members.length
      const event = await request('/bot/v1/bindings/' + bindingId + '/events', {
        eventId: randomUUID(),
        expectedRevision: resumed.body.revision,
        chatId,
        messageId: String(9000 + day * 20 + index),
        senderId: telegramUserIds[senderIndex],
        sentAt: new Date(clock).toISOString(),
        text: 'Synthetic status update',
      }, botHeaders)
      assert.equal(event.status, 200, JSON.stringify(event.body))
      assert.equal(event.body.result, 'accepted')
      if (day === 0 && index === 0) {
        const duplicate = await request('/bot/v1/bindings/' + bindingId + '/events', {
          eventId: event.body.eventId,
          expectedRevision: resumed.body.revision,
          chatId,
          messageId: '9000',
          senderId: telegramUserIds[0],
          sentAt: new Date(clock).toISOString(),
          text: 'Synthetic status update',
        }, botHeaders)
        assert.equal(duplicate.status, 200, JSON.stringify(duplicate.body))
        assert.equal(duplicate.body.result, 'duplicate')
      }
    }

    const closed = await members[0].client('/telegram/bindings/' + bindingId + '/periods/close', {
      requestId: randomUUID(),
      expectedRevision: resumed.body.revision,
      periodId: randomUUID(),
    })
    assert.equal(closed.status, 200, JSON.stringify(closed.body))
    closedPeriods.push(closed.body)
  }

  const stored = db.prepare(`
    SELECT COUNT(*) AS count, COUNT(DISTINCT sender_id) AS authors
    FROM telegram_texts WHERE binding_id=?
  `).get(bindingId)
  assert.equal(stored.count, 60)
  assert.equal(stored.authors, 5)

  assert.deepEqual(closedPeriods.map(period => period.status), ['calibrating', 'calibrating', 'published'])
  assert.deepEqual(closedPeriods[2].metrics, {
    outsideHoursPercent: 0,
    participationEvenness: 100,
    recognitionPercent: 0,
  })
  assert.equal(closedPeriods[2].demo, true)

  const unknownSender = await request('/bot/v1/bindings/' + bindingId + '/events', {
    eventId: randomUUID(),
    expectedRevision: resumed.body.revision,
    chatId,
    messageId: '9999',
    senderId: '899999999',
    sentAt: new Date(clock).toISOString(),
    text: 'Synthetic unknown sender',
  }, botHeaders)
  assert.equal(unknownSender.status, 200, JSON.stringify(unknownSender.body))
  assert.equal(unknownSender.body.result, 'paused')
  assert.equal((await status()).phase, 'paused')
})
