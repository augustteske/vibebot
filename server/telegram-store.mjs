import { createHash, createHmac, randomBytes, timingSafeEqual, randomUUID } from 'node:crypto'
import { canProcessChat, initialConsentState, transitionConsent } from '../src/core/telegram.ts'
import { formatSharePeriod } from '../src/features/insights/shareCard.ts'
import { templateRecommendationProvider, recommendationProviderContent } from './recommendation-provider.mjs'
import {
  isQuestionMessage,
  calculateUnansweredQuestionsPercent,
  calculateResponseMedianMinutes,
  isPositiveMessage,
  calculatePositivityIndex,
  isIntensityMessage,
  calculateIntensityIndex,
  createActivityDistribution,
  recordActivity,
  calculateComparisonTrends,
  calculateTeamHealthScore,
} from './analytics.mjs'

const DAY = 86400000
const LINK_TTL = 600000
const TEXT_TTL = 900000
const MEDIA_POLICY_VERSION = 'synthetic-media-v1'
const TRANSCRIPTION_POLICY_VERSION = 'synthetic-transcription-v1'
const CLOSED_TTL = 7 * DAY
const MAX_INTERVALS = 70
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
const roundOne = value => Math.round(value * 10) / 10
const validCount = value => Number.isSafeInteger(value) && value >= 0

function assertMetricCounts(numerator, totalMessages) {
  if (!validCount(numerator) || !Number.isSafeInteger(totalMessages)
    || totalMessages <= 0 || numerator > totalMessages) {
    throw new RangeError('Metric counts must be non-negative integers with a positive total')
  }
}

export function calculateOutsideHoursPercent(outsideMessageCount, totalMessageCount) {
  assertMetricCounts(outsideMessageCount, totalMessageCount)
  return roundOne(100 * outsideMessageCount / totalMessageCount)
}

export function calculateParticipationEvenness(authorMessageCounts, participantCount, totalMessageCount) {
  if (!Array.isArray(authorMessageCounts) || !Number.isSafeInteger(participantCount)
    || participantCount < 2 || authorMessageCounts.length > participantCount
    || !Number.isSafeInteger(totalMessageCount) || totalMessageCount <= 0
    || authorMessageCounts.some(count => !validCount(count))
    || authorMessageCounts.reduce((sum, count) => sum + count, 0) !== totalMessageCount) {
    throw new RangeError('Participation counts must match a positive total and participant count')
  }
  const entropy = authorMessageCounts.reduce((sum, count) => {
    if (count === 0) return sum
    const proportion = count / totalMessageCount
    return sum - proportion * Math.log(proportion)
  }, 0)
  return roundOne(100 * entropy / Math.log(participantCount))
}

export function calculateRecognitionPercent(recognizedMessageCount, totalMessageCount) {
  assertMetricCounts(recognizedMessageCount, totalMessageCount)
  return roundOne(100 * recognizedMessageCount / totalMessageCount)
}

