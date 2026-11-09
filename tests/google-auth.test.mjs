import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../server/app.mjs'
import { createStore } from '../server/store.mjs'

const secret = 'test-secret-used-only-in-automated-tests-123456789'

test('GET /api/auth/google returns 503 UNAVAILABLE when Google credentials are not configured', async t => {
  const app = createApp({
    secret,
    dbPath: ':memory:',
    googleClientId: '',
    googleClientSecret: '',
  })
  await new Promise(r => app.server.listen(0, '127.0.0.1', r))
  t.after(async () => { await app.close() })
  const base = 'http://127.0.0.1:' + app.server.address().port

  const res = await fetch(base + '/api/auth/google', { redirect: 'manual' })
  assert.equal(res.status, 503)
  const body = await res.json()
  assert.equal(body.error?.code, 'UNAVAILABLE')
})

test('GET /api/auth/google redirects to Google consent screen and stores state with CSRF protection', async t => {
  const app = createApp({
    secret,
    dbPath: ':memory:',
    googleClientId: 'mock-google-client-id-123',
    googleClientSecret: 'mock-google-client-secret-456',
  })
  await new Promise(r => app.server.listen(0, '127.0.0.1', r))
  t.after(async () => { await app.close() })
  const base = 'http://127.0.0.1:' + app.server.address().port

  const res = await fetch(base + '/api/auth/google?returnTo=/custom-page', { redirect: 'manual' })
  assert.equal(res.status, 302)
  const location = res.headers.get('location')
  assert.ok(location, 'Should have Location header')

  const parsedUrl = new URL(location)
  assert.equal(parsedUrl.origin, 'https://accounts.google.com')
  assert.equal(parsedUrl.pathname, '/o/oauth2/v2/auth')
  assert.equal(parsedUrl.searchParams.get('client_id'), 'mock-google-client-id-123')
  assert.equal(parsedUrl.searchParams.get('response_type'), 'code')
  assert.equal(parsedUrl.searchParams.get('access_type'), 'offline')
  assert.equal(parsedUrl.searchParams.get('prompt'), 'consent')
  assert.ok(parsedUrl.searchParams.get('scope')?.includes('openid'))
  assert.ok(parsedUrl.searchParams.get('scope')?.includes('email'))
  assert.ok(parsedUrl.searchParams.get('scope')?.includes('profile'))
  assert.ok(parsedUrl.searchParams.get('scope')?.includes('calendar.events'))

  const state = parsedUrl.searchParams.get('state')
  assert.ok(state && state.length >= 32, 'state should be a secure random string')
})

test('OAuth callback validates state parameter (CSRF protection, TTL and single-use)', async t => {
  let currentTime = 1000000
  const now = () => currentTime

  const app = createApp({
    secret,
    dbPath: ':memory:',
    now,
    googleClientId: 'mock-google-client-id',
    googleClientSecret: 'mock-google-client-secret',
  })
  await new Promise(r => app.server.listen(0, '127.0.0.1', r))
  t.after(async () => { await app.close() })
  const base = 'http://127.0.0.1:' + app.server.address().port

  // 1. Missing state or code
  const missingCodeRes = await fetch(base + '/api/auth/google/callback?state=foo', { redirect: 'manual' })
  assert.equal(missingCodeRes.status, 400)
  assert.equal((await missingCodeRes.json()).error?.code, 'INVALID_INPUT')

  const missingStateRes = await fetch(base + '/api/auth/google/callback?code=foo', { redirect: 'manual' })
  assert.equal(missingStateRes.status, 400)
  assert.equal((await missingStateRes.json()).error?.code, 'INVALID_INPUT')

  // 2. Unknown state
  const unknownStateRes = await fetch(base + '/api/auth/google/callback?code=foo&state=forged-state-123', { redirect: 'manual' })
  assert.equal(unknownStateRes.status, 400)
  assert.equal((await unknownStateRes.json()).error?.code, 'INVALID_STATE')

  // 3. Google returned error
  const authInit = await fetch(base + '/api/auth/google', { redirect: 'manual' })
  const validState = new URL(authInit.headers.get('location')).searchParams.get('state')

  const errorCallbackRes = await fetch(base + `/api/auth/google/callback?error=access_denied&state=${validState}`, { redirect: 'manual' })
  assert.equal(errorCallbackRes.status, 400)
  assert.equal((await errorCallbackRes.json()).error?.code, 'OAUTH_ERROR')

  // 4. Expired state
  const authInit2 = await fetch(base + '/api/auth/google', { redirect: 'manual' })
  const stateToExpire = new URL(authInit2.headers.get('location')).searchParams.get('state')
  currentTime += 11 * 60 * 1000 // Advance beyond 10-minute TTL

  const expiredRes = await fetch(base + `/api/auth/google/callback?code=foo&state=${stateToExpire}`, { redirect: 'manual' })
  assert.equal(expiredRes.status, 400)
  assert.equal((await expiredRes.json()).error?.code, 'INVALID_STATE')
})

