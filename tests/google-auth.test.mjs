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

test('GET /api/auth/google redirects to Google consent screen, binds state to HttpOnly cookie and validates scope', async t => {
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
  
  // Scope must only be openid email profile - NO calendar scope
  assert.equal(parsedUrl.searchParams.get('scope'), 'openid email profile')

  const state = parsedUrl.searchParams.get('state')
  assert.ok(state && state.length >= 32, 'state should be a secure random string')

  // Check state binding cookie vibee_oauth
  const setCookie = res.headers.get('set-cookie')
  assert.ok(setCookie, 'Should set state cookie')
  assert.match(setCookie, new RegExp(`vibee_oauth=${state}`))
  assert.match(setCookie, /; Path=\/api\/auth\/google/)
  assert.match(setCookie, /; HttpOnly/)
  assert.match(setCookie, /; SameSite=Lax/)
  assert.match(setCookie, /; Max-Age=600/)
})

test('returnTo sanitization: only paths starting with single slash without //, /\\ or newlines are allowed', async t => {
  const app = createApp({
    secret,
    dbPath: ':memory:',
    googleClientId: 'mock-google-client-id',
    googleClientSecret: 'mock-google-client-secret',
    oauthFetch: async (url) => {
      if (url === 'https://oauth2.googleapis.com/token') {
        return { ok: true, json: async () => ({ access_token: 'acc', refresh_token: 'ref', expires_in: 3600 }) }
      }
      if (url === 'https://www.googleapis.com/oauth2/v3/userinfo') {
        return { ok: true, json: async () => ({ sub: 'user-sub-1', email: 'u1@example.com', email_verified: true, name: 'U1' }) }
      }
      throw new Error('Unexpected url')
    },
  })
  await new Promise(r => app.server.listen(0, '127.0.0.1', r))
  t.after(async () => { await app.close() })
  const base = 'http://127.0.0.1:' + app.server.address().port

  const maliciousUrls = [
    'https://evil.com',
    '//evil.com',
    '/\\evil.com',
    '/safe\reval',
    '/safe\neval',
  ]

  for (const evilUrl of maliciousUrls) {
    const initRes = await fetch(base + '/api/auth/google?returnTo=' + encodeURIComponent(evilUrl), { redirect: 'manual' })
    const state = new URL(initRes.headers.get('location')).searchParams.get('state')
    const cookie = initRes.headers.get('set-cookie').split(';')[0]

    const callbackRes = await fetch(base + `/api/auth/google/callback?code=mock_code&state=${state}`, {
      redirect: 'manual',
      headers: { Cookie: cookie },
    })
    assert.equal(callbackRes.status, 302)
    assert.equal(callbackRes.headers.get('location'), '/?mode=team', `Evil returnTo "${evilUrl}" should fallback to /?mode=team`)
  }

  // Valid path should be preserved
  const validPath = '/teams/reports?period=2'
  const initValid = await fetch(base + '/api/auth/google?returnTo=' + encodeURIComponent(validPath), { redirect: 'manual' })
  const validState = new URL(initValid.headers.get('location')).searchParams.get('state')
  const validCookie = initValid.headers.get('set-cookie').split(';')[0]

  const callbackValid = await fetch(base + `/api/auth/google/callback?code=mock_code&state=${validState}`, {
    redirect: 'manual',
    headers: { Cookie: validCookie },
  })
  assert.equal(callbackValid.status, 302)
  assert.equal(callbackValid.headers.get('location'), validPath, 'Valid returnTo path should be preserved')
})

