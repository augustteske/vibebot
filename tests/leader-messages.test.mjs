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

test('leader messages: creation, privacy masking, organizer viewing and replies', async (t) => {
  const app = createApp({ secret: SECRET, dbPath: ':memory:' })
  await new Promise((resolve) => app.server.listen(0, resolve))
  t.after(async () => {
    await app.close()
  })

  // 1. Create organizer and participant
  const orgCreate = await request(app, '/api/workspaces', {
    method: 'POST',
    body: { name: 'Alpha Team', displayName: 'Boss Lead' },
  })
  assert.equal(orgCreate.status, 201)
  const orgCookie = parseCookie(orgCreate)
  const roomKey = orgCreate.data.roomKey || orgCreate.data.workspace?.roomKey
  assert.ok(roomKey)

  const partJoin = await request(app, '/api/join-by-key', {
    method: 'POST',
    body: { roomKey, displayName: 'Alice Dev' },
  })
  assert.equal(partJoin.status, 201)
  const partCookie = parseCookie(partJoin)

  // 2. Participant submits an anonymous message
  const anonMsg = await request(app, '/api/messages', {
    method: 'POST',
    cookie: partCookie,
    body: {
      message: 'Кажется, процесс код-ревью слишком затянут',
      is_anonymous: true,
    },
  })
  assert.equal(anonMsg.status, 201)
  assert.equal(anonMsg.data.isAnonymous, true)
  assert.equal(anonMsg.data.author, 'Аноним')

  // 3. Participant submits an open message
  const openMsg = await request(app, '/api/messages', {
    method: 'POST',
    cookie: partCookie,
    body: {
      message: 'Хочу взять на себя задачу по миграции БД',
      is_anonymous: false,
    },
  })
  assert.equal(openMsg.status, 201)
  assert.equal(openMsg.data.isAnonymous, false)
  assert.equal(openMsg.data.author, 'Alice Dev')

  // 4. Submit a message via roomKey without session
  const roomKeyMsg = await request(app, '/api/messages', {
    method: 'POST',
    body: {
      roomKey,
      message: 'Привет от нового кандидата',
      is_anonymous: true,
    },
  })
  assert.equal(roomKeyMsg.status, 201)

  // 5. Participant cannot list messages (403 FORBIDDEN)
  const partList = await request(app, '/api/messages', {
    method: 'GET',
    cookie: partCookie,
  })
  assert.equal(partList.status, 403)

  // 6. Organizer lists messages (200 OK)
  const orgList = await request(app, '/api/messages', {
    method: 'GET',
    cookie: orgCookie,
  })
  assert.equal(orgList.status, 200)
  assert.equal(orgList.data.length, 3)

  const anonItem = orgList.data.find(m => m.id === anonMsg.data.id)
  assert.ok(anonItem)
  assert.equal(anonItem.isAnonymous, true)
  assert.equal(anonItem.author, 'Аноним')
  assert.equal(anonItem.memberId, null)
  assert.equal(anonItem.status, 'new')

  const openItem = orgList.data.find(m => m.id === openMsg.data.id)
  assert.ok(openItem)
  assert.equal(openItem.isAnonymous, false)
  assert.equal(openItem.author, 'Alice Dev')
  assert.ok(openItem.memberId)
  assert.equal(openItem.status, 'new')

  // 7. Organizer marks message as read
  const markRead = await request(app, `/api/messages/${anonItem.id}`, {
    method: 'PATCH',
    cookie: orgCookie,
    body: { status: 'read' },
  })
  assert.equal(markRead.status, 200)
  assert.equal(markRead.data.status, 'read')

  // 8. Organizer replies to the open message
  const replyOpen = await request(app, `/api/messages/${openItem.id}`, {
    method: 'PATCH',
    cookie: orgCookie,
    body: { reply: 'Отличная идея, давай обсудим на 1-на-1 завтра!' },
  })
  assert.equal(replyOpen.status, 200)
  assert.equal(replyOpen.data.status, 'replied')
  assert.equal(replyOpen.data.reply, 'Отличная идея, давай обсудим на 1-на-1 завтра!')
  assert.ok(replyOpen.data.repliedAt)

  // 9. Verify GDPR export includes only open messages of member
  const partExport = await request(app, '/api/export-my-data', {
    method: 'GET',
    cookie: partCookie,
  })
  assert.equal(partExport.status, 200)
  assert.ok(Array.isArray(partExport.data.leaderMessages))
  assert.equal(partExport.data.leaderMessages.length, 1)
  assert.equal(partExport.data.leaderMessages[0].id, openMsg.data.id)
  assert.equal(partExport.data.leaderMessages[0].reply, 'Отличная идея, давай обсудим на 1-на-1 завтра!')
})
