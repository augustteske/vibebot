import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unlinkSync } from 'node:fs'
import { createApp } from '../server/app.mjs'
import { createStore } from '../server/store.mjs'

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

test('room key is perpetual by default: does not expire over time, manual rotation works', async (t) => {
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
    body: { name: 'Engineering', displayName: 'Team Lead' },
  })
  assert.equal(orgCreate.status, 201)
  const orgCookie = parseCookie(orgCreate)
  const initialRoomKey = orgCreate.data.workspace.roomKey
  assert.ok(initialRoomKey)
  assert.equal(typeof initialRoomKey, 'string')
  assert.equal(orgCreate.data.workspace.roomKeyExpiresAt, null)

  // 2. Participant joins with initial room key
  const partJoin1 = await request(app, '/api/join-by-key', {
    method: 'POST',
    body: { roomKey: initialRoomKey, displayName: 'Dev 1' },
  })
  assert.equal(partJoin1.status, 201)
  const part1Cookie = parseCookie(partJoin1)
  assert.ok(part1Cookie)

  // 3. Participant cannot rotate room key
  const forbiddenRotate = await request(app, '/api/workspaces/rotate-key', {
    method: 'POST',
    cookie: part1Cookie,
    body: {},
  })
  assert.equal(forbiddenRotate.status, 403)
  assert.equal(forbiddenRotate.data.error.code, 'FORBIDDEN')

  // 4. Organizer rotates room key manually
  const rotateRes = await request(app, '/api/workspaces/rotate-key', {
    method: 'POST',
    cookie: orgCookie,
    body: {},
  })
  assert.equal(rotateRes.status, 200)
  const newRoomKey = rotateRes.data.workspace.roomKey
  assert.ok(newRoomKey)
  assert.notEqual(newRoomKey, initialRoomKey)
  assert.equal(rotateRes.data.workspace.roomKeyExpiresAt, null)

  // 5. Old room key no longer works after manual rotation
  const oldKeyJoin = await request(app, '/api/join-by-key', {
    method: 'POST',
    body: { roomKey: initialRoomKey, displayName: 'Dev 2' },
  })
  assert.equal(oldKeyJoin.status, 400)
  assert.equal(oldKeyJoin.data.error.code, 'INVALID_ROOM_KEY')

  // 6. New room key works
  const newKeyJoin = await request(app, '/api/join-by-key', {
    method: 'POST',
    body: { roomKey: newRoomKey, displayName: 'Dev 2' },
  })
  assert.equal(newKeyJoin.status, 201)

  // 7. Advance time by 60 days (well beyond former 7-day TTL)
  currentTime += 60 * 86400000

  // 8. New room key still works after 60 days without expiring
  const perpetualJoin = await request(app, '/api/join-by-key', {
    method: 'POST',
    body: { roomKey: newRoomKey, displayName: 'Dev 3' },
  })
  assert.equal(perpetualJoin.status, 201)

  // 9. Leader message by room key also continues to work after 60 days
  const leaderMsg = await request(app, '/api/messages', {
    method: 'POST',
    body: { roomKey: newRoomKey, message: 'Привет команде!' },
  })
  assert.equal(leaderMsg.status, 201)
})

test('room key expiration: store rejects expired room key if room_key_expires_at is configured', () => {
  let currentTime = 1700000000000
  const dbPath = join(tmpdir(), `test-room-key-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
  const store = createStore({
    secret: SECRET,
    path: dbPath,
    now: () => currentTime,
  })

  // 1. Create workspace
  const sessionToken = store.createWorkspace({ name: 'Timekeepers', displayName: 'Lead' })
  const organizer = store.authenticate(sessionToken)
  const roomKey = store.snapshot(organizer).workspace.roomKey
  assert.ok(roomKey)

  // 2. Default key has no expiration and joins fine
  const partSession = store.joinByKey({ roomKey, displayName: 'Dev 1' })
  assert.ok(partSession)

  // 3. Set room_key_expires_at to the past using a direct connection
  const directDb = new DatabaseSync(dbPath)
  directDb.prepare('UPDATE workspaces SET room_key_expires_at=? WHERE id=?').run(currentTime - 1000, organizer.workspace_id)
  directDb.close()

  // 4. joinByKey throws EXPIRED_ROOM_KEY
  assert.throws(() => {
    store.joinByKey({ roomKey, displayName: 'Dev 2' })
  }, (err) => {
    assert.equal(err.code, 'EXPIRED_ROOM_KEY')
    assert.equal(err.message, 'Срок действия ключа комнаты истёк. Попросите тимлида сгенерировать новый.')
    return true
  })

  // 5. getWorkspaceByRoomKey throws EXPIRED_ROOM_KEY
  assert.throws(() => {
    store.getWorkspaceByRoomKey(roomKey)
  }, (err) => {
    assert.equal(err.code, 'EXPIRED_ROOM_KEY')
    assert.equal(err.message, 'Срок действия ключа комнаты истёк. Попросите тимлида сгенерировать новый.')
    return true
  })

  store.close()
  try { unlinkSync(dbPath) } catch {}
})
