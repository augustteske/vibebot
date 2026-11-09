import { test } from 'node:test'
import assert from 'node:assert/strict'
import { refreshGoogleAccessToken, createGoogleCalendarEvent } from '../server/calendar.mjs'

test('refreshGoogleAccessToken requests a fresh access token from Google OAuth endpoint', async () => {
  let postBody = null
  const mockFetch = async (url, options) => {
    assert.equal(url, 'https://oauth2.googleapis.com/token')
    assert.equal(options.method, 'POST')
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
  assert.equal(postBody.get('client_id'), 'client-id')
  assert.equal(postBody.get('client_secret'), 'client-secret')
})

test('createGoogleCalendarEvent posts formatted event to primary calendar', async () => {
  let createdEvent = null
  let authHeader = null

  const mockFetch = async (url, options) => {
    assert.equal(url, 'https://www.googleapis.com/calendar/v3/calendars/primary/events')
    assert.equal(options.method, 'POST')
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
    startDateTime: '2026-11-13T10:00:00Z',
    endDateTime: '2026-11-13T11:00:00Z',
    timeZone: 'Europe/Moscow',
    fetchImpl: mockFetch,
  })

  assert.equal(res.id, 'event-uuid-123')
  assert.equal(authHeader, 'Bearer my-access-token')
  assert.equal(createdEvent.summary, '[Vibee] Обсудить перегрузку в пятницу')
  assert.ok(createdEvent.description.includes('Договорённость команды'))
  assert.equal(createdEvent.start.dateTime, '2026-11-13T10:00:00Z')
  assert.equal(createdEvent.start.timeZone, 'Europe/Moscow')
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