// Uses the existing database/transaction boundary. No message storage or network I/O.
// Bootstrap tokens and credential provisioning are deliberately outside this slice.
export function createTelegramStore({ db, secret, bootstrapCredential, fail, enabled = false, now = Date.now,
  recommendationProvider = templateRecommendationProvider, recommendationTimeoutMs = 3000 }) {
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
    CREATE TABLE IF NOT EXISTS telegram_checkins(
      binding_id TEXT NOT NULL REFERENCES telegram_bindings(id), nonce TEXT NOT NULL,
      digest TEXT NOT NULL, energy INTEGER NOT NULL CHECK(energy BETWEEN 1 AND 5),
      clarity INTEGER NOT NULL CHECK(clarity BETWEEN 1 AND 5),
      support INTEGER NOT NULL CHECK(support BETWEEN 1 AND 5),
      created_at INTEGER NOT NULL, expires INTEGER NOT NULL,
      PRIMARY KEY(binding_id,nonce)
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
    CREATE TABLE IF NOT EXISTS telegram_media_observations(
      binding_id TEXT NOT NULL REFERENCES telegram_bindings(id), chat_id TEXT NOT NULL,
      message_id TEXT NOT NULL, sender_id TEXT NOT NULL, sent_at TEXT NOT NULL,
      media TEXT NOT NULL, expires INTEGER NOT NULL,
      PRIMARY KEY(binding_id,chat_id,message_id)
    );
    CREATE TABLE IF NOT EXISTS telegram_open_periods(
      binding_id TEXT PRIMARY KEY REFERENCES telegram_bindings(id), opened_at INTEGER NOT NULL,
      revision INTEGER NOT NULL, profile_version INTEGER NOT NULL,
      total INTEGER NOT NULL, outside_count INTEGER NOT NULL, recognition_count INTEGER NOT NULL,
      question_count INTEGER NOT NULL DEFAULT 0,
      unanswered_count INTEGER NOT NULL DEFAULT 0,
      positive_count INTEGER NOT NULL DEFAULT 0,
      intensity_count INTEGER NOT NULL DEFAULT 0,
      response_deltas TEXT NOT NULL DEFAULT '[]',
      activity_distribution TEXT NOT NULL DEFAULT '{}',
      last_sender_id TEXT,
      last_sent_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS telegram_period_authors(
      binding_id TEXT NOT NULL REFERENCES telegram_bindings(id), member_id TEXT NOT NULL,
      count INTEGER NOT NULL, PRIMARY KEY(binding_id,member_id)
    );
    CREATE TABLE IF NOT EXISTS telegram_closed_periods(
      binding_id TEXT NOT NULL REFERENCES telegram_bindings(id), period_id TEXT NOT NULL,
      start_at INTEGER NOT NULL, closed_at INTEGER NOT NULL, local_date TEXT NOT NULL, revision INTEGER NOT NULL,
      profile_version INTEGER NOT NULL, status TEXT NOT NULL, metrics TEXT,
      expires INTEGER NOT NULL, extended_metrics TEXT, PRIMARY KEY(binding_id,period_id)
    );
    CREATE TABLE IF NOT EXISTS telegram_close_requests(
      binding_id TEXT NOT NULL REFERENCES telegram_bindings(id), actor_key TEXT NOT NULL,
      request_id TEXT NOT NULL, digest TEXT NOT NULL, period_id TEXT NOT NULL,
      response_status TEXT NOT NULL, expires INTEGER NOT NULL,
      PRIMARY KEY(binding_id,actor_key,request_id)
    );
    CREATE TABLE IF NOT EXISTS telegram_profiles(
      workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id), version INTEGER NOT NULL,
      time_zone TEXT, intervals TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS telegram_notification_subscriptions(
      workspace_id TEXT NOT NULL, member_id TEXT NOT NULL, telegram_user_id TEXT NOT NULL,
      chat_id TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY(workspace_id,member_id), UNIQUE(workspace_id,telegram_user_id),
      FOREIGN KEY(workspace_id,member_id) REFERENCES members(workspace_id,id)
    );
    CREATE TABLE IF NOT EXISTS telegram_notification_deliveries(
      binding_id TEXT NOT NULL REFERENCES telegram_bindings(id), period_id TEXT NOT NULL,
      member_id TEXT NOT NULL REFERENCES members(id), status TEXT NOT NULL
        CHECK(status IN ('sending','pending','sent')),
      updated_at INTEGER NOT NULL, expires INTEGER NOT NULL,
      PRIMARY KEY(binding_id,period_id,member_id)
    );
    CREATE TABLE IF NOT EXISTS telegram_profile_requests(
      workspace_id TEXT NOT NULL REFERENCES workspaces(id), member_id TEXT NOT NULL,
      request_id TEXT NOT NULL, digest TEXT NOT NULL, response TEXT NOT NULL, expires INTEGER NOT NULL,
      PRIMARY KEY(workspace_id,member_id,request_id)
    );
    CREATE TABLE IF NOT EXISTS telegram_chat_actions(
      id TEXT PRIMARY KEY, binding_id TEXT NOT NULL REFERENCES telegram_bindings(id),
      workspace_id TEXT NOT NULL REFERENCES workspaces(id), period_id TEXT NOT NULL,
      profile_version INTEGER NOT NULL, revision INTEGER NOT NULL,
      recommendation_id TEXT NOT NULL, action TEXT NOT NULL,
      actor_id TEXT NOT NULL, request_id TEXT NOT NULL, digest TEXT NOT NULL,
      expires INTEGER NOT NULL,
      UNIQUE(binding_id,period_id), UNIQUE(binding_id,actor_id,request_id)
    );
    CREATE TABLE IF NOT EXISTS telegram_feedback_collections(
      binding_id TEXT NOT NULL REFERENCES telegram_bindings(id), period_id TEXT NOT NULL,
      kind TEXT NOT NULL, profile_version INTEGER NOT NULL, revision INTEGER NOT NULL,
      closed INTEGER NOT NULL DEFAULT 0, counts TEXT,
      close_request_id TEXT, close_digest TEXT, expires INTEGER NOT NULL,
      PRIMARY KEY(binding_id,period_id,kind)
    );
    CREATE TABLE IF NOT EXISTS telegram_feedback_votes(
      binding_id TEXT NOT NULL, period_id TEXT NOT NULL, kind TEXT NOT NULL,
      member_id TEXT NOT NULL, value TEXT NOT NULL,
      PRIMARY KEY(binding_id,period_id,kind,member_id)
    );
    CREATE TABLE IF NOT EXISTS telegram_feedback_requests(
      binding_id TEXT NOT NULL, period_id TEXT NOT NULL, kind TEXT NOT NULL,
      member_id TEXT NOT NULL, request_id TEXT NOT NULL, digest TEXT NOT NULL,
      expires INTEGER NOT NULL,
      PRIMARY KEY(binding_id,period_id,kind,member_id,request_id)
    );
    CREATE TABLE IF NOT EXISTS telegram_transcription_jobs(
      binding_id TEXT NOT NULL REFERENCES telegram_bindings(id), job_id TEXT NOT NULL,
      chat_id TEXT NOT NULL, media_message_id TEXT NOT NULL, sender_id TEXT NOT NULL,
      sent_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('queued','accepted')),
      digest TEXT NOT NULL, expires INTEGER NOT NULL,
      PRIMARY KEY(binding_id,job_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS telegram_transcription_media
      ON telegram_transcription_jobs(binding_id,chat_id,media_message_id);
    CREATE TABLE IF NOT EXISTS telegram_transcription_texts(
      binding_id TEXT NOT NULL REFERENCES telegram_bindings(id), job_id TEXT NOT NULL,
      text TEXT NOT NULL, expires INTEGER NOT NULL,
      PRIMARY KEY(binding_id,job_id)
    );
    CREATE TABLE IF NOT EXISTS telegram_transcription_requests(
      binding_id TEXT NOT NULL REFERENCES telegram_bindings(id), request_id TEXT NOT NULL,
      digest TEXT NOT NULL, response TEXT NOT NULL, expires INTEGER NOT NULL,
      PRIMARY KEY(binding_id,request_id)
    );
  `)
  db.exec('BEGIN IMMEDIATE')
  try {
    const bindingColumns = db.prepare('PRAGMA table_info(telegram_bindings)').all()
    if (!bindingColumns.some(column => column.name === 'migration_blocked')) {
      db.exec('ALTER TABLE telegram_bindings ADD COLUMN migration_blocked INTEGER NOT NULL DEFAULT 0')
    }
    const openCols = db.prepare('PRAGMA table_info(telegram_open_periods)').all().map(column => column.name)
    if (!openCols.includes('question_count')) {
      db.exec(`
        ALTER TABLE telegram_open_periods ADD COLUMN question_count INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE telegram_open_periods ADD COLUMN unanswered_count INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE telegram_open_periods ADD COLUMN positive_count INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE telegram_open_periods ADD COLUMN intensity_count INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE telegram_open_periods ADD COLUMN response_deltas TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE telegram_open_periods ADD COLUMN activity_distribution TEXT NOT NULL DEFAULT '{}';
        ALTER TABLE telegram_open_periods ADD COLUMN last_sender_id TEXT;
        ALTER TABLE telegram_open_periods ADD COLUMN last_sent_at INTEGER;
      `)
    }
    const closedCols = db.prepare('PRAGMA table_info(telegram_closed_periods)').all().map(column => column.name)
    if (!closedCols.includes('extended_metrics')) {
      db.exec('ALTER TABLE telegram_closed_periods ADD COLUMN extended_metrics TEXT')
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  const one = (sql, ...args) => db.prepare(sql).get(...args)
  const all = (sql, ...args) => db.prepare(sql).all(...args)
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
  const purgeText = bindingId => {
    run('DELETE FROM telegram_texts WHERE binding_id=?', bindingId)
    run('DELETE FROM telegram_media_observations WHERE binding_id=?', bindingId)
    run('DELETE FROM telegram_transcription_texts WHERE binding_id=?', bindingId)
  }
  const clearOpenPeriod = bindingId => {
    run('DELETE FROM telegram_period_authors WHERE binding_id=?', bindingId)
    run('DELETE FROM telegram_open_periods WHERE binding_id=?', bindingId)
  }
  const clearDerived = bindingId => {
    clearOpenPeriod(bindingId)
    run('DELETE FROM telegram_closed_periods WHERE binding_id=?', bindingId)
    run('DELETE FROM telegram_chat_actions WHERE binding_id=?', bindingId)
    run('DELETE FROM telegram_feedback_votes WHERE binding_id=?', bindingId)
    run('DELETE FROM telegram_feedback_requests WHERE binding_id=?', bindingId)
    run('DELETE FROM telegram_feedback_collections WHERE binding_id=?', bindingId)
  }
  const localParts = (millis, timeZone) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(millis)).map(part => [part.type, part.value]))
    return { date: `${parts.year}-${parts.month}-${parts.day}`,
      day: { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[parts.weekday],
      minute: Number(parts.hour) * 60 + Number(parts.minute) }
  }
  const outsideHours = (millis, profile) => {
    const local = localParts(millis, profile.timeZone)
    return !profile.intervals.some(interval => interval.day === local.day
      && local.minute >= interval.start && local.minute < interval.end)
  }
  const profileFor = workspaceId => {
    const saved = one('SELECT * FROM telegram_profiles WHERE workspace_id=?', workspaceId)
    return saved ? { version: saved.version, timeZone: saved.time_zone, intervals: JSON.parse(saved.intervals) }
      : { version: 0, timeZone: null, intervals: [] }
  }
  const hasSchedule = profile => Boolean(profile.timeZone && profile.intervals.length)
  const recognition = text => Array.from(text.toLowerCase().matchAll(/\p{L}+/gu), match => match[0])
      .some(word => ['спасибо', 'благодарю', 'благодарим', 'thanks'].includes(word))
  const periodView = row => {
    if (row.status !== 'valid') return { status: 'insufficient' }
    const dates = one("SELECT COUNT(DISTINCT local_date) AS n FROM telegram_closed_periods WHERE binding_id=? AND profile_version=? AND revision=? AND status='valid' AND expires>?",
      row.binding_id, row.profile_version, row.revision, now()).n
    if (dates < 3) return { status: 'calibrating' }
    let extendedMetrics = undefined
    if (row.extended_metrics) {
      try {
        extendedMetrics = JSON.parse(row.extended_metrics)
      } catch {}
    }
    return { status: 'published', demo: true,
      period: { id: row.period_id, start: new Date(row.start_at).toISOString(), end: new Date(row.closed_at).toISOString() },
      dataSource: 'chat', profileVersion: row.profile_version, metrics: JSON.parse(row.metrics),
      ...(extendedMetrics ? { extendedMetrics } : {}),
      recognitionMethod: 'lexicon-v1', comparison: null }
  }
  const publishedPeriod = (actor, id, periodId, linkedMember = false,
    expectedRevision, expectedProfileVersion) => {
    const binding = linkedMember
      ? one('SELECT * FROM telegram_bindings WHERE id=? AND workspace_id=?', id, actor.workspace_id)
      : bindingFor(actor, id)
    if (!binding) fail(404, 'NOT_FOUND', 'Привязка не найдена')
    const state = JSON.parse(binding.state)
    if (linkedMember && (actor.kind || !state.roster.includes(actor.id)
      || state.decisions[actor.id] !== 'accepted'
      || !one('SELECT 1 FROM telegram_links WHERE binding_id=? AND workspace_id=? AND member_id=?', id, actor.workspace_id, actor.id))) {
      fail(403, 'FORBIDDEN', 'Нужна подтверждённая связь участника')
    }
    if (!canProcessChat(state) || (binding.evidence_expires !== null && binding.evidence_expires <= now())) {
      fail(409, 'CONSENT_REQUIRED', 'Чат не активен')
    }
    if (expectedRevision !== undefined && state.revision !== expectedRevision) {
      fail(409, 'STALE_REVISION', 'Версия изменилась')
    }
    const profile = profileFor(actor.workspace_id)
    if (expectedProfileVersion !== undefined && profile.version !== expectedProfileVersion) {
      fail(409, 'STALE_PERIOD', 'Версия профиля изменилась')
    }
    if (!hasSchedule(profile) || one('SELECT 1 FROM telegram_open_periods WHERE binding_id=?', id)) {
      fail(409, 'STALE_PERIOD', 'Период не опубликован')
    }
    const row = one('SELECT * FROM telegram_closed_periods WHERE binding_id=? AND revision=? AND profile_version=? AND expires>? ORDER BY closed_at DESC,rowid DESC LIMIT 1',
      id, state.revision, profile.version, now())
    if (!row || row.period_id !== periodId || periodView(row).status !== 'published') {
      fail(409, 'STALE_PERIOD', 'Период не опубликован')
    }
    return { row, state, profile }
  }
  const cardIdentity = (id, row) =>
    ({ id: digest(`recommendation:${id}:${row.period_id}:${row.revision}:${row.profile_version}`),
      periodId: row.period_id, profileVersion: row.profile_version,
      dataSource: 'chat', source: 'template', demo: true })
  const feedbackKinds = { interpretation: ['useful', 'incorrect', 'usual_joke'], outcome: ['helped', 'not_helped'] }
  const feedbackTarget = (id, row, kind) => {
    if (!Object.hasOwn(feedbackKinds, kind)) invalid()
    if (kind === 'interpretation') return cardIdentity(id, row).id
    const action = one('SELECT id FROM telegram_chat_actions WHERE binding_id=? AND period_id=? AND expires>?',
      id, row.period_id, now())
    if (!action) fail(409, 'STALE_PERIOD', 'Шаг ещё не подтверждён')
    return action.id
  }
  const feedbackView = (kind, collection) => {
    if (!collection?.closed) return { status: 'collecting' }
    if (!collection.counts) return { status: 'insufficient' }
    const counts = JSON.parse(collection.counts)
    return { status: 'published', demo: true, kind, total: Object.values(counts).reduce((a, b) => a + b, 0), counts }
  }
  // Бот читает сводку и карточку только для организатора, чей Telegram связан с привязкой.
  const linkedOrganizer = (actor, id, telegramUserId) => {
    if (!telegramId(telegramUserId)) invalid()
    bindingFor(actor, id)
    if (actor.kind !== 'bot') fail(403, 'FORBIDDEN', 'Нужен scoped credential бота')
    const member = one(`SELECT m.id,m.role FROM telegram_links l
      JOIN members m ON m.workspace_id=l.workspace_id AND m.id=l.member_id
      WHERE l.binding_id=? AND l.workspace_id=? AND l.telegram_user_id=?`,
      id, actor.workspace_id, telegramUserId)
    if (!member || member.role !== 'organizer') {
      fail(403, 'ORGANIZER_REQUIRED', 'Доступно только связанному организатору')
    }
    return member
  }
  const expireBinding = binding => {
    if (binding.evidence_expires === null || binding.evidence_expires > now()) return binding
    const state = JSON.parse(binding.state)
    state.decisions = {}
    state.companyAccepted = false
    if (state.phase !== 'disconnected') state.phase = 'paused'
    state.revision++
    run('UPDATE telegram_bindings SET state=?,evidence_expires=NULL WHERE id=?', JSON.stringify(state), binding.id)
    purgeText(binding.id)
    clearDerived(binding.id)
    return { ...binding, state: JSON.stringify(state), evidence_expires: null }
  }
  const cleanup = () => tx(() => {
    const time = now()
    run('DELETE FROM telegram_requests WHERE expires<=?', time)
    run('DELETE FROM telegram_link_tokens WHERE expires<=?', time - DAY)
    run('DELETE FROM telegram_binding_tokens WHERE expires<=?', time - DAY)
    run('DELETE FROM telegram_binding_requests WHERE expires<=?', time)
    run('DELETE FROM telegram_identity_requests WHERE expires<=?', time)
    run('DELETE FROM telegram_checkins WHERE expires<=?', time)
    run('DELETE FROM telegram_texts WHERE expires<=?', time)
    run('DELETE FROM telegram_media_observations WHERE expires<=?', time)
    run('DELETE FROM telegram_event_ids WHERE expires<=?', time)
    run('DELETE FROM telegram_message_ids WHERE expires<=?', time)
    run('DELETE FROM telegram_closed_periods WHERE expires<=?', time)
    run('DELETE FROM telegram_notification_deliveries WHERE expires<=?', time)
    run('DELETE FROM telegram_chat_actions WHERE expires<=?', time)
    run('DELETE FROM telegram_feedback_votes WHERE (binding_id,period_id,kind) IN (SELECT binding_id,period_id,kind FROM telegram_feedback_collections WHERE expires<=?)', time)
    run('DELETE FROM telegram_feedback_collections WHERE expires<=?', time)
    run('DELETE FROM telegram_feedback_requests WHERE expires<=?', time)
    run('DELETE FROM telegram_close_requests WHERE expires<=?', time)
    run('DELETE FROM telegram_profile_requests WHERE expires<=?', time)
    run('DELETE FROM telegram_transcription_texts WHERE expires<=?', time)
    run('DELETE FROM telegram_transcription_requests WHERE expires<=?', time)
    run('DELETE FROM telegram_transcription_jobs WHERE expires<=?', time)
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
      pause: { reason: v => ['unknown_member', 'transport_gap', 'chat_migration', 'message_edit', 'manual'].includes(v) },
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
  const organizerProfile = actor => {
    if (!actor || actor.kind === 'bot' || actor.kind === 'bootstrap' || actor.role !== 'organizer') {
      fail(403, 'FORBIDDEN', 'Нужны права организатора')
    }
    return profileFor(actor.workspace_id)
  }
  const validatedProfile = input => {
    if (!input || Array.isArray(input) || typeof input !== 'object'
      || Object.keys(input).length !== 4 || !uuid(input.requestId) || !revision(input.expectedVersion)
      || !Array.isArray(input.intervals) || input.intervals.length > MAX_INTERVALS
      || !(input.timeZone === null || typeof input.timeZone === 'string')) invalid()
    let timeZone = input.timeZone
    if (timeZone !== null) {
      if (!timeZone || timeZone.length > 100 || timeZone !== timeZone.trim()) invalid()
      try { timeZone = new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone }
      catch { invalid() }
    }
    if (timeZone === null && input.intervals.length) invalid()
    const intervals = input.intervals.map(interval => {
      if (!interval || Array.isArray(interval) || typeof interval !== 'object'
        || Object.keys(interval).length !== 3 || !Number.isInteger(interval.day)
        || interval.day < 1 || interval.day > 7 || !Number.isInteger(interval.start)
        || !Number.isInteger(interval.end) || interval.start < 0 || interval.end > 1440
        || interval.start >= interval.end) invalid()
      return { day: interval.day, start: interval.start, end: interval.end }
    }).sort((a, b) => a.day - b.day || a.start - b.start)
    for (let i = 1; i < intervals.length; i++) {
      if (intervals[i].day === intervals[i - 1].day && intervals[i].start < intervals[i - 1].end) invalid()
    }
    return { timeZone, intervals }
  }

  return {
    cleanup,
    profile(actor) {
      return organizerProfile(actor)
    },
    updateProfile(actor, input) {
      organizerProfile(actor)
      const next = validatedProfile(input)
      return tx(() => {
        const current = organizerProfile(actor)
        const requestDigest = digest(canonical({ operation: 'profile', input }))
        const previous = one('SELECT * FROM telegram_profile_requests WHERE workspace_id=? AND member_id=? AND request_id=?',
          actor.workspace_id, actor.id, input.requestId)
        if (previous) {
          if (previous.digest !== requestDigest) fail(409, 'EVENT_CONFLICT', 'Идентификатор запроса уже использован')
          return JSON.parse(previous.response)
        }
        if (input.expectedVersion !== current.version) fail(409, 'STALE_REVISION', 'Версия профиля изменилась')
        const historical = one(`SELECT MAX(version) AS version FROM (
          SELECT profile_version AS version FROM telegram_open_periods JOIN telegram_bindings ON binding_id=id WHERE workspace_id=?
          UNION ALL SELECT profile_version AS version FROM telegram_closed_periods JOIN telegram_bindings ON binding_id=id WHERE workspace_id=?
        )`, actor.workspace_id, actor.workspace_id)?.version ?? 0
        const response = { version: Math.max(current.version, historical) + 1, ...next }
        run('INSERT INTO telegram_profiles VALUES(?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET version=excluded.version,time_zone=excluded.time_zone,intervals=excluded.intervals',
          actor.workspace_id, response.version, response.timeZone, JSON.stringify(response.intervals))
        for (const binding of db.prepare('SELECT id FROM telegram_bindings WHERE workspace_id=?').all(actor.workspace_id)) {
          purgeText(binding.id)
          clearDerived(binding.id)
        }
        run('INSERT INTO telegram_profile_requests VALUES(?,?,?,?,?,?)', actor.workspace_id, actor.id,
          input.requestId, requestDigest, JSON.stringify(response), now() + DAY)
        return response
      })
    },
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
    subscribeNotifications(actor, id, input) {
      unavailable()
      if (!input || Array.isArray(input) || typeof input !== 'object'
        || Object.keys(input).length !== 2 || !telegramId(input.telegramUserId)
        || input.chatId !== input.telegramUserId) invalid()
      return tx(() => {
        bindingFor(actor, id)
        if (actor.kind !== 'bot') fail(403, 'FORBIDDEN', 'Нужен scoped credential бота')
        const member = one(`SELECT m.id,m.role FROM telegram_links l
          JOIN members m ON m.workspace_id=l.workspace_id AND m.id=l.member_id
          WHERE l.binding_id=? AND l.workspace_id=? AND l.telegram_user_id=?`,
          id, actor.workspace_id, input.telegramUserId)
        if (!member || member.role !== 'organizer') {
          fail(403, 'ORGANIZER_REQUIRED', 'Уведомления доступны только связанному организатору')
        }
        const existing = one(`SELECT member_id FROM telegram_notification_subscriptions
          WHERE workspace_id=? AND telegram_user_id=?`, actor.workspace_id, input.telegramUserId)
        if (existing && existing.member_id !== member.id) {
          fail(409, 'SUBSCRIPTION_CONFLICT', 'Этот Telegram-аккаунт связан с другим организатором')
        }
        run(`INSERT INTO telegram_notification_subscriptions
          (workspace_id,member_id,telegram_user_id,chat_id,created_at) VALUES(?,?,?,?,?)
          ON CONFLICT(workspace_id,member_id) DO UPDATE SET
          telegram_user_id=excluded.telegram_user_id,chat_id=excluded.chat_id,created_at=excluded.created_at`,
          actor.workspace_id, member.id, input.telegramUserId, input.chatId, now())
        return { subscribed: true }
      })
    },
    acceptCheckin(actor, id, input) {
      unavailable()
      // Анонимный личный чек-ин: telegramUserId служит только для проверки,
      // что участник находится в привязке (ростере), и НЕ сохраняется в БД.
      if (!input || Array.isArray(input) || typeof input !== 'object'
        || Object.keys(input).length !== 4 || !telegramId(input.telegramUserId)
        || !/^[a-f0-9]{16}$/.test(input.nonce) || !utcTime(input.submittedAt)
        || !input.scores || Array.isArray(input.scores)
        || Object.keys(input.scores).length !== 3
        || Object.keys(input.scores).some(key => !['energy', 'clarity', 'support'].includes(key))
        || Object.values(input.scores).some(value => !Number.isSafeInteger(value) || value < 1 || value > 5)) invalid()
      return tx(() => {
        const binding = bindingFor(actor, id)
        if (actor.kind !== 'bot') fail(403, 'FORBIDDEN', 'Нужен scoped credential бота')
        const state = JSON.parse(binding.state)
        if (!canProcessChat(state)) fail(409, 'CONSENT_REQUIRED', 'Чат не активен')
        const age = now() - Date.parse(input.submittedAt)
        if (age > 60000 || age < -30000) fail(400, 'INVALID_INPUT', 'Событие вне допустимого окна')
        const member = one('SELECT member_id FROM telegram_links WHERE binding_id=? AND workspace_id=? AND telegram_user_id=?',
          id, actor.workspace_id, input.telegramUserId)?.member_id
        if (!member) fail(403, 'FORBIDDEN', 'Участник не связан с этой командой')
        // Идемпотентность: digest включает telegramUserId, поэтому повторная отправка
        // тем же участником с тем же nonce распознаётся, а подмена — отклоняется.
        const contentDigest = digest(canonical({ nonce: input.nonce, scores: input.scores, telegramUserId: input.telegramUserId }))
        const seen = one('SELECT digest FROM telegram_checkins WHERE binding_id=? AND nonce=?', id, input.nonce)
        if (seen && seen.digest !== contentDigest) fail(409, 'EVENT_CONFLICT', 'Чек-ин уже использован с другим содержимым')
        if (seen) return { accepted: true, duplicate: true }
        run('INSERT INTO telegram_checkins(binding_id,nonce,digest,energy,clarity,support,created_at,expires) VALUES(?,?,?,?,?,?,?,?)',
          id, input.nonce, contentDigest, input.scores.energy, input.scores.clarity, input.scores.support,
          now(), now() + 30 * DAY)
        return { accepted: true, duplicate: false }
      })
    },
    claimOrganizerNotification(actor, id, periodId) {
      unavailable()
      return tx(() => {
        organizerProfile(actor)
        const { row } = publishedPeriod(actor, id, periodId)
        const subscription = one(`SELECT s.chat_id FROM telegram_notification_subscriptions s
          JOIN members m ON m.workspace_id=s.workspace_id AND m.id=s.member_id
          JOIN telegram_links l ON l.workspace_id=s.workspace_id AND l.member_id=s.member_id
            AND l.telegram_user_id=s.telegram_user_id
          WHERE s.workspace_id=? AND s.member_id=? AND m.role='organizer' AND l.binding_id=?`,
          actor.workspace_id, actor.id, id)
        if (!subscription) return null
        const delivery = one(`SELECT status,updated_at FROM telegram_notification_deliveries
          WHERE binding_id=? AND period_id=? AND member_id=?`, id, periodId, actor.id)
        if (delivery?.status === 'sent' || (delivery?.status === 'sending' && delivery.updated_at > now() - 30000)) {
          return null
        }
        run(`INSERT INTO telegram_notification_deliveries
          (binding_id,period_id,member_id,status,updated_at,expires) VALUES(?,?,?,'sending',?,?)
          ON CONFLICT(binding_id,period_id,member_id) DO UPDATE SET
          status='sending',updated_at=excluded.updated_at,expires=excluded.expires`,
          id, periodId, actor.id, now(), row.expires)
        return { chatId: subscription.chat_id, metrics: JSON.parse(row.metrics) }
      })
    },
    completeOrganizerNotification(actor, id, periodId, delivered) {
      if (typeof delivered !== 'boolean') invalid()
      unavailable()
      organizerProfile(actor)
      bindingFor(actor, id)
      run(`UPDATE telegram_notification_deliveries SET status=?,updated_at=?
        WHERE binding_id=? AND period_id=? AND member_id=? AND status='sending'`,
        delivered ? 'sent' : 'pending', now(), id, periodId, actor.id)
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
        const profile = profileFor(actor.workspace_id)
        const open = hasSchedule(profile) && one('SELECT * FROM telegram_open_periods WHERE binding_id=?', id)
        if (open && (open.revision !== state.revision || open.profile_version !== profile.version
          || now() - open.opened_at >= DAY)) {
          fail(409, 'STALE_PERIOD', 'Незакрытый период устарел')
        }
        run('INSERT INTO telegram_event_ids VALUES(?,?,?,?)', id, input.eventId, contentDigest, now() + DAY)
        run('INSERT INTO telegram_message_ids VALUES(?,?,?,?,?)', id, input.chatId, input.messageId, contentDigest, now() + DAY)
        run('INSERT INTO telegram_texts VALUES(?,?,?,?,?,?,?)', id, input.chatId, input.messageId,
          input.senderId, input.sentAt, input.text, now() + TEXT_TTL)
        if (hasSchedule(profile)) {
          if (!open) {
            run(`INSERT INTO telegram_open_periods
              (binding_id, opened_at, revision, profile_version, total, outside_count, recognition_count,
               question_count, unanswered_count, positive_count, intensity_count, response_deltas,
               activity_distribution, last_sender_id, last_sent_at)
              VALUES(?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, '[]', '{}', NULL, NULL)`,
              id, now(), state.revision, profile.version)
          }
          const currentOpen = one('SELECT * FROM telegram_open_periods WHERE binding_id=?', id)
          const sentAtMillis = Date.parse(input.sentAt)
          const isOutside = outsideHours(sentAtMillis, profile) ? 1 : 0
          const isRec = recognition(input.text) ? 1 : 0
          const isQ = isQuestionMessage(input.text)
          const isPos = isPositiveMessage(input.text) ? 1 : 0
          const isIntensity = isIntensityMessage(input.text) ? 1 : 0

          let deltas = []
          try { deltas = JSON.parse(currentOpen.response_deltas || '[]') } catch {}

          let unansweredCount = currentOpen.unanswered_count || 0
          const questionCount = (currentOpen.question_count || 0) + (isQ ? 1 : 0)

          if (currentOpen.last_sender_id && currentOpen.last_sender_id !== input.senderId && currentOpen.last_sent_at) {
            const deltaSeconds = Math.max(0, Math.round((sentAtMillis - currentOpen.last_sent_at) / 1000))
            if (deltaSeconds <= 86400) {
              deltas.push(deltaSeconds)
              if (unansweredCount > 0) {
                unansweredCount = Math.max(0, unansweredCount - 1)
              }
            }
          }

          if (isQ) {
            unansweredCount += 1
          }

          let actDist = {}
          try { actDist = JSON.parse(currentOpen.activity_distribution || '{}') } catch {}
          actDist = recordActivity(actDist, input.sentAt, profile.timeZone)

          run(`UPDATE telegram_open_periods SET
            total = total + 1,
            outside_count = outside_count + ?,
            recognition_count = recognition_count + ?,
            question_count = ?,
            unanswered_count = ?,
            positive_count = positive_count + ?,
            intensity_count = intensity_count + ?,
            response_deltas = ?,
            activity_distribution = ?,
            last_sender_id = ?,
            last_sent_at = ?
            WHERE binding_id = ?`,
            isOutside, isRec, questionCount, unansweredCount, isPos, isIntensity,
            JSON.stringify(deltas), JSON.stringify(actDist), input.senderId, sentAtMillis, id)
          run('INSERT INTO telegram_period_authors VALUES(?,?,1) ON CONFLICT(binding_id,member_id) DO UPDATE SET count=count+1', id, member)
        }
        return { eventId: input.eventId, result: 'accepted', revision: state.revision }
      })
    },
    acceptMedia(actor, id, input) {
      unavailable()
      if (!input || Array.isArray(input) || typeof input !== 'object'
        || Object.keys(input).length !== 7 || !uuid(input.eventId) || !revision(input.expectedRevision)
        || !chatId(input.chatId) || !messageId(input.messageId) || !telegramId(input.senderId)
        || !utcTime(input.sentAt) || !input.media || Array.isArray(input.media)
        || typeof input.media !== 'object') invalid()
      const media = input.media
      const kind = media.kind
      const document = kind === 'document'
      if (!['voice', 'video_note', 'document'].includes(kind)
        || Object.keys(media).length !== (document ? (Object.hasOwn(media, 'caption') ? 4 : 3) : 4)
        || !Number.isSafeInteger(media.fileSize) || media.fileSize < 1
        || (document && !['application/pdf', 'text/plain'].includes(media.mimeType))
        || (kind === 'voice' && media.mimeType !== 'audio/ogg')
        || (kind === 'video_note' && media.mimeType !== 'video/mp4')
        || (document && Object.hasOwn(media, 'durationSeconds'))
        || (!document && (!Number.isSafeInteger(media.durationSeconds) || media.durationSeconds < 1))
        || (document && Object.hasOwn(media, 'caption')
          && (typeof media.caption !== 'string' || !media.caption.trim() || Array.from(media.caption).length > 1024))) invalid()
      if (media.fileSize > (kind === 'video_note' ? 20 : 10) * 1048576) fail(413, 'TOO_LARGE', 'Медиа превышает лимит')
      if (!document && media.durationSeconds > (kind === 'voice' ? 120 : 60)) invalid()
      return tx(() => {
        const binding = bindingFor(actor, id)
        if (actor.kind !== 'bot') fail(403, 'FORBIDDEN', 'Нужен scoped credential бота')
        if (binding.chat_id !== input.chatId) fail(404, 'NOT_FOUND', 'Чат не найден')
        const state = JSON.parse(binding.state)
        if (input.expectedRevision !== state.revision) fail(409, 'STALE_REVISION', 'Версия изменилась')
        if (state.policyVersion !== MEDIA_POLICY_VERSION || !canProcessChat(state)
          || (binding.evidence_expires !== null && binding.evidence_expires <= now())) {
          fail(409, 'CONSENT_REQUIRED', 'Для медиа нужно актуальное полное согласие')
        }
        const age = now() - Date.parse(input.sentAt)
        if (age > 60000 || age < -30000) invalid()
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
          senderId: input.senderId, sentAt: input.sentAt, media }))
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
        run('INSERT INTO telegram_event_ids VALUES(?,?,?,?)', id, input.eventId, contentDigest, now() + DAY)
        run('INSERT INTO telegram_message_ids VALUES(?,?,?,?,?)', id, input.chatId, input.messageId, contentDigest, now() + DAY)
        run('INSERT INTO telegram_media_observations VALUES(?,?,?,?,?,?,?)', id, input.chatId,
          input.messageId, input.senderId, input.sentAt, JSON.stringify(media), now() + TEXT_TTL)
        return { eventId: input.eventId, result: 'accepted', revision: state.revision }
      })
    },
    createTranscriptionJob(actor, id, input) {
      unavailable()
      if (!input || Array.isArray(input) || typeof input !== 'object'
        || Object.keys(input).length !== 6 || !uuid(input.requestId) || !revision(input.expectedRevision)
        || !chatId(input.chatId) || !messageId(input.mediaMessageId) || !telegramId(input.senderId)
        || !utcTime(input.sentAt)) invalid()
      return tx(() => {
        const binding = bindingFor(actor, id)
        if (actor.kind !== 'bot') fail(403, 'FORBIDDEN', 'Нужен scoped credential бота')
        if (binding.chat_id !== input.chatId) fail(404, 'NOT_FOUND', 'Чат не найден')
        const state = JSON.parse(binding.state)
        if (input.expectedRevision !== state.revision) fail(409, 'STALE_REVISION', 'Версия изменилась')
        if (state.policyVersion !== TRANSCRIPTION_POLICY_VERSION || !canProcessChat(state)
          || (binding.evidence_expires !== null && binding.evidence_expires <= now())) {
          fail(409, 'CONSENT_REQUIRED', 'Для расшифровки нужно актуальное полное согласие')
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
          return { result: 'paused', revision: paused.revision }
        }
        const requestDigest = digest(canonical({ operation: 'transcriptionJob', input }))
        const previous = one('SELECT * FROM telegram_transcription_requests WHERE binding_id=? AND request_id=?',
          id, input.requestId)
        if (previous) {
          if (previous.digest !== requestDigest) fail(409, 'EVENT_CONFLICT', 'Идентификатор запроса уже использован')
          return JSON.parse(previous.response)
        }
        const contentDigest = digest(canonical({ chatId: input.chatId, mediaMessageId: input.mediaMessageId,
          senderId: input.senderId, sentAt: input.sentAt }))
        const existing = one('SELECT * FROM telegram_transcription_jobs WHERE binding_id=? AND chat_id=? AND media_message_id=?',
          id, input.chatId, input.mediaMessageId)
        if (existing && existing.digest !== contentDigest) {
          fail(409, 'EVENT_CONFLICT', 'Голосовое уже использовано с другим содержимым')
        }
        if (existing) {
          const response = { jobId: existing.job_id, status: existing.status, revision: state.revision }
          run('INSERT INTO telegram_transcription_requests VALUES(?,?,?,?,?)', id, input.requestId,
            requestDigest, JSON.stringify(response), now() + DAY)
          return response
        }
        const jobId = randomUUID()
        run('INSERT INTO telegram_transcription_jobs VALUES(?,?,?,?,?,?,?,?,?)', id, jobId,
          input.chatId, input.mediaMessageId, input.senderId, input.sentAt, 'queued', contentDigest, now() + DAY)
        const response = { jobId, status: 'queued', revision: state.revision }
        run('INSERT INTO telegram_transcription_requests VALUES(?,?,?,?,?)', id, input.requestId,
          requestDigest, JSON.stringify(response), now() + DAY)
        return response
      })
    },
    submitTranscription(actor, id, input) {
      unavailable()
      if (!input || Array.isArray(input) || typeof input !== 'object'
        || Object.keys(input).length !== 5 || !uuid(input.requestId) || !revision(input.expectedRevision)
        || !uuid(input.jobId) || typeof input.text !== 'string'
        || !input.text.trim() || Array.from(input.text).length > 4096
        || !utcTime(input.sentAt)) invalid()
      return tx(() => {
        const binding = bindingFor(actor, id)
        if (actor.kind !== 'bot') fail(403, 'FORBIDDEN', 'Нужен scoped credential бота')
        const state = JSON.parse(binding.state)
        if (input.expectedRevision !== state.revision) fail(409, 'STALE_REVISION', 'Версия изменилась')
        if (state.policyVersion !== TRANSCRIPTION_POLICY_VERSION || !canProcessChat(state)
          || (binding.evidence_expires !== null && binding.evidence_expires <= now())) {
          fail(409, 'CONSENT_REQUIRED', 'Для расшифровки нужно актуальное полное согласие')
        }
        const age = now() - Date.parse(input.sentAt)
        if (age > 60000 || age < -30000) fail(400, 'INVALID_INPUT', 'Событие вне допустимого окна')
        const requestDigest = digest(canonical({ operation: 'transcription', input }))
        const previous = one('SELECT * FROM telegram_transcription_requests WHERE binding_id=? AND request_id=?',
          id, input.requestId)
        if (previous) {
          if (previous.digest !== requestDigest) fail(409, 'EVENT_CONFLICT', 'Идентификатор запроса уже использован')
          return JSON.parse(previous.response)
        }
        const job = one('SELECT * FROM telegram_transcription_jobs WHERE binding_id=? AND job_id=?', id, input.jobId)
        if (!job) fail(404, 'NOT_FOUND', 'Задача расшифровки не найдена')
        const contentDigest = digest(canonical({ jobId: input.jobId, text: input.text }))
        if (job.digest !== contentDigest && job.status === 'accepted') {
          fail(409, 'EVENT_CONFLICT', 'Задача уже использована с другим текстом')
        }
        if (job.status === 'accepted') {
          const response = { jobId: input.jobId, result: 'duplicate', revision: state.revision }
          run('INSERT INTO telegram_transcription_requests VALUES(?,?,?,?,?)', id, input.requestId,
            requestDigest, JSON.stringify(response), now() + DAY)
          return response
        }
        run('UPDATE telegram_transcription_jobs SET status=?,digest=?,expires=? WHERE binding_id=? AND job_id=?',
          'accepted', contentDigest, now() + DAY, id, input.jobId)
        run('INSERT INTO telegram_transcription_texts VALUES(?,?,?,?) ON CONFLICT(binding_id,job_id) DO UPDATE SET text=excluded.text,expires=excluded.expires',
          id, input.jobId, input.text, now() + TEXT_TTL)
        const response = { jobId: input.jobId, result: 'accepted', revision: state.revision }
        run('INSERT INTO telegram_transcription_requests VALUES(?,?,?,?,?)', id, input.requestId,
          requestDigest, JSON.stringify(response), now() + DAY)
        return response
      })
    },
    transcriptionJobStatus(actor, id, jobId) {
      unavailable()
      if (!uuid(jobId)) invalid()
      return tx(() => {
        const binding = bindingFor(actor, id)
        if (actor.kind !== 'bot') fail(403, 'FORBIDDEN', 'Нужен scoped credential бота')
        const state = JSON.parse(binding.state)
        const job = one('SELECT * FROM telegram_transcription_jobs WHERE binding_id=? AND job_id=?', id, jobId)
        if (!job) fail(404, 'NOT_FOUND', 'Задача расшифровки не найдена')
        const status = job.expires <= now() ? 'expired' : job.status
        return { jobId, status, revision: state.revision }
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
        const profile = profileFor(actor.workspace_id)
        if (!hasSchedule(profile)) return { status: 'calibrating' }
        if (one('SELECT 1 FROM telegram_open_periods WHERE binding_id=?', id)) return { status: 'open' }
        const closed = one('SELECT * FROM telegram_closed_periods WHERE binding_id=? AND revision=? AND profile_version=? AND expires>? ORDER BY closed_at DESC,rowid DESC LIMIT 1',
          id, state.revision, profile.version, now())
        return closed ? periodView(closed) : { status: 'insufficient' }
      })
    },
    history(actor, id) {
      unavailable()
      organizerProfile(actor)
      return tx(() => {
        const binding = bindingFor(actor, id)
        const state = JSON.parse(binding.state)
        const time = now()
        const window = { start: new Date(time - CLOSED_TTL).toISOString(), end: new Date(time).toISOString() }
        const empty = status => ({ status, demo: true, window, periods: [] })
        if (!canProcessChat(state)) return empty(state.phase)
        if (binding.evidence_expires !== null && binding.evidence_expires <= time) return empty('paused')
        const profile = profileFor(actor.workspace_id)
        if (!hasSchedule(profile)) return empty('calibrating')
        const rows = all('SELECT * FROM telegram_closed_periods WHERE binding_id=? AND revision=? AND profile_version=? AND expires>? AND closed_at>? AND closed_at<=? ORDER BY closed_at ASC,rowid ASC',
          id, state.revision, profile.version, time, time - CLOSED_TTL, time)
        return { status: 'active', demo: true, window, revision: state.revision, profileVersion: profile.version,
          periods: rows.map(row => ({ ...periodView(row),
            period: { id: row.period_id, start: new Date(row.start_at).toISOString(), end: new Date(row.closed_at).toISOString() } })) }
      })
    },
    summaryForOrganizer(actor, id, telegramUserId) {
      unavailable()
      linkedOrganizer(actor, id, telegramUserId)
      return this.summary(actor, id)
    },
    shareCard(actor, id, telegramUserId) {
      unavailable()
      linkedOrganizer(actor, id, telegramUserId)
      const view = this.summary(actor, id)
      if (view.status !== 'published') {
        fail(409, 'PERIOD_NOT_PUBLISHED', 'Период ещё не опубликован')
      }
      const workspace = one('SELECT name FROM workspaces WHERE id=?', actor.workspace_id)
      const profile = profileFor(actor.workspace_id)
      return {
        teamName: workspace?.name ?? null,
        demo: view.demo === true,
        periodLabel: formatSharePeriod(view.period.start, view.period.end, profile.timeZone || 'UTC'),
        period: view.period,
        metrics: view.metrics,
      }
    },
    currentSummary(actor) {
      unavailable()
      organizerProfile(actor)
      const bindings = all('SELECT * FROM telegram_bindings WHERE workspace_id=? ORDER BY rowid DESC', actor.workspace_id)
      const binding = bindings.find(item => JSON.parse(item.state).phase === 'active')
        ?? bindings.find(item => JSON.parse(item.state).phase === 'paused')
        ?? bindings[0]
      return binding
        ? { bindingId: binding.id, view: this.summary(actor, binding.id) }
        : { bindingId: null, view: { status: 'disconnected' } }
    },
    systemHealth(actor) {
      unavailable()
      organizerProfile(actor)
      return tx(() => {
        const time = now()
        const bindings = all('SELECT * FROM telegram_bindings WHERE workspace_id=? ORDER BY rowid DESC', actor.workspace_id)
        if (!bindings.length || !bindings[0].chat_id) {
          return {
            status: 'disconnected',
            botOnline: false,
            processed24h: 0,
            lastEventAt: null,
            lastError: bindings.length ? 'Чат команды не привязан' : 'Бот не подключён',
            checkedAt: new Date(time).toISOString(),
          }
        }
        const binding = bindings.find(item => JSON.parse(item.state).phase === 'active')
          ?? bindings.find(item => JSON.parse(item.state).phase === 'paused')
          ?? bindings[0]
        const state = JSON.parse(binding.state)

        const eventsCount = one(
          'SELECT count(*) AS n FROM telegram_event_ids WHERE binding_id=? AND expires > ?',
          binding.id, time
        )?.n ?? 0
        const checkinsCount = one(
          'SELECT count(*) AS n FROM telegram_checkins WHERE binding_id=? AND expires > ?',
          binding.id, time
        )?.n ?? 0
        const processed24h = eventsCount + checkinsCount

        const lastText = one('SELECT max(sent_at) AS t FROM telegram_texts WHERE binding_id=?', binding.id)?.t ?? null
        const lastCheckinTime = one('SELECT max(created_at) AS t FROM telegram_checkins WHERE binding_id=?', binding.id)?.t ?? null
        const lastCheckin = lastCheckinTime ? new Date(lastCheckinTime).toISOString() : null
        let lastEventAt = null
        if (lastText && lastCheckin) {
          lastEventAt = Date.parse(lastText) > Date.parse(lastCheckin) ? lastText : lastCheckin
        } else {
          lastEventAt = lastText || lastCheckin || null
        }

        let lastError = null
        if (binding.migration_blocked) {
          lastError = 'Миграция схемы заблокирована'
        } else if (binding.evidence_expires !== null && binding.evidence_expires <= time) {
          lastError = 'Срок действия согласия истёк'
        } else if (state.phase === 'paused') {
          const decisions = Object.values(state.decisions || {})
          const declined = decisions.some(d => d === 'declined' || d === 'withdrawn')
          if (declined) lastError = 'Участник отклонил или отозвал согласие'
          else if (!state.companyAccepted) lastError = 'Ожидается согласие компании'
          else lastError = 'Сбор сообщений приостановлен'
        } else if (state.phase === 'awaiting_consents') {
          lastError = 'Ожидаются согласия участников'
        }

        const isActive = canProcessChat(state) && !lastError
        const isRecent = lastEventAt ? (time - Date.parse(lastEventAt) <= DAY) : false
        const botOnline = isActive && (isRecent || processed24h > 0)
        const status = botOnline ? 'ok' : (lastError ? 'error' : (isActive ? 'idle' : 'offline'))

        return {
          status,
          botOnline,
          processed24h,
          lastEventAt,
          lastError,
          checkedAt: new Date(time).toISOString(),
        }
      })
    },
    async recommendation(actor, id, periodId, reauthenticate) {
      unavailable()
      if (!uuid(periodId)) invalid()
      const snapshot = tx(() => {
        const { row, state, profile } = publishedPeriod(actor, id, periodId)
        return { metrics: JSON.parse(row.metrics), revision: state.revision, profileVersion: profile.version }
      })
      const content = await recommendationProviderContent(recommendationProvider, snapshot.metrics,
        Number.isSafeInteger(recommendationTimeoutMs) && recommendationTimeoutMs > 0
          ? Math.min(recommendationTimeoutMs, 3000) : 3000)
      return tx(() => {
        const currentActor = reauthenticate()
        if (!currentActor) fail(401, 'SIGN_IN_REQUIRED', 'Войдите в пространство команды')
        const { row } = publishedPeriod(currentActor, id, periodId, false,
          snapshot.revision, snapshot.profileVersion)
        return { ...cardIdentity(id, row),
          source: recommendationProvider.source === 'ai' && content ? 'ai' : 'template',
          ...(content ?? templateRecommendationProvider.generate({ metrics: snapshot.metrics })) }
      })
    },
    confirmChatAction(actor, id, periodId, input) {
      unavailable()
      if (!input || Array.isArray(input) || typeof input !== 'object'
        || Object.keys(input).length !== 5 || !uuid(input.requestId)
        || !uuid(input.periodId) || input.periodId !== periodId || !revision(input.expectedRevision)
        || typeof input.recommendationId !== 'string' || !/^[a-f0-9]{64}$/.test(input.recommendationId)
        || typeof input.action !== 'string' || input.action !== input.action.trim()
        || input.action.length < 1 || input.action.length > 500) invalid()
      return tx(() => {
        const { row, state } = publishedPeriod(actor, id, input.periodId)
        if (input.expectedRevision !== state.revision) fail(409, 'STALE_REVISION', 'Версия изменилась')
        const card = cardIdentity(id, row)
        if (input.recommendationId !== card.id) fail(409, 'STALE_PERIOD', 'Карточка изменилась')
        const requestDigest = digest(canonical({ operation: 'chatAction', input }))
        const previous = one('SELECT * FROM telegram_chat_actions WHERE binding_id=? AND actor_id=? AND request_id=?',
          id, actor.id, input.requestId)
        if (previous) {
          if (previous.digest !== requestDigest) fail(409, 'EVENT_CONFLICT', 'Идентификатор запроса уже использован')
          return { id: previous.id, periodId: previous.period_id, profileVersion: previous.profile_version,
            dataSource: 'chat', action: previous.action, confirmed: true }
        }
        if (one('SELECT 1 FROM telegram_chat_actions WHERE binding_id=? AND period_id=?', id, input.periodId)) {
          fail(409, 'EVENT_CONFLICT', 'Шаг этого периода уже подтверждён')
        }
        const actionId = randomUUID()
        run('INSERT INTO telegram_chat_actions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', actionId, id,
          actor.workspace_id, input.periodId, row.profile_version, state.revision,
          card.id, input.action, actor.id, input.requestId, requestDigest,
          Math.min(row.expires, now() + CLOSED_TTL))
        return { id: actionId, periodId: input.periodId, profileVersion: row.profile_version,
          dataSource: 'chat', action: input.action, confirmed: true }
      })
    },
    submitChatFeedback(actor, id, periodId, kind, input) {
      unavailable()
      if (!Object.hasOwn(feedbackKinds, kind) || !uuid(periodId) || !input || Array.isArray(input)
        || typeof input !== 'object' || Object.keys(input).length !== 4
        || !uuid(input.requestId) || !revision(input.expectedRevision)
        || typeof input.value !== 'string' || !feedbackKinds[kind].includes(input.value)
        || typeof input[kind === 'interpretation' ? 'recommendationId' : 'actionId'] !== 'string'
        || Object.keys(input).some(key => !['requestId', 'expectedRevision', 'value',
          kind === 'interpretation' ? 'recommendationId' : 'actionId'].includes(key))) invalid()
      return tx(() => {
        const { row, state } = publishedPeriod(actor, id, periodId, true)
        if (input.expectedRevision !== state.revision) fail(409, 'STALE_REVISION', 'Версия изменилась')
        const targetId = feedbackTarget(id, row, kind)
        if (input[kind === 'interpretation' ? 'recommendationId' : 'actionId'] !== targetId) {
          fail(409, 'STALE_PERIOD', 'Цель отзыва изменилась')
        }
        const requestDigest = digest(canonical({ kind, periodId, input }))
        const previous = one('SELECT digest FROM telegram_feedback_requests WHERE binding_id=? AND period_id=? AND kind=? AND member_id=? AND request_id=?',
          id, periodId, kind, actor.id, input.requestId)
        if (previous) {
          if (previous.digest !== requestDigest) fail(409, 'EVENT_CONFLICT', 'Идентификатор запроса уже использован')
          return { accepted: true }
        }
        const collection = one('SELECT closed FROM telegram_feedback_collections WHERE binding_id=? AND period_id=? AND kind=?', id, periodId, kind)
        if (collection?.closed) fail(409, 'FEEDBACK_CLOSED', 'Сбор отзывов закрыт')
        if (one('SELECT 1 FROM telegram_feedback_votes WHERE binding_id=? AND period_id=? AND kind=? AND member_id=?', id, periodId, kind, actor.id)) {
          fail(409, 'EVENT_CONFLICT', 'Отзыв уже принят')
        }
        if (!collection) run('INSERT INTO telegram_feedback_collections(binding_id,period_id,kind,profile_version,revision,expires) VALUES(?,?,?,?,?,?)',
          id, periodId, kind, row.profile_version, row.revision, row.expires)
        run('INSERT INTO telegram_feedback_votes VALUES(?,?,?,?,?)', id, periodId, kind, actor.id, input.value)
        run('INSERT INTO telegram_feedback_requests VALUES(?,?,?,?,?,?,?)', id, periodId, kind, actor.id,
          input.requestId, requestDigest, Math.min(row.expires, now() + DAY))
        return { accepted: true }
      })
    },
    chatFeedback(actor, id, periodId, kind) {
      unavailable()
      if (!uuid(periodId) || !Object.hasOwn(feedbackKinds, kind)) invalid()
      return tx(() => {
        const { row } = publishedPeriod(actor, id, periodId)
        feedbackTarget(id, row, kind)
        const collection = one('SELECT * FROM telegram_feedback_collections WHERE binding_id=? AND period_id=? AND kind=?', id, periodId, kind)
        return feedbackView(kind, collection)
      })
    },
    closeChatFeedback(actor, id, periodId, kind, input) {
      unavailable()
      if (!uuid(periodId) || !Object.hasOwn(feedbackKinds, kind) || !input || Array.isArray(input)
        || typeof input !== 'object' || Object.keys(input).length !== 2
        || !uuid(input.requestId) || !revision(input.expectedRevision)) invalid()
      return tx(() => {
        const { row, state } = publishedPeriod(actor, id, periodId)
        if (input.expectedRevision !== state.revision) fail(409, 'STALE_REVISION', 'Версия изменилась')
        feedbackTarget(id, row, kind)
        const requestDigest = digest(canonical({ kind, periodId, input, operation: 'closeFeedback' }))
        const collection = one('SELECT * FROM telegram_feedback_collections WHERE binding_id=? AND period_id=? AND kind=?', id, periodId, kind)
        if (collection?.closed) {
          if (collection.close_request_id !== input.requestId || collection.close_digest !== requestDigest) {
            fail(409, 'FEEDBACK_CLOSED', 'Сбор отзывов закрыт')
          }
          return feedbackView(kind, collection)
        }
        const votes = db.prepare('SELECT value,COUNT(*) AS n FROM telegram_feedback_votes WHERE binding_id=? AND period_id=? AND kind=? GROUP BY value').all(id, periodId, kind)
        const total = votes.reduce((sum, vote) => sum + vote.n, 0)
        const counts = total >= 5 ? Object.fromEntries(feedbackKinds[kind].map(value => [value, votes.find(vote => vote.value === value)?.n ?? 0])) : null
        if (!collection) run('INSERT INTO telegram_feedback_collections(binding_id,period_id,kind,profile_version,revision,expires) VALUES(?,?,?,?,?,?)',
          id, periodId, kind, row.profile_version, row.revision, row.expires)
        run('UPDATE telegram_feedback_collections SET closed=1,counts=?,close_request_id=?,close_digest=? WHERE binding_id=? AND period_id=? AND kind=?',
          counts && JSON.stringify(counts), input.requestId, requestDigest, id, periodId, kind)
        run('DELETE FROM telegram_feedback_votes WHERE binding_id=? AND period_id=? AND kind=?', id, periodId, kind)
        return counts ? { status: 'published', demo: true, kind, total, counts } : { status: 'insufficient' }
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
        const profile = profileFor(actor.workspace_id)
        if (!hasSchedule(profile)) fail(409, 'STALE_PERIOD', 'Расписание не задано')
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
        if (!open || open.revision !== state.revision || open.profile_version !== profile.version) {
          fail(409, 'STALE_PERIOD', 'Нет актуального открытого периода')
        }
        const authors = db.prepare('SELECT count FROM telegram_period_authors WHERE binding_id=?').all(id)
        const valid = authors.length >= 5 && open.total >= 20 && now() - open.opened_at <= DAY
        let metrics = null
        let extendedMetrics = null
        if (valid) {
          const authorMessageCounts = authors.map(row => row.count)
          metrics = {
            outsideHoursPercent: calculateOutsideHoursPercent(open.outside_count, open.total),
            participationEvenness: calculateParticipationEvenness(
              authorMessageCounts, state.roster.length, open.total),
            recognitionPercent: calculateRecognitionPercent(open.recognition_count, open.total),
          }
          const unansweredQuestionsPercent = calculateUnansweredQuestionsPercent(open.unanswered_count || 0, open.question_count || 0)
          let responseDeltas = []
          try { responseDeltas = JSON.parse(open.response_deltas || '[]') } catch {}
          const responseMedianMinutes = calculateResponseMedianMinutes(responseDeltas)
          const positivityIndex = calculatePositivityIndex(open.positive_count || 0, open.total)
          const intensityIndex = calculateIntensityIndex(open.intensity_count || 0, open.total)
          let activityDist = {}
          try { activityDist = JSON.parse(open.activity_distribution || '{}') } catch {}

          const prevRow = one('SELECT metrics, extended_metrics FROM telegram_closed_periods WHERE binding_id=? AND status=? AND period_id!=? ORDER BY closed_at DESC LIMIT 1',
            id, 'valid', input.periodId)
          let trends = null
          if (prevRow) {
            let prevMetrics = null
            let prevExtended = null
            try { prevMetrics = JSON.parse(prevRow.metrics || '{}') } catch {}
            try { prevExtended = JSON.parse(prevRow.extended_metrics || '{}') } catch {}
            const currentCombined = {
              outsideHoursPercent: metrics.outsideHoursPercent,
              participationEvenness: metrics.participationEvenness,
              recognitionPercent: metrics.recognitionPercent,
              unansweredQuestionsPercent,
              responseMedianMinutes,
              positivityIndex,
              intensityIndex,
            }
            const prevCombined = {
              outsideHoursPercent: prevMetrics?.outsideHoursPercent,
              participationEvenness: prevMetrics?.participationEvenness,
              recognitionPercent: prevMetrics?.recognitionPercent,
              unansweredQuestionsPercent: prevExtended?.unansweredQuestionsPercent,
              responseMedianMinutes: prevExtended?.responseMedianMinutes,
              positivityIndex: prevExtended?.positivityIndex,
              intensityIndex: prevExtended?.intensityIndex,
            }
            trends = calculateComparisonTrends(currentCombined, prevCombined)
          }

          const teamHealthScore = calculateTeamHealthScore({
            outsideHoursPercent: metrics.outsideHoursPercent,
            participationEvenness: metrics.participationEvenness,
            recognitionPercent: metrics.recognitionPercent,
            unansweredQuestionsPercent,
            responseMedianMinutes,
            positivityIndex,
            intensityIndex,
          })

          extendedMetrics = {
            teamHealthScore,
            unansweredQuestionsPercent,
            responseMedianMinutes,
            positivityIndex,
            intensityIndex,
            activityDistribution: activityDist,
            trends,
          }
        }
        const closedAt = now()
        run(`INSERT INTO telegram_closed_periods
          (binding_id, period_id, start_at, closed_at, local_date, revision, profile_version, status, metrics, expires, extended_metrics)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
          id, input.periodId, open.opened_at, closedAt, localParts(open.opened_at, profile.timeZone).date,
          open.revision, open.profile_version, valid ? 'valid' : 'insufficient',
          metrics && JSON.stringify(metrics), closedAt + CLOSED_TTL,
          extendedMetrics && JSON.stringify(extendedMetrics))
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
          if (['transport_gap', 'chat_migration', 'message_edit'].includes(input.reason)) purgeText(id)
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
