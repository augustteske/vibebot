import { DatabaseSync } from 'node:sqlite'
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { aggregateRound } from '../src/core/rules.ts'
import { createTelegramStore } from './telegram-store.mjs'

export class AppError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code }
}
const fail = (status, code, message) => { throw new AppError(status, code, message) }
const hash = value => createHash('sha256').update(value).digest('hex')
const text = (value, max, label) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(400, 'INVALID_INPUT', label + ': проверьте длину и заполнение')
  return value.trim()
}
const templates = {
  clarity: { title: 'Одна цель на сегодня', body: 'За три минуты выберите один общий результат дня.', reason: 'В опубликованном раунде не менее 40% ответов отмечают низкую ясность.' },
  energy: { title: 'Освободить немного воздуха', body: 'Выберите задачу, которую можно перенести, упростить или разделить.', reason: 'В опубликованном раунде не менее 40% ответов отмечают низкий запас сил.' },
  support: { title: 'Можно попросить помощи', body: 'Предложите добровольный круг: «Мне нужна помощь с… / Я могу помочь с…».', reason: 'В опубликованном раунде не менее 40% ответов отмечают сложности с просьбой о помощи.' },
  recognition: { title: 'Замеченный вклад', body: 'Назовите конкретный поступок коллеги, который помог вам в работе.', reason: 'Добровольное упражнение, доступное при любом размере команды.' },
}

