import { createHash, createHmac, randomBytes, timingSafeEqual, randomUUID } from 'node:crypto'
import { canProcessChat, initialConsentState, transitionConsent } from '../src/core/telegram.ts'

const DAY = 86400000
const LINK_TTL = 600000
const TEXT_TTL = 900000
const CLOSED_TTL = 7 * DAY
const PROFILE = { version: 1, timeZone: 'Asia/Omsk', startMinute: 540, endMinute: 1080 }
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const telegramId = value => typeof value === 'string' && /^[1-9][0-9]{0,15}$/.test(value)
const chatId = value => typeof value === 'string' && /^-[1-9][0-9]{0,19}$/.test(value)
const version = value => typeof value === 'string' && value.length > 0 && value.length <= 100 && value === value.trim()
const revision = value => Number.isSafeInteger(value) && value >= 0
const messageId = value => typeof value === 'string' && /^[1-9][0-9]{0,15}$/.test(value)
const utcTime = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}
const canonical = value => JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === 'object'
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)

// Uses the existing database/transaction boundary. No message storage or network I/O.
// Bootstrap tokens and credential provisioning are deliberately outside this slice.
export function createTelegramStore({ db, secret, bootstrapCredential, fail, enabled = false, now = Date.now }) {
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS members_workspace_id ON members(workspace_id,id);
    CREATE TABLE IF NOT EXISTS telegram_bindings(
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      chat_id TEXT, state TEXT NOT NULL, evidence_expires INTEGER,
      migration_blocked INTEGER NOT NULL DEFAULT 0,
      UNIQUE(id,workspace_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS telegram_active_chat ON telegram_bindings(chat_id) WHERE chat_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS telegram_identities(
      workspace_id TEXT NOT NULL, member_id TEXT NOT NULL, telegram_user_id TEXT NOT NULL,
      PRIMARY KEY(workspace_id,member_id), UNIQUE(workspace_id,telegram_user_id),
      FOREIGN KEY(workspace_id,member_id) REFERENCES members(workspace_id,id)
    );
    CREATE TABLE IF NOT EXISTS telegram_links(
      binding_id TEXT NOT NULL, workspace_id TEXT NOT NULL, member_id TEXT NOT NULL,
      telegram_user_id TEXT NOT NULL,
      PRIMARY KEY(binding_id,member_id), UNIQUE(binding_id,telegram_user_id),
      FOREIGN KEY(binding_id,workspace_id) REFERENCES telegram_bindings(id,workspace_id),
      FOREIGN KEY(workspace_id,member_id) REFERENCES members(workspace_id,id)
    );
    CREATE TABLE IF NOT EXISTS telegram_credentials(
      token_hash TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, binding_id TEXT NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)),
      FOREIGN KEY(binding_id,workspace_id) REFERENCES telegram_bindings(id,workspace_id)
    );
    CREATE TABLE IF NOT EXISTS telegram_requests(
      binding_id TEXT NOT NULL REFERENCES telegram_bindings(id), actor_key TEXT NOT NULL,
      request_id TEXT NOT NULL, digest TEXT NOT NULL, response TEXT NOT NULL, expires INTEGER NOT NULL,
      PRIMARY KEY(binding_id,actor_key,request_id)
    );
    CREATE TABLE IF NOT EXISTS telegram_link_tokens(
      token_hash TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, member_id TEXT NOT NULL,
      request_id TEXT NOT NULL, expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0 CHECK(used IN (0,1)),
      UNIQUE(member_id,request_id), FOREIGN KEY(workspace_id,member_id) REFERENCES members(workspace_id,id)
    );
    CREATE TABLE IF NOT EXISTS telegram_binding_tokens(
      token_hash TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, member_id TEXT NOT NULL,
      request_id TEXT NOT NULL, expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0 CHECK(used IN (0,1)),
      UNIQUE(member_id,request_id), FOREIGN KEY(workspace_id,member_id) REFERENCES members(workspace_id,id)
    );
    CREATE TABLE IF NOT EXISTS telegram_binding_requests(
      actor_key TEXT NOT NULL, request_id TEXT NOT NULL, digest TEXT NOT NULL,
      binding_id TEXT NOT NULL REFERENCES telegram_bindings(id), token_hash TEXT NOT NULL,
      expires INTEGER NOT NULL, PRIMARY KEY(actor_key,request_id)
    );
    CREATE TABLE IF NOT EXISTS telegram_identity_requests(
      actor_key TEXT NOT NULL, request_id TEXT NOT NULL, digest TEXT NOT NULL,
      response TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(actor_key,request_id)
    );
    CREATE TABLE IF NOT EXISTS telegram_event_ids(
      binding_id TEXT NOT NULL REFERENCES telegram_bindings(id), event_id TEXT NOT NULL,
      digest TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(binding_id,event_id)
    );
    CREATE TABLE IF NOT EXISTS telegram_message_ids(
      binding_id TEXT NOT NULL REFERENCES telegram_bindings(id), chat_id TEXT NOT NULL,
      message_id TEXT NOT NULL, digest TEXT NOT NULL, expires INTEGER NOT NULL,
      PRIMARY KEY(binding_id,chat_id,message_id)
    );
    CREATE TABLE IF NOT EXISTS telegram_texts(
      binding_id TEXT NOT NULL REFERENCES telegram_bindings(id), chat_id TEXT NOT NULL,
      message_id TEXT NOT NULL, sender_id TEXT NOT NULL, sent_at TEXT NOT NULL,
      text TEXT NOT NULL, expires INTEGER NOT NULL,
      PRIMARY KEY(binding_id,chat_id,message_id)
    );
    CREATE TABLE IF NOT EXISTS telegram_open_periods(
      binding_id TEXT PRIMARY KEY REFERENCES telegram_bindings(id), opened_at INTEGER NOT NULL,
      revision INTEGER NOT NULL, profile_version INTEGER NOT NULL,
      total INTEGER NOT NULL, outside_count INTEGER NOT NULL, recognition_count INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS telegram_period_authors(
      binding_id TEXT NOT NULL REFERENCES telegram_bindings(id), member_id TEXT NOT NULL,
      count INTEGER NOT NULL, PRIMARY KEY(binding_id,member_id)
    );
    CREATE TABLE IF NOT EXISTS telegram_closed_periods(
      binding_id TEXT NOT NULL REFERENCES telegram_bindings(id), period_id TEXT NOT NULL,
      start_at INTEGER NOT NULL, closed_at INTEGER NOT NULL, local_date TEXT NOT NULL, revision INTEGER NOT NULL,
      profile_version INTEGER NOT NULL, status TEXT NOT NULL, metrics TEXT,
      expires INTEGER NOT NULL, PRIMARY KEY(binding_id,period_id)
    );
    CREATE TABLE IF NOT EXISTS telegram_close_requests(
      binding_id TEXT NOT NULL REFERENCES telegram_bindings(id), actor_key TEXT NOT NULL,
      request_id TEXT NOT NULL, digest TEXT NOT NULL, period_id TEXT NOT NULL,
      response_status TEXT NOT NULL, expires INTEGER NOT NULL,
      PRIMARY KEY(binding_id,actor_key,request_id)
    );
  `)
  const one = (sql, ...args) => db.prepare(sql).get(...args)
  const run = (sql, ...args) => db.prepare(sql).run(...args)
  const tx = fn => {
    db.exec('BEGIN IMMEDIATE')
    try { const result = fn(); db.exec('COMMIT'); return result }
    catch (error) { db.exec('ROLLBACK'); throw error }
  }
  const digest = value => createHmac('sha256', secret).update(value).digest('hex')
  const hash = value => createHash('sha256').update(value).digest('hex')
  const invalid = () => fail(400, 'INVALID_INPUT', 'Проверьте поля запроса')
  const unavailable = () => { if (!enabled) fail(503, 'UNAVAILABLE', 'Синтетический контур Telegram выключен') }
  const publicStatus = (binding, state) => ({ bindingId: binding.id, phase: state.phase,
    revision: state.revision, policyVersion: state.policyVersion, rosterVersion: state.rosterVersion })
  const purgeText = bindingId => run('DELETE FROM telegram_texts WHERE binding_id=?', bindingId)
  const clearOpenPeriod = bindingId => {
    run('DELETE FROM telegram_period_authors WHERE binding_id=?', bindingId)
    run('DELETE FROM telegram_open_periods WHERE binding_id=?', bindingId)
  }
  const clearDerived = bindingId => {
    clearOpenPeriod(bindingId)
    run('DELETE FROM telegram_closed_periods WHERE binding_id=?', bindingId)
  }
  const localParts = millis => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: PROFILE.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(millis)).map(part => [part.type, part.value]))
    return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: parts.weekday,
      minute: Number(parts.hour) * 60 + Number(parts.minute) }
  }
  const outsideHours = millis => {
    const local = localParts(millis)
    return !['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(local.weekday)
      || local.minute < PROFILE.startMinute || local.minute >= PROFILE.endMinute
  }
  const recognition = text => Array.from(text.toLowerCase().matchAll(/\p{L}+/gu), match => match[0])
      .some(word => ['спасибо', 'благодарю', 'благодарим', 'thanks'].includes(word))
  const roundOne = value => Math.round(value * 10) / 10
  const periodView = row => {
    if (row.status !== 'valid') return { status: 'insufficient' }
    const dates = one("SELECT COUNT(DISTINCT local_date) AS n FROM telegram_closed_periods WHERE binding_id=? AND profile_version=? AND revision=? AND status='valid' AND expires>?",
      row.binding_id, row.profile_version, row.revision, now()).n
    if (dates < 3) return { status: 'calibrating' }
    return { status: 'published', demo: true,
      period: { id: row.period_id, start: new Date(row.start_at).toISOString(), end: new Date(row.closed_at).toISOString() },
      dataSource: 'chat', profileVersion: row.profile_version, metrics: JSON.parse(row.metrics),
      recognitionMethod: 'lexicon-v1', comparison: null }
  }
  const expireBinding = binding => {
    if (binding.evidence_expires === null || binding.evidence_expires > now()) return binding
    const state = JSON.parse(binding.state)
    state.decisions = {}
    state.companyAccepted = false
    if (state.phase !== 'disconnected') state.phase = 'paused'
    state.revision++
    run('UPDATE telegram_bindings SET state=?,evidence_expires=NULL WHERE id=?', JSON.stringify(state), binding.id)
    return { ...binding, state: JSON.stringify(state), evidence_expires: null }
  }
  const cleanup = () => tx(() => {
    const time = now()
    run('DELETE FROM telegram_requests WHERE expires<=?', time)
    run('DELETE FROM telegram_link_tokens WHERE expires<=?', time - DAY)
    run('DELETE FROM telegram_binding_tokens WHERE expires<=?', time - DAY)
    run('DELETE FROM telegram_binding_requests WHERE expires<=?', time)
    run('DELETE FROM telegram_identity_requests WHERE expires<=?', time)
    run('DELETE FROM telegram_texts WHERE expires<=?', time)
    run('DELETE FROM telegram_event_ids WHERE expires<=?', time)
    run('DELETE FROM telegram_message_ids WHERE expires<=?', time)
    run('DELETE FROM telegram_closed_periods WHERE expires<=?', time)
    run('DELETE FROM telegram_close_requests WHERE expires<=?', time)
    for (const open of db.prepare('SELECT binding_id FROM telegram_open_periods WHERE opened_at<=?').all(time - DAY)) clearOpenPeriod(open.binding_id)
    for (const binding of db.prepare('SELECT * FROM telegram_bindings WHERE evidence_expires<=?').all(time)) expireBinding(binding)
  })
  cleanup()

  function validate(operation, input) {
    const schemas = {
      roster: { memberIds: v => Array.isArray(v) && v.length > 0 && v.length <= 500 && v.every(uuid) && new Set(v).size === v.length, verified: v => v === true },
      company: { accepted: v => typeof v === 'boolean', authorityConfirmed: v => v === true, policyVersion: version },
      consents: { telegramUserId: telegramId, policyVersion: version, rosterVersion: revision,
        decision: v => ['accepted', 'declined', 'withdrawn'].includes(v) },
      control: { action: v => ['resume', 'pause', 'disconnect'].includes(v) },
      pause: { reason: v => ['unknown_member', 'transport_gap', 'chat_migration', 'manual'].includes(v) },
    }
    const schema = { requestId: uuid, expectedRevision: revision, ...schemas[operation] }
    if (!schemas[operation] || !input || Array.isArray(input) || typeof input !== 'object'
      || Object.keys(input).some(key => !Object.hasOwn(schema, key))
      || Object.entries(schema).some(([key, check]) => !check(input[key]))) invalid()
  }

  function bindingFor(actor, id) {
    const binding = one('SELECT * FROM telegram_bindings WHERE id=? AND workspace_id=?', id, actor.workspace_id)
    if (!binding || (actor.kind === 'bot' && actor.binding_id !== id)) fail(404, 'NOT_FOUND', 'Привязка не найдена')
    if (actor.kind !== 'bot' && actor.role !== 'organizer') fail(403, 'FORBIDDEN', 'Нужны права организатора')
    if (actor.kind === 'bot' && !one('SELECT 1 FROM telegram_credentials WHERE token_hash=? AND revoked=0 AND workspace_id=? AND binding_id=?',
      actor.token_hash, actor.workspace_id, id)) fail(401, 'BOT_AUTH_REQUIRED', 'Нужна авторизация бота')
    return binding
  }

  return {
    cleanup,
    authenticateBootstrap(authorization) {
      unavailable()
      if (!bootstrapCredential || !/^[a-f0-9]{64}$/.test(bootstrapCredential)) {
        fail(503, 'UNAVAILABLE', 'Начальная авторизация бота не настроена')
      }
      const match = typeof authorization === 'string' && authorization.match(/^Bearer ([a-f0-9]{64})$/)
      if (!match || !timingSafeEqual(Buffer.from(hash(match[1]), 'hex'), Buffer.from(hash(bootstrapCredential), 'hex'))) {
        fail(401, 'BOT_AUTH_REQUIRED', 'Нужна начальная авторизация бота')
      }
      return { kind: 'bootstrap', token_hash: hash(bootstrapCredential) }
    },
    issueBindingToken(member, input) {
      unavailable()
      if (member.role !== 'organizer') fail(403, 'FORBIDDEN', 'Нужны права организатора')
      if (!input || Array.isArray(input) || typeof input !== 'object'
        || Object.keys(input).length !== 1 || !uuid(input.requestId)) invalid()
      return tx(() => {
        if (one('SELECT 1 FROM telegram_binding_tokens WHERE member_id=? AND request_id=?', member.id, input.requestId)) {
          fail(409, 'EVENT_CONFLICT', 'Идентификатор запроса уже использован')
        }
        run('UPDATE telegram_binding_tokens SET used=1 WHERE member_id=? AND used=0', member.id)
        const token = randomBytes(32).toString('hex')
        const expires = now() + LINK_TTL
        run('INSERT INTO telegram_binding_tokens VALUES(?,?,?,?,?,0)', hash(token), member.workspace_id, member.id, input.requestId, expires)
        return { token, expiresAt: new Date(expires).toISOString() }
      })
    },
    bind(actor, input) {
      unavailable()
      if (actor.kind !== 'bootstrap') fail(403, 'FORBIDDEN', 'Нужна начальная авторизация бота')
      if (!input || Array.isArray(input) || typeof input !== 'object'
        || Object.keys(input).length !== 4 || !uuid(input.requestId)
        || typeof input.token !== 'string' || !/^[a-f0-9]{64}$/.test(input.token)
        || !chatId(input.chatId) || !telegramId(input.initiatorId)) invalid()
      return tx(() => {
        const tokenHash = hash(input.token)
        const actorKey = digest('bootstrap:' + actor.token_hash)
        const requestDigest = digest(canonical({ operation: 'bind', tokenHash,
          chatId: input.chatId, initiatorId: input.initiatorId }))
        const previous = one('SELECT * FROM telegram_binding_requests WHERE actor_key=? AND request_id=?', actorKey, input.requestId)
        if (previous) {
          if (previous.digest !== requestDigest) fail(409, 'EVENT_CONFLICT', 'Идентификатор запроса уже использован')
          const binding = one('SELECT * FROM telegram_bindings WHERE id=?', previous.binding_id)
          const scoped = one('SELECT 1 FROM telegram_credentials WHERE token_hash=? AND revoked=0 AND binding_id=?',
            hash(digest('scoped:' + previous.binding_id + ':' + previous.token_hash + ':' + input.requestId)), previous.binding_id)
          if (!binding || !scoped || !binding.chat_id) fail(409, 'CONSENT_REQUIRED', 'Привязка больше не действует')
          return { ...publicStatus(binding, JSON.parse(binding.state)),
            credential: digest('scoped:' + binding.id + ':' + tokenHash + ':' + input.requestId) }
        }
        const token = one('SELECT * FROM telegram_binding_tokens WHERE token_hash=?', tokenHash)
        if (!token) fail(404, 'NOT_FOUND', 'Токен не найден')
        if (token.used || token.expires <= now()) fail(409, 'TOKEN_EXPIRED', 'Токен использован или истёк')
        const organizer = one('SELECT 1 FROM members WHERE id=? AND workspace_id=? AND role=?',
          token.member_id, token.workspace_id, 'organizer')
        const identity = one('SELECT 1 FROM telegram_identities WHERE workspace_id=? AND member_id=? AND telegram_user_id=?',
          token.workspace_id, token.member_id, input.initiatorId)
        if (!organizer || !identity) fail(403, 'FORBIDDEN', 'Инициатор не связан с организатором')
        if (one('SELECT 1 FROM telegram_bindings WHERE chat_id=?', input.chatId)) fail(409, 'LINK_CONFLICT', 'Чат уже привязан')
        if (one('SELECT 1 FROM telegram_bindings WHERE workspace_id=? AND chat_id IS NOT NULL', token.workspace_id)) {
          fail(409, 'LINK_CONFLICT', 'Команда уже привязана к чату')
        }
        const bindingId = randomUUID()
        const state = transitionConsent(initialConsentState(), { type: 'bind', policyVersion: 'synthetic-v1' }, 0)
        run('INSERT INTO telegram_bindings(id,workspace_id,chat_id,state) VALUES(?,?,?,?)',
          bindingId, token.workspace_id, input.chatId, JSON.stringify(state))
        run('INSERT INTO telegram_links(binding_id,workspace_id,member_id,telegram_user_id) SELECT ?,workspace_id,member_id,telegram_user_id FROM telegram_identities WHERE workspace_id=?',
          bindingId, token.workspace_id)
        const credential = digest('scoped:' + bindingId + ':' + tokenHash + ':' + input.requestId)
        run('INSERT INTO telegram_credentials(token_hash,workspace_id,binding_id) VALUES(?,?,?)', hash(credential), token.workspace_id, bindingId)
        run('UPDATE telegram_binding_tokens SET used=1 WHERE token_hash=?', tokenHash)
        run('INSERT INTO telegram_binding_requests VALUES(?,?,?,?,?,?)',
          actorKey, input.requestId, requestDigest, bindingId, tokenHash, now() + DAY)
        return { ...publicStatus({ id: bindingId }, state), credential }
      })
    },
    issueLinkToken(member, input) {
      unavailable()
      if (!input || Array.isArray(input) || typeof input !== 'object'
        || Object.keys(input).length !== 1 || !uuid(input.requestId)) invalid()
      return tx(() => {
        if (one('SELECT 1 FROM telegram_link_tokens WHERE member_id=? AND request_id=?', member.id, input.requestId)) {
          fail(409, 'EVENT_CONFLICT', 'Идентификатор запроса уже использован')
        }
        // Only the authenticated web member is selected; a client cannot nominate another identity.
        run('UPDATE telegram_link_tokens SET used=1 WHERE member_id=? AND used=0', member.id)
        const token = randomBytes(32).toString('hex')
        const expires = now() + LINK_TTL
        run('INSERT INTO telegram_link_tokens VALUES(?,?,?,?,?,0)',
          createHash('sha256').update(token).digest('hex'), member.workspace_id, member.id, input.requestId, expires)
        return { token, expiresAt: new Date(expires).toISOString() }
      })
    },
    consumeLinkToken(actor, input) {
      unavailable()
      if (actor.kind !== 'bootstrap') fail(403, 'FORBIDDEN', 'Нужна начальная авторизация бота')
      if (!input || Array.isArray(input) || typeof input !== 'object'
        || Object.keys(input).length !== 3 || !uuid(input.requestId)
        || typeof input.token !== 'string' || !/^[a-f0-9]{64}$/.test(input.token)
        || !telegramId(input.telegramUserId)) invalid()
      return tx(() => {
        // The Telegram ID must come from a verified private-chat update's from_user.id.
        const tokenHash = createHash('sha256').update(input.token).digest('hex')
        const actorKey = digest('bootstrap:' + actor.token_hash)
        const requestDigest = digest(canonical({ operation: 'link', tokenHash, telegramUserId: input.telegramUserId }))
        const previous = one('SELECT * FROM telegram_identity_requests WHERE actor_key=? AND request_id=?', actorKey, input.requestId)
        if (previous) {
          if (previous.digest !== requestDigest) fail(409, 'EVENT_CONFLICT', 'Идентификатор запроса уже использован')
          return JSON.parse(previous.response)
        }
        const link = one('SELECT * FROM telegram_link_tokens WHERE token_hash=?', tokenHash)
        if (!link) fail(404, 'NOT_FOUND', 'Токен не найден')
        if (link.used || link.expires <= now()) fail(409, 'TOKEN_EXPIRED', 'Токен использован или истёк')
        if (one('SELECT 1 FROM telegram_identities WHERE workspace_id=? AND (member_id=? OR telegram_user_id=?)',
          link.workspace_id, link.member_id, input.telegramUserId)) fail(409, 'LINK_CONFLICT', 'Связь уже существует')
        for (const binding of db.prepare('SELECT id FROM telegram_bindings WHERE workspace_id=? AND chat_id IS NOT NULL').all(link.workspace_id)) {
          if (one('SELECT 1 FROM telegram_links WHERE binding_id=? AND (member_id=? OR telegram_user_id=?)',
            binding.id, link.member_id, input.telegramUserId)) fail(409, 'LINK_CONFLICT', 'Связь уже существует')
        }
        run('INSERT INTO telegram_identities VALUES(?,?,?)', link.workspace_id, link.member_id, input.telegramUserId)
        run('INSERT INTO telegram_links(binding_id,workspace_id,member_id,telegram_user_id) SELECT id,workspace_id,?,? FROM telegram_bindings WHERE workspace_id=? AND chat_id IS NOT NULL',
          link.member_id, input.telegramUserId, link.workspace_id)
        run('UPDATE telegram_link_tokens SET used=1 WHERE token_hash=?', tokenHash)
        const response = { linked: true }
        run('INSERT INTO telegram_identity_requests VALUES(?,?,?,?,?)',
          actorKey, input.requestId, requestDigest, JSON.stringify(response), now() + DAY)
        return response
      })
    },
    authenticate(authorization) {
      unavailable()
      const match = typeof authorization === 'string' && authorization.match(/^Bearer ([a-f0-9]{64})$/)
      const credential = match && one('SELECT * FROM telegram_credentials WHERE token_hash=? AND revoked=0',
        createHash('sha256').update(match[1]).digest('hex'))
      if (!credential) fail(401, 'BOT_AUTH_REQUIRED', 'Нужна авторизация бота')
      return { ...credential, kind: 'bot' }
    },
    acceptText(actor, id, input) {
      unavailable()
      if (!input || Array.isArray(input) || typeof input !== 'object'
        || Object.keys(input).length !== 7 || !uuid(input.eventId) || !revision(input.expectedRevision)
        || !chatId(input.chatId) || !messageId(input.messageId) || !telegramId(input.senderId)
        || !utcTime(input.sentAt) || typeof input.text !== 'string'
        || !input.text.trim() || Array.from(input.text).length > 4096) invalid()
      return tx(() => {
        const binding = bindingFor(actor, id)
        if (actor.kind !== 'bot') fail(403, 'FORBIDDEN', 'Нужен scoped credential бота')
        if (binding.chat_id !== input.chatId) fail(404, 'NOT_FOUND', 'Чат не найден')
        const state = JSON.parse(binding.state)
        if (input.expectedRevision !== state.revision) fail(409, 'STALE_REVISION', 'Версия изменилась')
        if (!canProcessChat(state)) fail(409, 'CONSENT_REQUIRED', 'Чат не активен')
        if (binding.evidence_expires !== null && binding.evidence_expires <= now()) {
          fail(409, 'CONSENT_REQUIRED', 'Срок свидетельства согласия истёк')
        }
        const age = now() - Date.parse(input.sentAt)
        if (age > 60000 || age < -30000) fail(400, 'INVALID_INPUT', 'Событие вне допустимого окна')
        const member = one('SELECT member_id FROM telegram_links WHERE binding_id=? AND workspace_id=? AND telegram_user_id=?',
          id, actor.workspace_id, input.senderId)?.member_id
        if (!member || !state.roster.includes(member) || state.decisions[member] !== 'accepted') {
          const paused = transitionConsent(state, { type: 'unknown_member' }, state.revision)
          run('UPDATE telegram_bindings SET state=?,evidence_expires=NULL WHERE id=?', JSON.stringify(paused), id)
          purgeText(id)
          clearDerived(id)
          return { eventId: input.eventId, result: 'paused', revision: paused.revision }
        }
        const contentDigest = digest(canonical({ chatId: input.chatId, messageId: input.messageId,
          senderId: input.senderId, sentAt: input.sentAt, text: input.text }))
        const seenEvent = one('SELECT digest FROM telegram_event_ids WHERE binding_id=? AND event_id=?', id, input.eventId)
        const seenMessage = one('SELECT digest FROM telegram_message_ids WHERE binding_id=? AND chat_id=? AND message_id=?',
          id, input.chatId, input.messageId)
        if ((seenEvent && seenEvent.digest !== contentDigest) || (seenMessage && seenMessage.digest !== contentDigest)) {
          fail(409, 'EVENT_CONFLICT', 'Событие уже использовано с другим содержимым')
        }
        if (seenEvent || seenMessage) {
          if (!seenEvent) run('INSERT INTO telegram_event_ids VALUES(?,?,?,?)', id, input.eventId, contentDigest, now() + DAY)
          return { eventId: input.eventId, result: 'duplicate', revision: state.revision }
        }
        const open = one('SELECT * FROM telegram_open_periods WHERE binding_id=?', id)
        if (open && (open.revision !== state.revision || now() - open.opened_at >= DAY)) {
          fail(409, 'STALE_PERIOD', 'Незакрытый период устарел')
        }
        run('INSERT INTO telegram_event_ids VALUES(?,?,?,?)', id, input.eventId, contentDigest, now() + DAY)
        run('INSERT INTO telegram_message_ids VALUES(?,?,?,?,?)', id, input.chatId, input.messageId, contentDigest, now() + DAY)
        run('INSERT INTO telegram_texts VALUES(?,?,?,?,?,?,?)', id, input.chatId, input.messageId,
          input.senderId, input.sentAt, input.text, now() + TEXT_TTL)
        if (!open) run('INSERT INTO telegram_open_periods VALUES(?,?,?,?,?,?,?)', id, now(), state.revision, PROFILE.version, 0, 0, 0)
        run('UPDATE telegram_open_periods SET total=total+1,outside_count=outside_count+?,recognition_count=recognition_count+? WHERE binding_id=?',
          outsideHours(Date.parse(input.sentAt)) ? 1 : 0, recognition(input.text) ? 1 : 0, id)
        run('INSERT INTO telegram_period_authors VALUES(?,?,1) ON CONFLICT(binding_id,member_id) DO UPDATE SET count=count+1', id, member)
        return { eventId: input.eventId, result: 'accepted', revision: state.revision }
      })
    },
    status(actor, id) {
      unavailable()
      return tx(() => { const binding = expireBinding(bindingFor(actor, id)); return publicStatus(binding, JSON.parse(binding.state)) })
    },
    summary(actor, id) {
      unavailable()
      return tx(() => {
        const binding = bindingFor(actor, id)
        const state = JSON.parse(binding.state)
        if (!canProcessChat(state)) return { status: state.phase }
        if (binding.evidence_expires !== null && binding.evidence_expires <= now()) return { status: 'paused' }
        if (one('SELECT 1 FROM telegram_open_periods WHERE binding_id=?', id)) return { status: 'open' }
        const closed = one('SELECT * FROM telegram_closed_periods WHERE binding_id=? AND revision=? AND expires>? ORDER BY closed_at DESC,rowid DESC LIMIT 1',
          id, state.revision, now())
        return closed ? periodView(closed) : { status: 'insufficient' }
      })
    },
    closePeriod(actor, id, input) {
      unavailable()
      if (!input || Array.isArray(input) || typeof input !== 'object'
        || Object.keys(input).length !== 3 || !uuid(input.requestId)
        || !revision(input.expectedRevision) || !uuid(input.periodId)) invalid()
      return tx(() => {
        const binding = bindingFor(actor, id)
        const state = JSON.parse(binding.state)
        if (input.expectedRevision !== state.revision) fail(409, 'STALE_REVISION', 'Версия изменилась')
        if (!canProcessChat(state)) fail(409, 'CONSENT_REQUIRED', 'Чат не активен')
        if (binding.evidence_expires !== null && binding.evidence_expires <= now()) {
          fail(409, 'CONSENT_REQUIRED', 'Срок свидетельства согласия истёк')
        }
        const actorKey = digest('web:' + actor.id)
        const requestDigest = digest(canonical({ operation: 'close', input }))
        const previous = one('SELECT * FROM telegram_close_requests WHERE binding_id=? AND actor_key=? AND request_id=?',
          id, actorKey, input.requestId)
        if (previous) {
          if (previous.digest !== requestDigest) fail(409, 'EVENT_CONFLICT', 'Идентификатор запроса уже использован')
          const closed = one('SELECT * FROM telegram_closed_periods WHERE binding_id=? AND period_id=? AND expires>?',
            id, previous.period_id, now())
          if (!closed) fail(409, 'STALE_PERIOD', 'Период больше не доступен')
          return previous.response_status === 'published' ? periodView(closed) : { status: previous.response_status }
        }
        if (one('SELECT 1 FROM telegram_closed_periods WHERE binding_id=? AND period_id=?', id, input.periodId)) {
          fail(409, 'EVENT_CONFLICT', 'Идентификатор периода уже использован')
        }
        const open = one('SELECT * FROM telegram_open_periods WHERE binding_id=?', id)
        if (!open || open.revision !== state.revision) fail(409, 'STALE_PERIOD', 'Нет актуального открытого периода')
        const authors = db.prepare('SELECT count FROM telegram_period_authors WHERE binding_id=?').all(id)
        const valid = authors.length >= 5 && open.total >= 20 && now() - open.opened_at <= DAY
        let metrics = null
        if (valid) {
          const entropy = authors.reduce((sum, row) => {
            const p = row.count / open.total
            return sum - p * Math.log(p)
          }, 0)
          metrics = { outsideHoursPercent: roundOne(100 * open.outside_count / open.total),
            participationEvenness: roundOne(100 * entropy / Math.log(state.roster.length)),
            recognitionPercent: roundOne(100 * open.recognition_count / open.total) }
        }
        const closedAt = now()
        run('INSERT INTO telegram_closed_periods VALUES(?,?,?,?,?,?,?,?,?,?)', id, input.periodId,
          open.opened_at, closedAt, localParts(open.opened_at).date, open.revision,
          open.profile_version, valid ? 'valid' : 'insufficient', metrics && JSON.stringify(metrics), closedAt + CLOSED_TTL)
        clearOpenPeriod(id)
        const closed = one('SELECT * FROM telegram_closed_periods WHERE binding_id=? AND period_id=?', id, input.periodId)
        const response = periodView(closed)
        run('INSERT INTO telegram_close_requests VALUES(?,?,?,?,?,?,?)', id, actorKey, input.requestId,
          requestDigest, input.periodId, response.status, closedAt + DAY)
        return response
      })
    },
    mutate(actor, id, operation, input) {
      unavailable()
      validate(operation, input)
      return tx(() => {
        let binding = bindingFor(actor, id)
        const botOperation = operation === 'consents' || operation === 'pause'
        if ((actor.kind === 'bot') !== botOperation) fail(403, 'FORBIDDEN', 'Недопустимый субъект действия')
        binding = expireBinding(binding)
        const state = JSON.parse(binding.state)
        let memberId
        if (operation === 'consents') {
          memberId = one('SELECT member_id FROM telegram_links WHERE binding_id=? AND workspace_id=? AND telegram_user_id=?',
            id, actor.workspace_id, input.telegramUserId)?.member_id
          if (!memberId || !state.roster.includes(memberId)) fail(403, 'FORBIDDEN', 'Личность или состав не подтверждены')
        }
        const actorKey = digest(actor.kind === 'bot' ? 'bot:' + actor.token_hash : 'web:' + actor.id)
        const requestDigest = digest(canonical({ operation, input }))
        const previous = one('SELECT * FROM telegram_requests WHERE binding_id=? AND actor_key=? AND request_id=?', id, actorKey, input.requestId)
        if (previous) {
          if (previous.digest !== requestDigest) fail(409, 'EVENT_CONFLICT', 'Идентификатор запроса уже использован')
          return JSON.parse(previous.response)
        }
        if (input.expectedRevision !== state.revision
          || ('policyVersion' in input && input.policyVersion !== state.policyVersion)
          || ('rosterVersion' in input && input.rosterVersion !== state.rosterVersion)) {
          fail(409, 'STALE_REVISION', 'Версия изменилась. Получите актуальный статус')
        }
        let event
        if (operation === 'roster') {
          for (const member of input.memberIds) {
            if (!one('SELECT 1 FROM telegram_links WHERE binding_id=? AND workspace_id=? AND member_id=?', id, actor.workspace_id, member)) {
              fail(400, 'INVALID_INPUT', 'Все участники состава должны иметь подтверждённую связь')
            }
          }
          event = { type: 'roster', members: input.memberIds }
        } else if (operation === 'company') event = { type: 'company', accepted: input.accepted }
        else if (operation === 'consents') event = { type: 'decision', memberId, decision: input.decision }
        else if (operation === 'control') event = { type: input.action }
        else event = { type: input.reason === 'unknown_member' ? 'unknown_member' : 'pause' }
        // A migrated chat must be disconnected and rebound; resume cannot bypass it.
        if (event.type === 'resume' && binding.migration_blocked) {
          fail(409, 'CONSENT_REQUIRED', 'После миграции нужна новая привязка')
        }
        let next
        try { next = transitionConsent(state, event, input.expectedRevision) }
        catch (error) {
          if (['STALE_REVISION', 'CONSENT_REQUIRED'].includes(error.message)) fail(409, error.message, 'Переход сейчас недоступен')
          fail(400, 'INVALID_INPUT', 'Переход сейчас недоступен')
        }
        let evidenceExpires = binding.evidence_expires
        if (event.type === 'roster' || event.type === 'unknown_member' || event.type === 'disconnect') evidenceExpires = null
        if (event.type === 'resume') evidenceExpires = null
        if ((event.type === 'decision' && event.decision !== 'accepted') || (event.type === 'company' && !event.accepted)) {
          evidenceExpires = Math.min(evidenceExpires ?? Infinity, now() + DAY)
        }
        run('UPDATE telegram_bindings SET state=?,evidence_expires=?,chat_id=? WHERE id=?',
          JSON.stringify(next), evidenceExpires, event.type === 'disconnect' ? null : binding.chat_id, id)
        if (['roster', 'company', 'decision', 'unknown_member', 'disconnect'].includes(event.type)) {
          purgeText(id)
          clearDerived(id)
        } else if (event.type === 'pause') {
          clearOpenPeriod(id)
          if (input.reason === 'transport_gap' || input.reason === 'chat_migration') purgeText(id)
        }
        if (operation === 'pause' && input.reason === 'chat_migration') run('UPDATE telegram_bindings SET migration_blocked=1 WHERE id=?', id)
        if (event.type === 'disconnect') {
          run('DELETE FROM telegram_identities WHERE workspace_id=? AND member_id IN (SELECT member_id FROM telegram_links WHERE binding_id=?)',
            actor.workspace_id, id)
          run('DELETE FROM telegram_links WHERE binding_id=?', id)
          run('UPDATE telegram_credentials SET revoked=1 WHERE binding_id=?', id)
        }
        const response = publicStatus(binding, next)
        run('INSERT INTO telegram_requests VALUES(?,?,?,?,?,?)', id, actorKey, input.requestId, requestDigest, JSON.stringify(response), now() + DAY)
        return response
      })
    },
  }
}
