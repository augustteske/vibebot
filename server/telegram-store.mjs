import { createHash, createHmac, randomBytes } from 'node:crypto'
import { transitionConsent } from '../src/core/telegram.ts'

const DAY = 86400000
const LINK_TTL = 600000
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const telegramId = value => typeof value === 'string' && /^[1-9][0-9]{0,15}$/.test(value)
const version = value => typeof value === 'string' && value.length > 0 && value.length <= 100 && value === value.trim()
const revision = value => Number.isSafeInteger(value) && value >= 0
const canonical = value => JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === 'object'
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)

// Uses the existing database/transaction boundary. No message storage or network I/O.
// Bootstrap tokens and credential provisioning are deliberately outside this slice.
export function createTelegramStore({ db, secret, fail, enabled = false, now = Date.now }) {
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS members_workspace_id ON members(workspace_id,id);
    CREATE TABLE IF NOT EXISTS telegram_bindings(
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      chat_id TEXT, state TEXT NOT NULL, evidence_expires INTEGER,
      migration_blocked INTEGER NOT NULL DEFAULT 0,
      UNIQUE(id,workspace_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS telegram_active_chat ON telegram_bindings(chat_id) WHERE chat_id IS NOT NULL;
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
  `)
  const one = (sql, ...args) => db.prepare(sql).get(...args)
  const run = (sql, ...args) => db.prepare(sql).run(...args)
  const tx = fn => {
    db.exec('BEGIN IMMEDIATE')
    try { const result = fn(); db.exec('COMMIT'); return result }
    catch (error) { db.exec('ROLLBACK'); throw error }
  }
  const digest = value => createHmac('sha256', secret).update(value).digest('hex')
  const invalid = () => fail(400, 'INVALID_INPUT', 'Проверьте поля запроса')
  const unavailable = () => { if (!enabled) fail(503, 'UNAVAILABLE', 'Синтетический контур Telegram выключен') }
  const publicStatus = (binding, state) => ({ bindingId: binding.id, phase: state.phase,
    revision: state.revision, policyVersion: state.policyVersion, rosterVersion: state.rosterVersion })
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
      if (!input || Array.isArray(input) || typeof input !== 'object'
        || Object.keys(input).length !== 3 || !uuid(input.requestId)
        || typeof input.token !== 'string' || !/^[a-f0-9]{64}$/.test(input.token)
        || !telegramId(input.telegramUserId)) invalid()
      return tx(() => {
        // The credential selects both workspace and binding. The Telegram ID must come from
        // a verified private-chat update's from_user.id in the trusted bot transport.
        const binding = bindingFor(actor, actor.binding_id)
        const tokenHash = createHash('sha256').update(input.token).digest('hex')
        const actorKey = digest('bot:' + actor.token_hash)
        const requestDigest = digest(canonical({ operation: 'link', tokenHash, telegramUserId: input.telegramUserId }))
        const previous = one('SELECT * FROM telegram_requests WHERE binding_id=? AND actor_key=? AND request_id=?',
          binding.id, actorKey, input.requestId)
        if (previous) {
          if (previous.digest !== requestDigest) fail(409, 'EVENT_CONFLICT', 'Идентификатор запроса уже использован')
          return JSON.parse(previous.response)
        }
        if (JSON.parse(binding.state).phase === 'disconnected') fail(409, 'CONSENT_REQUIRED', 'Привязка отключена')
        const link = one('SELECT * FROM telegram_link_tokens WHERE token_hash=? AND workspace_id=?', tokenHash, actor.workspace_id)
        if (!link) fail(404, 'NOT_FOUND', 'Токен не найден')
        if (link.used || link.expires <= now()) fail(409, 'TOKEN_EXPIRED', 'Токен использован или истёк')
        if (one('SELECT 1 FROM telegram_links WHERE binding_id=? AND (member_id=? OR telegram_user_id=?)',
          binding.id, link.member_id, input.telegramUserId)) fail(409, 'LINK_CONFLICT', 'Связь уже существует')
        run('INSERT INTO telegram_links VALUES(?,?,?,?)', binding.id, actor.workspace_id, link.member_id, input.telegramUserId)
        run('UPDATE telegram_link_tokens SET used=1 WHERE token_hash=?', tokenHash)
        const response = { linked: true }
        run('INSERT INTO telegram_requests VALUES(?,?,?,?,?,?)',
          binding.id, actorKey, input.requestId, requestDigest, JSON.stringify(response), now() + DAY)
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
    status(actor, id) {
      unavailable()
      return tx(() => { const binding = expireBinding(bindingFor(actor, id)); return publicStatus(binding, JSON.parse(binding.state)) })
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
        if ((event.type === 'decision' && event.decision !== 'accepted') || (event.type === 'company' && !event.accepted)) {
          evidenceExpires = Math.min(evidenceExpires ?? Infinity, now() + DAY)
        }
        run('UPDATE telegram_bindings SET state=?,evidence_expires=?,chat_id=? WHERE id=?',
          JSON.stringify(next), evidenceExpires, event.type === 'disconnect' ? null : binding.chat_id, id)
        if (operation === 'pause' && input.reason === 'chat_migration') run('UPDATE telegram_bindings SET migration_blocked=1 WHERE id=?', id)
        if (event.type === 'disconnect') run('DELETE FROM telegram_links WHERE binding_id=?', id)
        const response = publicStatus(binding, next)
        run('INSERT INTO telegram_requests VALUES(?,?,?,?,?,?)', id, actorKey, input.requestId, requestDigest, JSON.stringify(response), now() + DAY)
        return response
      })
    },
  }
}