export function createStore({ path = ':memory:', secret, telegramBootstrapCredential, telegramSynthetic = false, now = Date.now,
  recommendationProvider, recommendationTimeoutMs }) {
  if (!secret || secret.length < 32) throw new Error('A persistent server secret of at least 32 characters is required')
  const db = new DatabaseSync(path)
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS members(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), name TEXT NOT NULL, role TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS recovery_keys(token_hash TEXT PRIMARY KEY, member_id TEXT NOT NULL UNIQUE REFERENCES members(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS invitations(token_hash TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS rounds(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), created_at TEXT NOT NULL, closed_at TEXT, summary TEXT);
    CREATE TABLE IF NOT EXISTS checkins(round_id TEXT NOT NULL REFERENCES rounds(id), voter_key TEXT NOT NULL, energy INTEGER NOT NULL, clarity INTEGER NOT NULL, support INTEGER NOT NULL, PRIMARY KEY(round_id,voter_key));
    CREATE TABLE IF NOT EXISTS actions(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), round_id TEXT NOT NULL REFERENCES rounds(id), kind TEXT NOT NULL, title TEXT NOT NULL, goal TEXT NOT NULL, created_at TEXT NOT NULL, feedback_closed_at TEXT, feedback_summary TEXT, UNIQUE(round_id,kind));
    CREATE TABLE IF NOT EXISTS feedback(action_id TEXT NOT NULL REFERENCES actions(id), voter_key TEXT NOT NULL, helpful INTEGER NOT NULL CHECK(helpful IN (0,1)), PRIMARY KEY(action_id,voter_key));
    CREATE TABLE IF NOT EXISTS app_feedback(id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('bug','idea','other')), message TEXT NOT NULL, created_at TEXT NOT NULL);
  `)
  const workspaceColumns = db.prepare('PRAGMA table_info(workspaces)').all()
  if (!workspaceColumns.some(column => column.name === 'room_key')) {
    db.exec('ALTER TABLE workspaces ADD COLUMN room_key TEXT; CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_room_key ON workspaces(room_key);')
  }
  const one = (sql, ...args) => db.prepare(sql).get(...args)
  const all = (sql, ...args) => db.prepare(sql).all(...args)
  const run = (sql, ...args) => db.prepare(sql).run(...args)
  const generateRoomKey = () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = randomBytes(4).toString('hex').toUpperCase()
      if (!one('SELECT 1 FROM workspaces WHERE room_key=?', candidate)) return candidate
    }
    return randomBytes(4).toString('hex').toUpperCase()
  }
  const key = (scope, member) => createHmac('sha256', secret).update(scope + ':' + member.id).digest('hex')
  const tx = fn => { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result } catch (error) { db.exec('ROLLBACK'); throw error } }
  const requireOrganizer = member => { if (member.role !== 'organizer') fail(403, 'FORBIDDEN', 'Это действие доступно организатору') }
  const roundFor = member => one('SELECT * FROM rounds WHERE workspace_id=? ORDER BY rowid DESC LIMIT 1', member.workspace_id)
  const requireAction = (member, id) => {
    const action = one('SELECT * FROM actions WHERE id=? AND workspace_id=?', id, member.workspace_id)
    if (!action) fail(404, 'NOT_FOUND', 'Договорённость не найдена')
    return action
  }
  const createRound = workspaceId => run('INSERT INTO rounds(id,workspace_id,created_at) VALUES(?,?,?)', randomUUID(), workspaceId, new Date(now()).toISOString())
  const session = memberId => {
    const token = randomBytes(32).toString('hex')
    run('INSERT INTO sessions VALUES(?,?,?)', hash(token), memberId, now() + 7 * 86400000)
    return token
  }
  const suggestions = round => {
    const summary = round.closed_at ? JSON.parse(round.summary) : { status: 'open' }
    const kinds = summary.status === 'published' && summary.needs.length ? summary.needs.slice(0, 2) : ['recognition']
    return kinds.map(kind => ({ id: kind, ...templates[kind], source: 'template' }))
  }

  const telegram = createTelegramStore({ db, secret, bootstrapCredential: telegramBootstrapCredential, fail,
    enabled: telegramSynthetic, now, recommendationProvider, recommendationTimeoutMs })
  const cleanup = () => tx(() => {
    const time = now()
    run('DELETE FROM sessions WHERE expires<=?', time)
    run('DELETE FROM invitations WHERE expires<=?', time)
    run('DELETE FROM recovery_keys WHERE expires<=?', time)
  })
  cleanup()

  return {
    telegram,
    cleanup,
    close: () => db.close(),
    authenticate(token) {
      if (!token || !/^[a-f0-9]{64}$/.test(token)) return null
      return one('SELECT members.* FROM members JOIN sessions ON members.id=sessions.member_id WHERE sessions.token_hash=? AND sessions.expires>?', hash(token), now()) ?? null
    },
    logout(token) { if (token) run('DELETE FROM sessions WHERE token_hash=?', hash(token)) },
    recoveryKey(member) {
      const token = randomBytes(32).toString('hex')
      const expiresAt = now() + 30 * 86400000
      run('INSERT INTO recovery_keys VALUES(?,?,?) ON CONFLICT(member_id) DO UPDATE SET token_hash=excluded.token_hash,expires=excluded.expires', hash(token), member.id, expiresAt)
      return { key: token, expiresAt: new Date(expiresAt).toISOString() }
    },
    restore(input) {
      const token = text(input.key, 64, 'Код входа')
      const saved = one('SELECT member_id FROM recovery_keys WHERE token_hash=? AND expires>?', hash(token), now())
      if (!saved) fail(400, 'INVALID_ACCESS_KEY', 'Код входа неверен или срок его действия истёк')
      return session(saved.member_id)
    },
    createWorkspace(input) {
      const name = text(input.name, 80, 'Название команды')
      const memberName = text(input.displayName, 60, 'Имя участника')
      return tx(() => {
        const workspaceId = randomUUID(), memberId = randomUUID(), roomKey = generateRoomKey()
        run('INSERT INTO workspaces(id,name,room_key) VALUES(?,?,?)', workspaceId, name, roomKey)
        run('INSERT INTO members VALUES(?,?,?,?)', memberId, workspaceId, memberName, 'organizer')
        createRound(workspaceId)
        return session(memberId)
      })
    },
    invite(member) {
      requireOrganizer(member)
      const token = randomBytes(32).toString('hex')
      const expiresAt = now() + 86400000
      run('INSERT INTO invitations(token_hash,workspace_id,expires) VALUES(?,?,?)', hash(token), member.workspace_id, expiresAt)
      const ws = one('SELECT room_key FROM workspaces WHERE id=?', member.workspace_id)
      return { token, ...(ws?.room_key ? { roomKey: ws.room_key } : {}), expiresAt: new Date(expiresAt).toISOString() }
    },
    joinByKey(input) {
      const rawKey = input?.roomKey ?? input?.key ?? input?.token
      const roomKey = text(rawKey, 16, 'Ключ комнаты').toUpperCase()
      const rawName = typeof input?.displayName === 'string' && input.displayName.trim() ? input.displayName : 'Участник'
      const name = text(rawName, 60, 'Имя участника')
      return tx(() => {
        const workspace = one('SELECT id FROM workspaces WHERE UPPER(room_key)=?', roomKey)
        if (!workspace) fail(400, 'INVALID_ROOM_KEY', 'Ключ комнаты не найден. Проверьте код у организатора и попробуйте снова.')
        const id = randomUUID()
        run('INSERT INTO members VALUES(?,?,?,?)', id, workspace.id, name, 'participant')
        return session(id)
      })
    },
    join(input) {
      if (input?.roomKey !== undefined) return this.joinByKey(input)
      const token = text(input.token, 64, 'Приглашение')
      const name = text(input.displayName, 60, 'Имя участника')
      return tx(() => {
        const invite = one('SELECT * FROM invitations WHERE token_hash=? AND used=0 AND expires>?', hash(token), now())
        if (!invite) fail(400, 'INVALID_INVITATION', 'Приглашение уже использовано, истекло или неверно')
        run('UPDATE invitations SET used=1 WHERE token_hash=?', hash(token))
        const id = randomUUID()
        run('INSERT INTO members VALUES(?,?,?,?)', id, invite.workspace_id, name, 'participant')
        return session(id)
      })
    },
    snapshot(member) {
      let workspaceRow = one('SELECT id,name,room_key FROM workspaces WHERE id=?', member.workspace_id)
      if (workspaceRow && !workspaceRow.room_key) {
        const roomKey = generateRoomKey()
        run('UPDATE workspaces SET room_key=? WHERE id=?', roomKey, workspaceRow.id)
        workspaceRow = { ...workspaceRow, room_key: roomKey }
      }
      const workspace = {
        id: workspaceRow.id,
        name: workspaceRow.name,
        ...(member.role === 'organizer' && workspaceRow.room_key ? { roomKey: workspaceRow.room_key } : {}),
      }
      const round = roundFor(member)
      const actions = all('SELECT * FROM actions WHERE workspace_id=? ORDER BY rowid DESC LIMIT 12', member.workspace_id).map(action => ({
        id: action.id, title: action.title, goal: action.goal, createdAt: action.created_at,
        feedback: action.feedback_closed_at ? JSON.parse(action.feedback_summary) : { status: 'open' },
        myFeedbackSubmitted: !action.feedback_closed_at && !!one('SELECT 1 FROM feedback WHERE action_id=? AND voter_key=?', action.id, key('feedback:' + action.id, member)),
      }))
      const acceptedKinds = all('SELECT kind FROM actions WHERE round_id=?', round.id).map(row => row.kind)
      return {
        workspace, member: { name: member.name, role: member.role },
        round: { id: round.id, createdAt: round.created_at, closedAt: round.closed_at,
          summary: round.closed_at ? JSON.parse(round.summary) : { status: 'open' },
          mySubmitted: !round.closed_at && !!one('SELECT 1 FROM checkins WHERE round_id=? AND voter_key=?', round.id, key('checkin:' + round.id, member)) },
        suggestions: suggestions(round).filter(item => !acceptedKinds.includes(item.id)), actions,
        mode: 'templates',
      }
    },
    summary(member) {
      const round = roundFor(member)
      return round.closed_at ? JSON.parse(round.summary) : { status: 'open' }
    },
    telegramCheckinStats(member) {
      // Анонимная агрегация личных чек-инов из Telegram. Никаких nonce, digest
      // или дат по отдельным ответам наружу — только агрегаты по workspace.
      requireOrganizer(member)
      const rows = all(`SELECT c.energy,c.clarity,c.support FROM telegram_checkins c
        JOIN telegram_bindings b ON b.id=c.binding_id
        WHERE b.workspace_id=? AND c.expires>?`, member.workspace_id, now())
      const total = rows.length
      if (total < 5) return { status: 'hidden', reason: 'insufficient_responses', total }
      const roundOne = value => Math.round(value * 10) / 10
      const metrics = {}
      for (const metric of ['energy', 'clarity', 'support']) {
        const values = rows.map(row => row[metric])
        metrics[metric] = {
          average: roundOne(values.reduce((sum, value) => sum + value, 0) / total),
          distribution: values.reduce((acc, value) => { acc[value] += 1; return acc },
            { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }),
        }
      }
      return { status: 'visible', total, metrics }
    },
    checkin(member, input) {
      const round = roundFor(member)
      if (input.roundId !== round.id) fail(409, 'STALE_ROUND', 'Раунд изменился. Обновите страницу перед отправкой.')
      if (round.closed_at) fail(409, 'ROUND_CLOSED', 'Этот раунд уже закрыт')
      const scores = input.scores
      if (!scores || ['energy', 'clarity', 'support'].some(k => !Number.isInteger(scores[k]) || scores[k] < 1 || scores[k] > 5)) fail(400, 'INVALID_SCORES', 'Выберите три целые оценки от 1 до 5')
      run('INSERT INTO checkins VALUES(?,?,?,?,?) ON CONFLICT(round_id,voter_key) DO UPDATE SET energy=excluded.energy,clarity=excluded.clarity,support=excluded.support', round.id, key('checkin:' + round.id, member), scores.energy, scores.clarity, scores.support)
    },
    closeRound(member, input) {
      requireOrganizer(member)
      return tx(() => {
        const round = roundFor(member)
        if (input.roundId !== round.id) fail(409, 'STALE_ROUND', 'Раунд изменился. Обновите страницу.')
        if (round.closed_at) fail(409, 'ROUND_CLOSED', 'Раунд уже закрыт')
        const answers = all('SELECT energy,clarity,support FROM checkins WHERE round_id=?', round.id)
        const summary = aggregateRound({ closed: true, answers })
        run('UPDATE rounds SET closed_at=?,summary=? WHERE id=?', new Date(now()).toISOString(), JSON.stringify(summary), round.id)
        run('DELETE FROM checkins WHERE round_id=?', round.id)
      })
    },
    openRound(member) {
      requireOrganizer(member)
      if (!roundFor(member).closed_at) fail(409, 'ROUND_OPEN', 'Текущий раунд ещё открыт')
      createRound(member.workspace_id)
    },
    accept(member, input) {
      const round = roundFor(member)
      if (input.roundId !== round.id) fail(409, 'STALE_ROUND', 'Раунд изменился. Обновите страницу.')
      const suggestion = suggestions(round).find(item => item.id === input.suggestionId)
      if (!suggestion) fail(400, 'INVALID_SUGGESTION', 'Предложение недоступно для этого раунда')
      const goal = text(input.goal, 500, 'Следующий шаг')
      if (one('SELECT id FROM actions WHERE round_id=? AND kind=?', round.id, suggestion.id)) fail(409, 'ALREADY_ACCEPTED', 'Эта договорённость уже создана')
      const since = new Date(now() - 86400000).toISOString()
      if (one('SELECT COUNT(*) AS n FROM actions WHERE workspace_id=? AND created_at>?', member.workspace_id, since).n >= 2) fail(409, 'DAILY_LIMIT', 'На ближайшие 24 часа уже выбраны два шага. Сначала попробуйте их.')
      run('INSERT INTO actions(id,workspace_id,round_id,kind,title,goal,created_at) VALUES(?,?,?,?,?,?,?)', randomUUID(), member.workspace_id, round.id, suggestion.id, suggestion.title, goal, new Date(now()).toISOString())
    },
    feedback(member, id, input) {
      const action = requireAction(member, id)
      if (action.feedback_closed_at) fail(409, 'FEEDBACK_CLOSED', 'Сбор отзывов уже завершён')
      if (typeof input.helpful !== 'boolean') fail(400, 'INVALID_FEEDBACK', 'Выберите оценку пользы')
      run('INSERT INTO feedback VALUES(?,?,?) ON CONFLICT(action_id,voter_key) DO UPDATE SET helpful=excluded.helpful', action.id, key('feedback:' + action.id, member), input.helpful ? 1 : 0)
    },
    closeFeedback(member, id) {
      requireOrganizer(member)
      return tx(() => {
        const action = requireAction(member, id)
        if (action.feedback_closed_at) fail(409, 'FEEDBACK_CLOSED', 'Сбор отзывов уже завершён')
        const totals = one('SELECT COUNT(*) AS n,SUM(helpful) AS yes FROM feedback WHERE action_id=?', id)
        const result = totals.n >= 5 ? { status: 'published', helpfulPercent: Math.round(100 * totals.yes / totals.n) } : { status: 'insufficient' }
        run('UPDATE actions SET feedback_closed_at=?,feedback_summary=? WHERE id=?', new Date(now()).toISOString(), JSON.stringify(result), id)
        run('DELETE FROM feedback WHERE action_id=?', id)
      })
    },
    submitFeedback(input) {
      const type = input?.type
      if (!['bug', 'idea', 'other'].includes(type)) fail(400, 'INVALID_INPUT', 'Тип отзыва: выберите вариант')
      const message = text(input.message, 2000, 'Сообщение')
      const id = randomUUID()
      run('INSERT INTO app_feedback VALUES(?,?,?,?)', id, type, message, new Date().toISOString())
      return { id }
    },
    exportUserData(member) {
      const workspaceRow = one('SELECT id, name FROM workspaces WHERE id=?', member.workspace_id)
      const profile = {
        id: member.id,
        name: member.name,
        role: member.role,
        workspace: {
          id: member.workspace_id,
          name: workspaceRow?.name ?? '',
        },
      }

      const rounds = all('SELECT id, created_at, closed_at FROM rounds WHERE workspace_id=? ORDER BY created_at ASC', member.workspace_id)
      const checkins = []
      for (const r of rounds) {
        const voterKey = key('checkin:' + r.id, member)
        const c = one('SELECT energy, clarity, support FROM checkins WHERE round_id=? AND voter_key=?', r.id, voterKey)
        if (c) {
          checkins.push({
            roundId: r.id,
            roundCreatedAt: r.created_at,
            roundClosedAt: r.closed_at,
            energy: c.energy,
            clarity: c.clarity,
            support: c.support,
          })
        }
      }

      const actions = all('SELECT id, title, goal, created_at, feedback_closed_at FROM actions WHERE workspace_id=? ORDER BY created_at ASC', member.workspace_id)
      const feedback = []
      for (const a of actions) {
        const voterKey = key('feedback:' + a.id, member)
        const f = one('SELECT helpful FROM feedback WHERE action_id=? AND voter_key=?', a.id, voterKey)
        if (f) {
          feedback.push({
            actionId: a.id,
            actionTitle: a.title,
            helpful: f.helpful === 1,
          })
        }
      }

      const consents = []
      let telegramIdentity = null
      let telegramLinks = []
      let telegramSubscriptions = []
      let telegramVotes = []

      try {
        const ident = one('SELECT telegram_user_id FROM telegram_identities WHERE workspace_id=? AND member_id=?', member.workspace_id, member.id)
        if (ident) telegramIdentity = ident.telegram_user_id

        const links = all('SELECT binding_id, telegram_user_id FROM telegram_links WHERE workspace_id=? AND member_id=?', member.workspace_id, member.id)
        telegramLinks = links.map(l => ({ bindingId: l.binding_id, telegramUserId: l.telegram_user_id }))

        const subs = all('SELECT telegram_user_id, chat_id, created_at FROM telegram_notification_subscriptions WHERE workspace_id=? AND member_id=?', member.workspace_id, member.id)
        telegramSubscriptions = subs.map(s => ({ telegramUserId: s.telegram_user_id, chatId: s.chat_id, createdAt: new Date(s.created_at).toISOString() }))

        const bindings = all('SELECT id, chat_id, state FROM telegram_bindings WHERE workspace_id=?', member.workspace_id)
        for (const b of bindings) {
          try {
            const state = JSON.parse(b.state)
            const inRoster = Array.isArray(state?.roster) && state.roster.includes(member.id)
            const decision = state?.decisions?.[member.id] ?? null
            if (inRoster || decision !== null) {
              consents.push({
                bindingId: b.id,
                chatId: b.chat_id,
                policyVersion: state.policyVersion,
                rosterVersion: state.rosterVersion,
                inRoster,
                decision,
                ...(member.role === 'organizer' && state.companyAccepted !== undefined ? { companyAccepted: state.companyAccepted } : {}),
              })
            }
          } catch {}
        }

        const votes = all('SELECT binding_id, period_id, kind, value FROM telegram_feedback_votes WHERE member_id=?', member.id)
        telegramVotes = votes.map(v => ({ bindingId: v.binding_id, periodId: v.period_id, kind: v.kind, value: v.value }))
      } catch {}

      return {
        version: '1.0',
        exportedAt: new Date(now()).toISOString(),
        profile,
        checkins,
        feedback,
        consents,
        telegram: {
          telegramUserId: telegramIdentity,
          links: telegramLinks,
          notificationSubscriptions: telegramSubscriptions,
          feedbackVotes: telegramVotes,
        },
      }
    },
  }
}
