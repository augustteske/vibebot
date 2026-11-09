import test from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../server/app.mjs'

const SECRET = '01234567890123456789012345678901'

async function request(app, path, { method = 'GET', body, cookie, headers = {} } = {}) {
  const url = `http://127.0.0.1:${app.server.address().port}${path}`
  const reqHeaders = {
    'x-vibee': '1',
    ...(cookie ? { cookie: `vibebot_session=${cookie}` } : {}),
    ...(body ? { 'content-type': 'application/json' } : {}),
    ...headers,
  }
  const response = await fetch(url, {
    method,
    headers: reqHeaders,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = text
  }
  return { status: response.status, headers: response.headers, data }
}

function parseCookie(response) {
  const setCookie = response.headers.get('set-cookie')
  if (!setCookie) return null
  const match = setCookie.match(/vibebot_session=([^;]+)/)
  return match ? match[1] : null
}

test('room key rotation: old key is invalidated, new key works, usage counter resets', async (t) => {
  const app = createApp({ secret: SECRET, dbPath: ':memory:' })
  await new Promise((resolve) => app.server.listen(0, resolve))
  t.after(async () => {
    await app.close()
  })

  // 1. Create workspace
  const orgCreate = await request(app, '/api/workspaces', {
    method: 'POST',
    body: { name: 'Engineering', displayName: 'Team Lead' },
  })
  assert.equal(orgCreate.status, 201)
  const orgCookie = parseCookie(orgCreate)
  const initialRoomKey = orgCreate.data.workspace.roomKey
  assert.ok(initialRoomKey)
  assert.equal(typeof initialRoomKey, 'string')
  assert.equal(orgCreate.data.workspace.roomKeyUses, 0)
  assert.equal(orgCreate.data.workspace.roomKeyMaxUses, 10)
  assert.ok(orgCreate.data.workspace.roomKeyExpiresAt)

  // 2. Participant joins with initial room key
  const partJoin1 = await request(app, '/api/join-by-key', {
    method: 'POST',
    body: { roomKey: initialRoomKey, displayName: 'Dev 1' },
  })
  assert.equal(partJoin1.status, 201)
  const part1Cookie = parseCookie(partJoin1)
  assert.ok(part1Cookie)

  // 3. Check organizer snapshot: uses count is 1
  const orgSnap1 = await request(app, '/api/session', {
    method: 'GET',
    cookie: orgCookie,
  })
  assert.equal(orgSnap1.status, 200)
  assert.equal(orgSnap1.data.workspace.roomKeyUses, 1)

  // 4. Participant cannot rotate key
  const forbiddenRotate = await request(app, '/api/workspaces/rotate-key', {
    method: 'POST',
    cookie: part1Cookie,
    body: {},
  })
  assert.equal(forbiddenRotate.status, 403)
  assert.equal(forbiddenRotate.data.error.code, 'FORBIDDEN')

  // 5. Organizer rotates room key
  const rotateRes = await request(app, '/api/workspaces/rotate-key', {
    method: 'POST',
    cookie: orgCookie,
    body: {},
  })
  assert.equal(rotateRes.status, 200)
  const newRoomKey = rotateRes.data.workspace.roomKey
  assert.ok(newRoomKey)
  assert.notEqual(newRoomKey, initialRoomKey)
  assert.equal(rotateRes.data.workspace.roomKeyUses, 0)
  assert.equal(rotateRes.data.workspace.roomKeyMaxUses, 10)
  assert.ok(rotateRes.data.workspace.roomKeyExpiresAt)

  // 6. Old room key no longer works
  const oldKeyJoin = await request(app, '/api/join-by-key', {
    method: 'POST',
    body: { roomKey: initialRoomKey, displayName: 'Dev 2' },
  })
  assert.equal(oldKeyJoin.status, 400)
  assert.equal(oldKeyJoin.data.error.code, 'INVALID_ROOM_KEY')

  // 7. New room key works
  const newKeyJoin = await request(app, '/api/join-by-key', {
    method: 'POST',
    body: { roomKey: newRoomKey, displayName: 'Dev 2' },
  })
  assert.equal(newKeyJoin.status, 201)

  // 8. Organizer snapshot shows 1 use on new key
  const orgSnap2 = await request(app, '/api/session', {
    method: 'GET',
    cookie: orgCookie,
  })
  assert.equal(orgSnap2.status, 200)
  assert.equal(orgSnap2.data.workspace.roomKeyUses, 1)
})

test('room key TTL expiry: rejects join and leader messages after expiration', async (t) => {
  let currentTime = 1700000000000
  const app = createApp({
    secret: SECRET,
    dbPath: ':memory:',
    now: () => currentTime,
  })
  await new Promise((resolve) => app.server.listen(0, resolve))
  t.after(async () => {
    await app.close()
  })

  // 1. Create workspace
  const orgCreate = await request(app, '/api/workspaces', {
    method: 'POST',
    body: { name: 'Timekeepers', displayName: 'Lead' },
  })
  assert.equal(orgCreate.status, 201)
  const roomKey = orgCreate.data.workspace.roomKey

  // 2. Join before expiration works
  const validJoin = await request(app, '/api/join-by-key', {
    method: 'POST',
    body: { roomKey, displayName: 'Early Bird' },
  })
  assert.equal(validJoin.status, 201)

  // 3. Advance time beyond 7 days (7 * 86400000 ms + 1 sec)
  currentTime += 7 * 86400000 + 1000

  // 4. Join after expiration fails with clear message
  const expiredJoin = await request(app, '/api/join-by-key', {
    method: 'POST',
    body: { roomKey, displayName: 'Late Bird' },
  })
  assert.equal(expiredJoin.status, 400)
  assert.equal(expiredJoin.data.error.code, 'EXPIRED_ROOM_KEY')
  assert.equal(expiredJoin.data.error.message, 'Срок действия ключа комнаты истёк. Попросите тимлида сгенерировать новый.')

  // 5. Leader message with expired room key also fails with clear message
  const expiredLeaderMsg = await request(app, '/api/messages', {
    method: 'POST',
    body: { roomKey, message: 'Привет команде!' },
  })
  assert.equal(expiredLeaderMsg.status, 400)
  assert.equal(expiredLeaderMsg.data.error.code, 'EXPIRED_ROOM_KEY')
  assert.equal(expiredLeaderMsg.data.error.message, 'Срок действия ключа комнаты истёк. Попросите тимлида сгенерировать новый.')
})

test('room key usage limit: rejects after 10 uses and resets upon rotation', async (t) => {
  const app = createApp({ secret: SECRET, dbPath: ':memory:' })
  await new Promise((resolve) => app.server.listen(0, resolve))
  t.after(async () => {
    await app.close()
  })

  // 1. Create workspace
  const orgCreate = await request(app, '/api/workspaces', {
    method: 'POST',
    body: { name: 'Crowded Room', displayName: 'Captain' },
  })
  assert.equal(orgCreate.status, 201)
  const orgCookie = parseCookie(orgCreate)
  const roomKey = orgCreate.data.workspace.roomKey

  // 2. Use key 10 times successfully
  for (let i = 1; i <= 10; i++) {
    const res = await request(app, '/api/join-by-key', {
      method: 'POST',
      body: { roomKey, displayName: `Member ${i}` },
    })
    assert.equal(res.status, 201, `Join ${i} should succeed`)
  }

  // 3. 11th use fails with ROOM_KEY_LIMIT_EXCEEDED
  const eleventhJoin = await request(app, '/api/join-by-key', {
    method: 'POST',
    body: { roomKey, displayName: 'Member 11' },
  })
  assert.equal(eleventhJoin.status, 400)
  assert.equal(eleventhJoin.data.error.code, 'ROOM_KEY_LIMIT_EXCEEDED')
  assert.equal(eleventhJoin.data.error.message, 'Лимит использований ключа исчерпан. Попросите тимлида сгенерировать новый.')

  // 4. Organizer rotates room key
  const rotateRes = await request(app, '/api/workspaces/rotate-key', {
    method: 'POST',
    cookie: orgCookie,
    body: {},
  })
  assert.equal(rotateRes.status, 200)
  const newRoomKey = rotateRes.data.workspace.roomKey
  assert.equal(rotateRes.data.workspace.roomKeyUses, 0)

  // 5. Member 11 now joins successfully with new key
  const retryJoin = await request(app, '/api/join-by-key', {
    method: 'POST',
    body: { roomKey: newRoomKey, displayName: 'Member 11' },
  })
  assert.equal(retryJoin.status, 201)
})
