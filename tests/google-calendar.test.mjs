import { test } from 'node:test'
import assert from 'node:assert/strict'
import { refreshGoogleAccessToken, createGoogleCalendarEvent } from '../server/calendar.mjs'

test('refreshGoogleAccessToken requests a fresh access token from Google with timeout signal and clean error', async () => {
  let postBody = null
  let receivedSignal = null

  const mockFetch = async (url, options) => {
    assert.equal(url, 'https://oauth2.googleapis.com/token')
    assert.equal(options.method, 'POST')
    receivedSignal = options.signal
    postBody = new URLSearchParams(options.body)
    return {
      ok: true,
      json: async () => ({
        access_token: 'fresh-access-token-123',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
    }
  }

  const result = await refreshGoogleAccessToken({
    refreshToken: 'valid-refresh-token',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    fetchImpl: mockFetch,
  })

  assert.equal(result.access_token, 'fresh-access-token-123')
  assert.equal(postBody.get('grant_type'), 'refresh_token')
  assert.equal(postBody.get('refresh_token'), 'valid-refresh-token')
  assert.ok(receivedSignal instanceof AbortSignal, 'Should pass AbortSignal.timeout(5000)')

  // Error handling: must not leak Google API response body in error message
  const failingFetch = async () => ({
    status: 400,
    ok: false,
    text: async () => 'sensitive-google-error-leak-payload',
  })
  await assert.rejects(
    () => refreshGoogleAccessToken({
      refreshToken: 'bad',
      clientId: 'id',
      clientSecret: 'sec',
      fetchImpl: failingFetch,
    }),
    err => {
      assert.ok(!err.message.includes('sensitive-google-error-leak-payload'), 'Error must not leak Google response body')
      assert.ok(err.message.includes('400'), 'Error must include HTTP status')
      return true
    }
  )
})

test('createGoogleCalendarEvent accepts custom now parameter for default dates and cleans errors', async () => {
  let createdEvent = null
  let authHeader = null
  let receivedSignal = null

  const fixedTime = 1700000000000 // Fixed timestamp
  const expectedStart = new Date(fixedTime + 86400000).toISOString()
  const expectedEnd = new Date(fixedTime + 86400000 + 3600000).toISOString()

  const mockFetch = async (url, options) => {
    assert.equal(url, 'https://www.googleapis.com/calendar/v3/calendars/primary/events')
    assert.equal(options.method, 'POST')
    receivedSignal = options.signal
    authHeader = options.headers.Authorization
    createdEvent = JSON.parse(options.body)
    return {
      ok: true,
      json: async () => ({
        id: 'event-uuid-123',
        htmlLink: 'https://calendar.google.com/event?eid=123',
        summary: createdEvent.summary,
      }),
    }
  }

  const res = await createGoogleCalendarEvent({
    accessToken: 'my-access-token',
    title: 'Обсудить перегрузку в пятницу',
    description: 'Договорённость команды по результатам раунда',
    now: () => fixedTime,
    timeZone: 'Europe/Moscow',
    fetchImpl: mockFetch,
  })

  assert.equal(res.id, 'event-uuid-123')
  assert.equal(authHeader, 'Bearer my-access-token')
  assert.ok(receivedSignal instanceof AbortSignal, 'Should pass AbortSignal')
  assert.equal(createdEvent.start.dateTime, expectedStart, 'Should use now() parameter for default start')
  assert.equal(createdEvent.end.dateTime, expectedEnd, 'Should use now() parameter for default end')

  // Error handling: must not leak Google API response body
  const failingFetch = async () => ({
    status: 403,
    ok: false,
    text: async () => 'confidential-calendar-quota-exceeded-details',
  })
  await assert.rejects(
    () => createGoogleCalendarEvent({
      accessToken: 'tok',
      title: 'Action',
      fetchImpl: failingFetch,
    }),
    err => {
      assert.ok(!err.message.includes('confidential-calendar-quota-exceeded-details'), 'Error must not leak Google response body')
      assert.ok(err.message.includes('403'), 'Error must include HTTP status')
      return true
    }
  )
})

test('createGoogleCalendarEvent automatically refreshes token and retries on 401', async () => {
  let attempts = 0
  let tokenRefreshed = false

  const mockFetch = async (url, options) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      tokenRefreshed = true
      return {
        ok: true,
        json: async () => ({
          access_token: 'new-refreshed-token',
          expires_in: 3600,
        }),
      }
    }
    if (url === 'https://www.googleapis.com/calendar/v3/calendars/primary/events') {
      attempts++
      if (attempts === 1) {
        assert.equal(options.headers.Authorization, 'Bearer stale-token')
        return {
          status: 401,
          ok: false,
          text: async () => 'Unauthorized',
        }
      }
      assert.equal(options.headers.Authorization, 'Bearer new-refreshed-token')
      return {
        ok: true,
        json: async () => ({
          id: 'retried-event-id',
          summary: '[Vibee] Action',
        }),
      }
    }
    throw new Error('Unexpected url: ' + url)
  }

  const res = await createGoogleCalendarEvent({
    accessToken: 'stale-token',
    refreshToken: 'valid-refresh-token',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    title: 'Action',
    fetchImpl: mockFetch,
  })

  assert.equal(attempts, 2, 'Should attempt first, get 401, refresh, and retry successfully')
  assert.ok(tokenRefreshed, 'Token should have been refreshed')
  assert.equal(res.id, 'retried-event-id')
})
