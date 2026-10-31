import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { AppError, createStore } from './store.mjs'

export function createApp({ dbPath = ':memory:', secret, staticDir, secureCookies = false, allowedOrigins = [], telegramBootstrapCredential, telegramSynthetic = false, now = Date.now }) {
  const store = createStore({ path: dbPath, secret, telegramBootstrapCredential, telegramSynthetic, now })
  const cleanupTimer = setInterval(() => {
    try { store.telegram.cleanup() } catch { console.error('Vibee: Telegram cleanup failed') }
  }, 60000)
  cleanupTimer.unref()
  const cookie = token => 'vibebot_session=' + token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + (token ? 604800 : 0) + (secureCookies ? '; Secure' : '')
  const tokenFrom = req => (req.headers.cookie ?? '').split(';').map(s => s.trim()).find(s => s.startsWith('vibebot_session='))?.slice(16)
  const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)) }
  const checkBrowser = req => {
    if (req.headers['x-vibee'] !== '1' && req.headers['x-vibebot'] !== '1') throw new AppError(403, 'REQUEST_REJECTED', 'Обновите страницу и повторите действие')
    const origin = req.headers.origin
    const sameOrigin = (secureCookies ? 'https://' : 'http://') + req.headers.host
    if (origin && origin !== sameOrigin && !allowedOrigins.includes(origin)) throw new AppError(403, 'ORIGIN_REJECTED', 'Запрос с другого сайта запрещён')
  }
  async function body(req, invalidCode = 'INVALID_JSON') {
    if (!req.headers['content-type']?.startsWith('application/json')) throw new AppError(415, 'JSON_REQUIRED', 'Нужен запрос JSON')
    let size = 0
    const chunks = []
    for await (const chunk of req) {
      size += chunk.length
      if (size > 32768) throw new AppError(413, 'TOO_LARGE', 'Слишком большой запрос')
      chunks.push(chunk)
    }
    try {
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error()
      return value
    } catch { throw new AppError(400, invalidCode, 'Не удалось прочитать запрос') }
  }
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('X-Frame-Options', 'DENY')
    try {
      const url = new URL(req.url, 'http://localhost')
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' || !staticDir) throw new AppError(404, 'NOT_FOUND', 'Страница не найдена')
        const root = resolve(staticDir)
        const file = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname))
        if (!file.startsWith(root + sep)) throw new AppError(404, 'NOT_FOUND', 'Страница не найдена')
        let data
        try { data = await readFile(file) } catch { throw new AppError(404, 'NOT_FOUND', 'Страница не найдена') }
        const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' }); return res.end(data)
      }
      if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true })
      if (!['GET', 'POST'].includes(req.method)) throw new AppError(405, 'METHOD_NOT_ALLOWED', 'Метод не поддерживается')
      if (['/api/telegram/link-tokens', '/api/bot/v1/links', '/api/telegram/binding-tokens', '/api/bot/v1/bindings'].includes(url.pathname)) {
        if (req.method !== 'POST') throw new AppError(404, 'NOT_FOUND', 'Маршрут Telegram не реализован')
        if (!telegramSynthetic) throw new AppError(503, 'UNAVAILABLE', 'Синтетический контур Telegram выключен')
        const bot = url.pathname.startsWith('/api/bot/')
        if (!bot) checkBrowser(req)
        const actor = bot ? store.telegram.authenticateBootstrap(req.headers.authorization) : store.authenticate(tokenFrom(req))
        if (!actor) throw new AppError(401, 'SIGN_IN_REQUIRED', 'Войдите в пространство команды')
        const input = await body(req, 'INVALID_INPUT')
        const result = url.pathname === '/api/bot/v1/links' ? store.telegram.consumeLinkToken(actor, input)
          : url.pathname === '/api/bot/v1/bindings' ? store.telegram.bind(actor, input)
          : url.pathname === '/api/telegram/binding-tokens' ? store.telegram.issueBindingToken(actor, input)
          : store.telegram.issueLinkToken(actor, input)
        return json(res, bot ? 200 : 201, result)
      }
      const periodRoute = url.pathname.match(/^\/api\/telegram\/bindings\/([a-f0-9-]+)\/(periods\/close|summary)$/)
      if (periodRoute) {
        if (!telegramSynthetic) throw new AppError(503, 'UNAVAILABLE', 'Синтетический контур Telegram выключен')
        const closing = periodRoute[2] === 'periods/close'
        if (req.method !== (closing ? 'POST' : 'GET')) throw new AppError(404, 'NOT_FOUND', 'Маршрут Telegram не реализован')
        if (closing) checkBrowser(req)
        const actor = store.authenticate(tokenFrom(req))
        if (!actor) throw new AppError(401, 'SIGN_IN_REQUIRED', 'Войдите в пространство команды')
        return json(res, 200, closing
          ? store.telegram.closePeriod(actor, periodRoute[1], await body(req, 'INVALID_INPUT'))
          : store.telegram.summary(actor, periodRoute[1]))
      }
      if (url.pathname.startsWith('/api/bot/') || url.pathname.startsWith('/api/telegram/')) {
        const route = url.pathname.match(/^\/api\/(bot\/v1|telegram)\/bindings\/([a-f0-9-]+)(?:\/(roster|company|consents|control|pause|events))?$/)
        const bot = route?.[1] === 'bot/v1'
        const operation = route?.[3]
        const supported = route && (bot
          ? (req.method === 'GET' && !operation) || (req.method === 'POST' && ['consents', 'pause', 'events'].includes(operation))
          : req.method === 'POST' && ['roster', 'company', 'control'].includes(operation))
        if (!supported) throw new AppError(404, 'NOT_FOUND', 'Маршрут Telegram не реализован')
        if (!telegramSynthetic) throw new AppError(503, 'UNAVAILABLE', 'Синтетический контур Telegram выключен')
        if (!bot) checkBrowser(req)
        const actor = bot ? store.telegram.authenticate(req.headers.authorization) : store.authenticate(tokenFrom(req))
        if (!actor) throw new AppError(401, 'SIGN_IN_REQUIRED', 'Войдите в пространство команды')
        const result = req.method === 'GET' ? store.telegram.status(actor, route[2])
          : operation === 'events' ? store.telegram.acceptText(actor, route[2], await body(req, 'INVALID_INPUT'))
          : store.telegram.mutate(actor, route[2], operation, await body(req, 'INVALID_INPUT'))
        return json(res, 200, result)
      }
      if (req.method === 'POST') checkBrowser(req)
      const input = req.method === 'POST' ? await body(req) : null
      const token = tokenFrom(req)
      const member = store.authenticate(token)
      if (req.method === 'POST' && ['/api/workspaces', '/api/join', '/api/restore'].includes(url.pathname)) {
        if (member) throw new AppError(409, 'ALREADY_SIGNED_IN', 'Сначала выйдите из текущего пространства')
        const newToken = url.pathname === '/api/workspaces' ? store.createWorkspace(input) : url.pathname === '/api/restore' ? store.restore(input) : store.join(input)
        res.setHeader('Set-Cookie', cookie(newToken))
        return json(res, 201, store.snapshot(store.authenticate(newToken)))
      }
      if (!member) throw new AppError(401, 'SIGN_IN_REQUIRED', 'Войдите в пространство команды')
      if (req.method === 'GET' && url.pathname === '/api/session') return json(res, 200, store.snapshot(member))
      if (req.method === 'POST') {
        if (url.pathname === '/api/logout') {
          store.logout(token); res.setHeader('Set-Cookie', cookie('')); return json(res, 200, { ok: true })
        }
        if (url.pathname === '/api/invitations') return json(res, 201, store.invite(member))
        if (url.pathname === '/api/recovery-key') return json(res, 201, store.recoveryKey(member))
        const feedback = url.pathname.match(/^\/api\/actions\/([a-f0-9-]+)\/(feedback|close-feedback)$/)
        if (url.pathname === '/api/checkins') store.checkin(member, input)
        else if (url.pathname === '/api/rounds/close') store.closeRound(member, input)
        else if (url.pathname === '/api/rounds/open') store.openRound(member)
        else if (url.pathname === '/api/actions') store.accept(member, input)
        else if (feedback?.[2] === 'feedback') store.feedback(member, feedback[1], input)
        else if (feedback?.[2] === 'close-feedback') store.closeFeedback(member, feedback[1])
        else throw new AppError(404, 'NOT_FOUND', 'Действие не найдено')
        return json(res, 200, store.snapshot(member))
      }
      throw new AppError(404, 'NOT_FOUND', 'Действие не найдено')
    } catch (error) {
      if (res.headersSent) return res.end()
      if (error instanceof AppError) return json(res, error.status, { error: { code: error.code, message: error.message } })
      console.error('Vibee: request failed without logging request data')
      return json(res, 500, { error: { code: 'INTERNAL_ERROR', message: 'Не удалось выполнить действие. Попробуйте ещё раз.' } })
    }
  })
  return {
    server,
    close: () => new Promise((resolveClose, reject) => {
      clearInterval(cleanupTimer)
      server.close(error => { try { store.close(); error ? reject(error) : resolveClose() } catch (failure) { reject(failure) } })
      server.closeIdleConnections()
    }),
  }
}