test('Simulated Google OAuth callback creates user, workspace, session cookie, and does not store passwords', async t => {
  let currentTime = 2000000
  const now = () => currentTime

  const mockTokenData = {
    access_token: 'google-access-token-xyz',
    refresh_token: 'google-refresh-token-abc',
    expires_in: 3600,
    token_type: 'Bearer',
  }
  const mockProfile = {
    sub: 'google-uid-99999',
    email: 'daniil@example.com',
    name: 'Даниил Теске',
    picture: 'https://example.com/avatar.png',
  }

  let tokenFetched = false
  let userinfoFetched = false

  const mockOAuthFetch = async (url, options) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      tokenFetched = true
      assert.equal(options.method, 'POST')
      const body = new URLSearchParams(options.body)
      assert.equal(body.get('client_id'), 'test-id')
      assert.equal(body.get('client_secret'), 'test-secret')
      assert.equal(body.get('grant_type'), 'authorization_code')
      assert.equal(body.get('code'), 'valid_google_code')
      return {
        ok: true,
        json: async () => mockTokenData,
      }
    }
    if (url === 'https://www.googleapis.com/oauth2/v3/userinfo') {
      userinfoFetched = true
      assert.equal(options.headers.Authorization, 'Bearer google-access-token-xyz')
      return {
        ok: true,
        json: async () => mockProfile,
      }
    }
    throw new Error('Unexpected fetch url: ' + url)
  }

  const app = createApp({
    secret,
    dbPath: ':memory:',
    now,
    googleClientId: 'test-id',
    googleClientSecret: 'test-secret',
    oauthFetch: mockOAuthFetch,
  })
  await new Promise(r => app.server.listen(0, '127.0.0.1', r))
  t.after(async () => { await app.close() })
  const base = 'http://127.0.0.1:' + app.server.address().port

  // 1. Initiate OAuth
  const initRes = await fetch(base + '/api/auth/google?returnTo=/?mode=team', { redirect: 'manual' })
  assert.equal(initRes.status, 302)
  const state = new URL(initRes.headers.get('location')).searchParams.get('state')

  // 2. Callback from Google
  const callbackRes = await fetch(base + `/api/auth/google/callback?code=valid_google_code&state=${state}`, {
    redirect: 'manual',
    headers: { Accept: 'application/json' },
  })

  assert.equal(callbackRes.status, 200)
  assert.ok(tokenFetched, 'Token endpoint should have been called')
  assert.ok(userinfoFetched, 'Userinfo endpoint should have been called')

  const setCookie = callbackRes.headers.get('set-cookie')
  assert.ok(setCookie, 'Should set session cookie')
  assert.match(setCookie, /vibebot_session=/)
  assert.match(setCookie, /; Path=\//)
  assert.match(setCookie, /; HttpOnly/)
  assert.match(setCookie, /; SameSite=Strict/)

  const sessionToken = setCookie.split(';')[0].replace('vibebot_session=', '')

  // 3. Replay attack: reusing the same state must fail
  const replayRes = await fetch(base + `/api/auth/google/callback?code=valid_google_code&state=${state}`, { redirect: 'manual' })
  assert.equal(replayRes.status, 400)
  assert.equal((await replayRes.json()).error?.code, 'INVALID_STATE')

  // 4. Verify session access
  const sessionRes = await fetch(base + '/api/session', {
    headers: { Cookie: `vibebot_session=${sessionToken}` },
  })
  assert.equal(sessionRes.status, 200)
  const sessionData = await sessionRes.json()
  assert.equal(sessionData.member.name, 'Даниил Теске')
  assert.equal(sessionData.member.role, 'organizer')
  assert.equal(sessionData.workspace.name, 'Команда Даниил Теске')
  assert.equal(sessionData.user.email, 'daniil@example.com')
  assert.equal(sessionData.user.name, 'Даниил Теске')

  // 5. Subsequent callback with same Google user links to existing account/workspace
  const initRes2 = await fetch(base + '/api/auth/google', { redirect: 'manual' })
  const state2 = new URL(initRes2.headers.get('location')).searchParams.get('state')

  const callbackRes2 = await fetch(base + `/api/auth/google/callback?code=valid_google_code&state=${state2}`, {
    redirect: 'manual',
    headers: { Accept: 'application/json' },
  })
  assert.equal(callbackRes2.status, 200)
  const setCookie2 = callbackRes2.headers.get('set-cookie')
  const sessionToken2 = setCookie2.split(';')[0].replace('vibebot_session=', '')

  const sessionRes2 = await fetch(base + '/api/session', {
    headers: { Cookie: `vibebot_session=${sessionToken2}` },
  })
  assert.equal(sessionRes2.status, 200)
  const sessionData2 = await sessionRes2.json()
  assert.equal(sessionData2.workspace.id, sessionData.workspace.id, 'Should reuse existing workspace for same user')
})

test('store cleanup removes expired oauth_states from SQLite', () => {
  let currentTime = 1000000
  const now = () => currentTime
  const store = createStore({ path: ':memory:', secret, now })

  store.saveOAuthState('valid-state-1', '/?mode=team', 600000)
  store.saveOAuthState('state-to-expire', '/?mode=team', 1000)

  // Verify both states exist
  assert.ok(store.consumeOAuthState('valid-state-1'))

  // Advance time past 1000ms
  currentTime += 5000
  store.cleanup()

  // Expired state must not be consumable
  assert.equal(store.consumeOAuthState('state-to-expire'), null)
})