test('State cookie binding: callback requires matching vibee_oauth cookie and immediately clears it', async t => {
  const app = createApp({
    secret,
    dbPath: ':memory:',
    googleClientId: 'mock-google-client-id',
    googleClientSecret: 'mock-google-client-secret',
    oauthFetch: async (url) => {
      if (url === 'https://oauth2.googleapis.com/token') {
        return { ok: true, json: async () => ({ access_token: 'acc', expires_in: 3600 }) }
      }
      if (url === 'https://www.googleapis.com/oauth2/v3/userinfo') {
        return { ok: true, json: async () => ({ sub: 'uid-cookie-test', email: 'cookie@example.com', email_verified: true, name: 'Cookie' }) }
      }
      throw new Error('Unexpected url')
    },
  })
  await new Promise(r => app.server.listen(0, '127.0.0.1', r))
  t.after(async () => { await app.close() })
  const base = 'http://127.0.0.1:' + app.server.address().port

  const initRes = await fetch(base + '/api/auth/google', { redirect: 'manual' })
  const validState = new URL(initRes.headers.get('location')).searchParams.get('state')
  const validCookie = initRes.headers.get('set-cookie').split(';')[0]

  // 1. Valid state from DB but without cookie -> 400
  const noCookieRes = await fetch(base + `/api/auth/google/callback?code=mock&state=${validState}`, { redirect: 'manual' })
  assert.equal(noCookieRes.status, 400)
  assert.equal((await noCookieRes.json()).error?.code, 'INVALID_STATE')

  // 2. Valid state from DB but foreign/mismatched cookie -> 400
  const foreignCookieRes = await fetch(base + `/api/auth/google/callback?code=mock&state=${validState}`, {
    redirect: 'manual',
    headers: { Cookie: 'vibee_oauth=some-foreign-browser-state' },
  })
  assert.equal(foreignCookieRes.status, 400)
  assert.equal((await foreignCookieRes.json()).error?.code, 'INVALID_STATE')

  // 3. Valid state with matching cookie -> succeeds and clears vibee_oauth cookie (Max-Age=0)
  const successRes = await fetch(base + `/api/auth/google/callback?code=mock&state=${validState}`, {
    redirect: 'manual',
    headers: { Cookie: validCookie },
  })
  assert.equal(successRes.status, 302)
  const setCookies = successRes.headers.getSetCookie ? successRes.headers.getSetCookie() : [successRes.headers.get('set-cookie')]
  const clearedOauthCookie = setCookies.find(c => c.includes('vibee_oauth='))
  assert.ok(clearedOauthCookie, 'Should send cleared vibee_oauth cookie')
  assert.match(clearedOauthCookie, /Max-Age=0/)
})

test('loginWithGoogle: email linking requires email_verified === true and conflicting email returns 409', async () => {
  const store = createStore({ path: ':memory:', secret })

  // 1. Pre-existing user with google_id_A and email alice@example.com
  store.loginWithGoogle({
    googleId: 'google-user-A',
    email: 'alice@example.com',
    emailVerified: true,
    name: 'Alice A',
  })

  // 2. Attempt login with google_id_B claiming the same email alice@example.com -> MUST FAIL with 409
  assert.throws(
    () => store.loginWithGoogle({
      googleId: 'google-user-B',
      email: 'alice@example.com',
      emailVerified: true,
      name: 'Imposter B',
    }),
    err => err.status === 409 && err.code === 'EMAIL_CONFLICT'
  )

  // 3. Unverified email from Google cannot link an existing email account without matching google_id
  assert.throws(
    () => store.loginWithGoogle({
      googleId: 'google-user-C',
      email: 'alice@example.com',
      emailVerified: false,
      name: 'Unverified C',
    }),
    err => err.status === 409 || err.status === 403
  )

  // 4. Searching existing user works strictly by google_id
  const sameA = store.loginWithGoogle({
    googleId: 'google-user-A',
    email: 'alice@example.com',
    emailVerified: true,
    name: 'Alice Updated',
  })
  assert.equal(sameA.user.google_id, 'google-user-A')
  assert.equal(sameA.user.name, 'Alice Updated')
})

test('Tokens are stored encrypted in SQLite with AES-256-GCM via HKDF key and not in plaintext', async () => {
  const store = createStore({ path: ':memory:', secret })

  const plainAccess = 'ya29.sensitive-access-token-123456789'
  const plainRefresh = '1//sensitive-refresh-token-987654321'

  const { user } = store.loginWithGoogle({
    googleId: 'crypto-test-user',
    email: 'crypto@example.com',
    emailVerified: true,
    name: 'Crypto User',
    accessToken: plainAccess,
    refreshToken: plainRefresh,
    expiresIn: 3600,
  })

  const tokens = store.getGoogleTokensForMember(user.member_id)
  assert.equal(tokens.access_token, plainAccess, 'Decrypted access_token must match plaintext')
  assert.equal(tokens.refresh_token, plainRefresh, 'Decrypted refresh_token must match plaintext')

  // Check raw user in store: raw access_token in DB must not be plain text
  const rawRow = store.getUserRaw(user.id)
  assert.notEqual(rawRow.access_token, plainAccess, 'Raw access token in DB must be encrypted')
  assert.notEqual(rawRow.refresh_token, plainRefresh, 'Raw refresh token in DB must be encrypted')
  assert.match(rawRow.access_token, /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i, 'Token format should be iv:tag:data')
})
