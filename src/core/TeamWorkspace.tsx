import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError } from './client'
import type { SessionSnapshot } from './contracts'
import type { CommunicationRecommendation, CommunicationView } from './telegram'
import './team.css'

export type TeamMemberRole = 'lead' | 'developer' | 'designer' | 'manager' | 'other';

export interface TeamMember {
  userId: string;
  name: string;
  isTeamMember: boolean;
  role?: TeamMemberRole;
}

export interface TeamProfile {
  members: TeamMember[];
  description?: string;
  currentContext?: string;
  updatedAt?: string;
}

const teamMemberRoles: { value: TeamMemberRole; label: string }[] = [
  { value: 'lead', label: 'Лид команды' },
  { value: 'developer', label: 'Разработчик' },
  { value: 'designer', label: 'Дизайнер' },
  { value: 'manager', label: 'Менеджер' },
  { value: 'other', label: 'Другое' },
]

const teamProfileStorageKey = (workspaceId: string) => `vibee:team-profile:${workspaceId}`

function isTeamMemberRole(value: unknown): value is TeamMemberRole {
  return teamMemberRoles.some(role => role.value === value)
}

function isTeamProfile(value: unknown): value is TeamProfile {
  if (!value || typeof value !== 'object') return false
  const profile = value as Record<string, unknown>
  if (!Array.isArray(profile.members)) return false
  const memberIds = new Set<string>()
  for (const member of profile.members) {
    if (!member || typeof member !== 'object') return false
    const item = member as Record<string, unknown>
    if (typeof item.userId !== 'string' || !item.userId.trim() || memberIds.has(item.userId)
      || typeof item.name !== 'string' || typeof item.isTeamMember !== 'boolean'
      || (item.role !== undefined && !isTeamMemberRole(item.role))) return false
    memberIds.add(item.userId)
  }
  return (profile.description === undefined || typeof profile.description === 'string')
    && (profile.currentContext === undefined || typeof profile.currentContext === 'string')
    && (profile.updatedAt === undefined || (typeof profile.updatedAt === 'string' && !Number.isNaN(Date.parse(profile.updatedAt))))
}

const labels = { energy: 'Ресурс', clarity: 'Ясность', support: 'Поддержка' }
const dateLabel = (date: string) => new Date(date).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Omsk' })
const initialToken = () => new URLSearchParams(window.location.hash.slice(1)).get('invite') ?? ''
const demoChatView = {
  status: 'published',
  demo: true,
  period: {
    id: '11111111-1111-4111-8111-111111111111',
    start: '2026-10-29T03:00:00.000Z',
    end: '2026-10-30T03:00:00.000Z',
  },
  dataSource: 'chat',
  profileVersion: 1,
  metrics: {
    outsideHoursPercent: 25,
    participationEvenness: 89.8,
    recognitionPercent: 20,
  },
  recognitionMethod: 'lexicon-v1',
  comparison: null,
} satisfies Extract<CommunicationView, { status: 'published' }>
const demoChatRecommendation = {
  id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  periodId: demoChatView.period.id,
  profileVersion: demoChatView.profileVersion,
  dataSource: 'chat',
  source: 'template',
  observation: 'Вне рабочих интервалов отправлено 25% сообщений периода.',
  explanation: 'Возможно, часть обсуждений приходится на время вне согласованного расписания.',
  limitation: 'Это доля сообщений, а не оценка нагрузки; причины неизвестны.',
  action: 'Обсудить с командой удобное время для рабочих сообщений.',
  demo: true,
} satisfies CommunicationRecommendation
const chatMetricLabels = [
  ['outsideHoursPercent', 'Вне рабочих интервалов'],
  ['participationEvenness', 'Равномерность участия'],
  ['recognitionPercent', 'Сообщения с благодарностью'],
] as const

function ChatAnalyticsPreview({
  view,
  recommendation,
}: {
  view: Extract<CommunicationView, { status: 'published' }>
  recommendation: CommunicationRecommendation
}) {
  return <section className="panel chat-demo" aria-labelledby="chat-demo-title">
    <div className="chat-demo__header">
      <div>
        <h2 id="chat-demo-title">Демо чат-аналитики</h2>
        <p className="muted">Синтетический пример в формате серверного контракта · не данные этой команды</p>
      </div>
      <span className="chat-demo__badge">ВЫМЫШЛЕННЫЕ ДАННЫЕ</span>
    </div>
    <p className="chat-demo__period">Закрытый период · {dateLabel(view.period.start)} — {dateLabel(view.period.end)}</p>
    <div className="metrics">
      {chatMetricLabels.map(([key, label]) => <div className="metric" key={key}>
        {label}
        <strong>{view.metrics[key].toLocaleString('ru-RU', { maximumFractionDigits: 1 })}<small>%</small></strong>
      </div>)}
    </div>
    <article className="chat-demo__recommendation">
      <div className="chat-demo__recommendation-heading">
        <h3>Шаблонная рекомендация</h3>
        <span className="eyebrow">{recommendation.source} · {recommendation.dataSource}</span>
      </div>
      <p>{recommendation.observation}</p>
      <p>{recommendation.explanation}</p>
      <p className="muted">Ограничение: {recommendation.limitation}</p>
      <p><strong>Возможный следующий шаг:</strong> {recommendation.action}</p>
      <p className="muted">Демо-карточка не подтверждена командой и никуда не отправляется. Сравнение с историей отсутствует.</p>
    </article>
  </section>
}

function invitationToken(value: string) {
  try { return new URLSearchParams(new URL(value).hash.slice(1)).get('invite') ?? value.trim() } catch { return value.trim() }
}

export function TeamWorkspace() {
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null)
  const [initialized, setInitialized] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [join, setJoin] = useState(!!initialToken())
  const [invite, setInvite] = useState(initialToken)
  const [inviteLink, setInviteLink] = useState('')
  const [restore, setRestore] = useState(false)
  const [accessKey, setAccessKey] = useState('')
  const [confirm, setConfirm] = useState('')
  const [teamProfile, setTeamProfile] = useState<TeamProfile>({ members: [] })
  const [teamProfileWorkspaceId, setTeamProfileWorkspaceId] = useState('')
  const [teamProfileLoaded, setTeamProfileLoaded] = useState(false)
  const [teamProfileError, setTeamProfileError] = useState('')
  const requestVersion = useRef(0)
  const busyRef = useRef(false)
  const teamProfileWorkspaceRef = useRef('')
  const activeWorkspaceId = snapshot?.workspace.id ?? ''
  const loadTeamProfile = useCallback((workspaceId: string, force = false) => {
    if (!force && teamProfileWorkspaceRef.current === workspaceId) return
    teamProfileWorkspaceRef.current = workspaceId
    setTeamProfileLoaded(false)
    setTeamProfileError('')
    try {
      const stored = window.localStorage.getItem(teamProfileStorageKey(workspaceId))
      const profile: unknown = stored === null ? { members: [] } : JSON.parse(stored)
      if (!isTeamProfile(profile)) throw new Error('Сохранённый профиль команды имеет неверный формат.')
      setTeamProfile(profile)
      setTeamProfileWorkspaceId(workspaceId)
      setTeamProfileLoaded(true)
    } catch (failure) {
      setTeamProfileError(failure instanceof Error ? failure.message : 'Не удалось прочитать профиль команды из этого браузера.')
    }
  }, [])
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current
    try {
      const result = await api('/session')
      if (version === requestVersion.current) { setSnapshot(result); setError('') }
    } catch (failure) {
      if (version !== requestVersion.current) return
      if (failure instanceof ApiError && failure.status === 401) { setSnapshot(null); setError('') }
      else setError(failure instanceof Error ? failure.message : 'Не удалось обновить данные')
    } finally { if (version === requestVersion.current) setInitialized(true) }
  }, [])
  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => { if (!busyRef.current && !document.hidden) void refresh() }, 15000)
    return () => { window.clearInterval(timer); requestVersion.current++ }
  }, [refresh])
  function updateTeamProfile(update: (profile: TeamProfile) => TeamProfile, updatedAt: string) {
    const updated = { ...update(teamProfile), updatedAt }
    setTeamProfile(updated)
    if (!activeWorkspaceId || !teamProfileLoaded || teamProfileWorkspaceId !== activeWorkspaceId) return
    try {
      window.localStorage.setItem(teamProfileStorageKey(activeWorkspaceId), JSON.stringify(updated))
      setTeamProfileError('')
    } catch (failure) {
      setTeamProfileError(failure instanceof Error ? failure.message : 'Не удалось сохранить профиль команды в этом браузере.')
    }
  }
  function updateTeamMember(userId: string, changes: Partial<TeamMember>, updatedAt: string) {
    updateTeamProfile(current => ({
      ...current,
      members: current.members.map(member => {
        if (member.userId !== userId) return member
        const updated = { ...member, ...changes }
        if (!updated.isTeamMember) delete updated.role
        return updated
      }),
    }), updatedAt)
  }
  async function perform(path: string, input: unknown, message: string) {
    if (busyRef.current) return false
    busyRef.current = true; setBusy(true); setError(''); setNotice(''); requestVersion.current++
    try {
      const result = await api(path, input)
      setSnapshot(result); setNotice(message); setConfirm('')
      if (path === '/workspaces' || path === '/join' || path === '/restore') {
        window.history.replaceState(null, '', window.location.pathname + '?mode=team')
        setInvite('')
      }
      return true
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Не удалось выполнить действие')
      return false
    } finally { busyRef.current = false; setBusy(false) }
  }
  async function issueInvite() {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const result = await api<{ token: string; expiresAt: string }>('/invitations', {})
      setInviteLink(window.location.origin + '/?mode=team#invite=' + result.token)
      setNotice('Приглашение создано на 24 часа. Передайте его одному участнику.')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Приглашение не создано') }
    finally { busyRef.current = false; setBusy(false) }
  }
  async function logout() {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setError(''); requestVersion.current++
    try { await api('/logout', {}); setSnapshot(null); setInviteLink(''); setAccessKey(''); setConfirm(''); setNotice('Вы вышли из пространства.') }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось выйти') }
    finally { busyRef.current = false; setBusy(false) }
  }
  async function createAccessKey() {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setError('')
    try {
      const result = await api<{ key: string }>('/recovery-key', {})
      setAccessKey(result.key); setNotice('Личный код входа создан на 30 дней. Сохраните его у себя; не передавайте другим.')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось создать код входа') }
    finally { busyRef.current = false; setBusy(false) }
  }
  function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    void perform(restore ? '/restore' : join ? '/join' : '/workspaces', restore ? { key: values.get('accessKey') } : join ? { displayName: values.get('displayName'), token: invitationToken(invite) } : { displayName: values.get('displayName'), name: values.get('name') }, restore ? 'Вход восстановлен.' : join ? 'Вы присоединились к команде.' : 'Пространство создано. Пригласите участников и сохраните личный код входа.')
  }
  const status = snapshot?.round.summary
  return <section className="team-space" aria-label="Моя команда">
    <div className="feedback-messages" aria-live="polite">{error && <div className="error" role="alert">{error} <button type="button" onClick={() => void refresh()} disabled={busy}>Обновить</button></div>}{notice && <p className="status">{notice}</p>}</div>
    <ChatAnalyticsPreview view={demoChatView} recommendation={demoChatRecommendation}/>
    {!initialized ? <div className="panel"><p role="status">Открываем пространство…</p></div> : !snapshot ? <section className="panel entrance">
      <h2>{restore ? 'Вернуться в команду' : join ? 'Присоединиться к команде' : 'Создать пространство'}</h2>
      <p className="muted">Собирайте добровольные сигналы и выбирайте полезный следующий шаг.</p>
      <form onSubmit={authenticate}><fieldset disabled={busy}>{restore ? <label className="team-field">Личный код входа<input name="accessKey" type="password" autoComplete="off" maxLength={64} required/></label> : <><label className="team-field">Ваше имя<input name="displayName" autoComplete="given-name" maxLength={60} required/></label>
        {join ? <label className="team-field">Приглашение<input value={invite} onChange={e => setInvite(e.target.value)} autoComplete="off" required placeholder="Ссылка или код приглашения"/></label> : <label className="team-field">Название команды<input name="name" maxLength={80} required placeholder="Например, Команда Августа"/></label>}
        </>}<button className="button" type="submit">{busy ? 'Сохраняем…' : restore ? 'Войти по коду' : join ? 'Войти по приглашению' : 'Создать команду'}</button>
      </fieldset></form><div className="button-row"><button className="text-button" onClick={() => { setRestore(false); setJoin(!join) }} disabled={busy}>{join ? 'Создать новую команду' : 'У меня есть приглашение'}</button><button className="text-button" onClick={() => setRestore(!restore)} disabled={busy}>{restore ? 'Обычный вход' : 'У меня есть личный код входа'}</button></div>
    </section> : <>
      <div className="team-heading"><div><h2>{snapshot.workspace.name}</h2><p className="muted">{snapshot.member.name} · {snapshot.member.role === 'organizer' ? 'организатор' : 'участник'} · время по Омску</p></div><div className="button-row"><button className="button secondary" onClick={() => void refresh()} disabled={busy}>Обновить</button><button className="text-button" onClick={() => setConfirm('logout')} disabled={busy}>Выйти</button></div></div>
      {confirm === 'logout' && <div className="panel confirmation"><p>Для возвращения понадобится личный код входа. Сохраните его перед выходом.</p><div className="button-row"><button className="button secondary" onClick={() => setConfirm('')} disabled={busy}>Остаться</button><button className="button" onClick={() => void logout()} disabled={busy}>Выйти из пространства</button></div></div>}
      {snapshot.member.role === 'organizer' && <details key={activeWorkspaceId} className="panel team-profile" onToggle={event => {
        if (event.currentTarget.open && teamProfileWorkspaceRef.current !== activeWorkspaceId) loadTeamProfile(activeWorkspaceId)
      }}>
        <summary>Профиль команды <span className="muted">· необязательно</span></summary>
        <p className="muted">Укажите участников, роли и контекст для более точных рекомендаций. Это добровольная настройка, не психологический тест. Данные хранятся только в этом браузере и не отправляются на сервер.</p>
        {!teamProfileLoaded || teamProfileWorkspaceId !== activeWorkspaceId ? teamProfileError
          ? <div className="error" role="alert">{teamProfileError} <button type="button" onClick={() => loadTeamProfile(activeWorkspaceId, true)}>Повторить загрузку</button></div>
          : <p role="status">Загружаем локальный профиль…</p>
          : <>
            {teamProfileError && <p className="error" role="alert">{teamProfileError}</p>}
            <label className="team-field">О команде<textarea value={teamProfile.description ?? ''} maxLength={500} rows={3} placeholder="Например, небольшая команда разработки продукта" onChange={event => updateTeamProfile(current => ({ ...current, description: event.target.value }), new Date().toISOString())}/></label>
            <label className="team-field">Текущий контекст<textarea value={teamProfile.currentContext ?? ''} maxLength={500} rows={3} placeholder="Например, готовим запуск и согласуем приоритеты" onChange={event => updateTeamProfile(current => ({ ...current, currentContext: event.target.value }), new Date().toISOString())}/></label>
            <h3>Состав команды</h3>
            {teamProfile.members.length === 0 && <p className="muted">Добавьте членов команды и гостей, например заказчиков.</p>}
            <div className="team-profile__members">
              {teamProfile.members.map(member => <article className="team-profile__member" key={member.userId}>
                <label className="team-field">Имя<input value={member.name} maxLength={80} onChange={event => updateTeamMember(member.userId, { name: event.target.value }, new Date().toISOString())}/></label>
                <label className="team-profile__checkbox"><input type="checkbox" checked={member.isTeamMember} onChange={event => updateTeamMember(member.userId, { isTeamMember: event.target.checked }, new Date().toISOString())}/> Член команды</label>
                {member.isTeamMember && <label className="team-field">Роль<select value={member.role ?? 'other'} onChange={event => { if (isTeamMemberRole(event.target.value)) updateTeamMember(member.userId, { role: event.target.value }, new Date().toISOString()) }}>
                  {teamMemberRoles.map(role => <option value={role.value} key={role.value}>{role.label}</option>)}
                </select></label>}
                {!member.isTeamMember && <p className="muted">Гость / заказчик</p>}
                <button className="text-button" type="button" onClick={() => updateTeamProfile(current => ({ ...current, members: current.members.filter(item => item.userId !== member.userId) }), new Date().toISOString())}>Удалить участника</button>
              </article>)}
            </div>
            <form className="team-profile__add" onSubmit={event => {
              event.preventDefault()
              const values = new FormData(event.currentTarget)
              const name = String(values.get('memberName') ?? '').trim()
              if (!name) return
              const isTeamMember = values.get('isTeamMember') === 'on'
              const selectedRole = values.get('role')
              const member: TeamMember = {
                userId: crypto.randomUUID(),
                name,
                isTeamMember,
                ...(isTeamMember && isTeamMemberRole(selectedRole) ? { role: selectedRole } : {}),
              }
              updateTeamProfile(current => ({ ...current, members: [...current.members, member] }), new Date().toISOString())
              event.currentTarget.reset()
            }}>
              <label className="team-field">Добавить человека<input name="memberName" maxLength={80} required placeholder="Имя участника или гостя"/></label>
              <label className="team-profile__checkbox"><input type="checkbox" name="isTeamMember" defaultChecked/> Член команды</label>
              <label className="team-field">Роль (для члена команды)<select name="role" defaultValue="other">
                {teamMemberRoles.map(role => <option value={role.value} key={role.value}>{role.label}</option>)}
              </select></label>
              <button className="button secondary" type="submit">Добавить</button>
            </form>
            {teamProfile.updatedAt && <p className="muted team-profile__updated">Изменено: {dateLabel(teamProfile.updatedAt)}</p>}
          </>}
      </details>}
      <div className="grid"><div>
        <section className="panel"><h2>Температура команды</h2><p className="muted">Раунд от {dateLabel(snapshot.round.createdAt)}{snapshot.round.closedAt ? ' · завершён ' + dateLabel(snapshot.round.closedAt) : ' · сбор ответов открыт'}</p>
          {status?.status === 'open' ? <p>Результаты появятся после завершения раунда. Для публикации нужны ответы минимум пяти отдельных участников.</p> : status?.status === 'insufficient' ? <p>Недостаточно данных для публикации. Доступны добровольные упражнения.</p> : status?.status === 'published' ? <><p>{status.needs.includes('clarity') ? '🌥 Команде стоит сверить приоритеты.' : status.needs.length ? 'Команде может пригодиться поддержка.' : '☀️ Сигналы ровные. Продолжайте замечать вклад друг друга.'}</p><div className="metrics">{(['energy','clarity','support'] as const).map(key => <div className="metric" key={key}>{labels[key]}<strong>{status.means[key].toFixed(1)}<small>/5</small></strong></div>)}</div></> : null}
          {snapshot.member.role === 'organizer' && <div className="round-controls">{snapshot.round.closedAt ? <button className="button secondary" disabled={busy} onClick={() => void perform('/rounds/open', {}, 'Новый раунд открыт.')}>Начать новый раунд</button> : confirm === 'round' ? <div className="confirmation"><p>Завершить сбор? Отдельные ответы будут удалены после расчёта общих показателей. При менее пяти ответах показатели останутся скрытыми.</p><div className="button-row"><button className="button" disabled={busy} onClick={() => void perform('/rounds/close', { roundId: snapshot.round.id }, 'Раунд завершён.')}>Подтвердить завершение</button><button className="button secondary" onClick={() => setConfirm('')} disabled={busy}>Продолжить сбор</button></div></div> : <button className="button secondary" disabled={busy} onClick={() => setConfirm('round')}>Завершить раунд</button>}</div>}
        </section>
        <section className="panel"><h2>Vibee предлагает</h2><p className="muted">Готовые подсказки по правилам · генерация ИИ ещё не подключена</p>{snapshot.suggestions.length === 0 && <p>Следующий шаг уже выбран. Попробуйте договорённость и оцените её пользу.</p>}
          {snapshot.suggestions.map(suggestion => <form key={snapshot.round.id + suggestion.id} className="suggestion" onSubmit={event => { event.preventDefault(); const values = new FormData(event.currentTarget); void perform('/actions', { roundId: snapshot.round.id, suggestionId: suggestion.id, goal: values.get('goal') }, 'Договорённость сохранена и доступна команде.') }}><h3>{suggestion.title}</h3><p>{suggestion.body}</p><p className="muted">{suggestion.reason}</p><fieldset disabled={busy}><label className="team-field">О чём договоримся?<textarea name="goal" defaultValue={suggestion.body} maxLength={500} required rows={3}/></label><button className="button" type="submit">Подтвердить общий шаг</button></fieldset></form>)}
        </section>
        <section className="panel"><h2>Наши следующие шаги</h2>{snapshot.actions.length === 0 && <p className="muted">Здесь появятся подтверждённые договорённости.</p>}
          {snapshot.actions.map(action => <article className="shared-action" key={action.id}><span className="eyebrow">{dateLabel(action.createdAt)}</span><h3>{action.title}</h3><p className="goal">{action.goal}</p>
            {action.feedback.status === 'open' ? <><p className="muted">{action.myFeedbackSubmitted ? 'Ваш отзыв сохранён. До завершения сбора его можно изменить.' : 'Когда попробуете этот шаг, оцените его пользу.'}</p><div className="button-row"><button className="button secondary" disabled={busy} onClick={() => void perform('/actions/' + action.id + '/feedback', { helpful: true }, 'Отзыв сохранён.')}>Помогло</button><button className="button secondary" disabled={busy} onClick={() => void perform('/actions/' + action.id + '/feedback', { helpful: false }, 'Отзыв сохранён.')}>Не помогло</button></div>
              {snapshot.member.role === 'organizer' && (confirm === action.id ? <div className="confirmation"><p>Завершить сбор отзывов? При менее пяти ответах результат останется скрытым. Индивидуальные отзывы будут удалены.</p><div className="button-row"><button className="button" disabled={busy} onClick={() => void perform('/actions/' + action.id + '/close-feedback', {}, 'Сбор отзывов завершён.')}>Подтвердить</button><button className="button secondary" onClick={() => setConfirm('')} disabled={busy}>Отмена</button></div></div> : <button className="text-button" disabled={busy} onClick={() => setConfirm(action.id)}>Завершить сбор отзывов</button>)}
            </> : action.feedback.status === 'insufficient' ? <p className="muted">Сбор завершён. Недостаточно отзывов для публикации.</p> : <p className="status">Сбор завершён. {action.feedback.helpfulPercent}% ответов отметили пользу шага.</p>}
          </article>)}
        </section>
      </div><aside>
        <section className="panel"><h2>Как ты сегодня?</h2><p className="muted">Участие добровольное. Команда увидит только допустимые общие показатели.</p>
          {snapshot.round.closedAt ? <p>Раунд завершён. Новый чек-ин станет доступен в следующем раунде.</p> : <><p className="status">{snapshot.round.mySubmitted ? 'Ваш чек-ин сохранён. Можно выбрать три оценки заново и заменить его.' : 'Выберите ответ на каждый вопрос.'}</p>
            <form key={snapshot.round.id} onSubmit={event => { event.preventDefault(); const values = new FormData(event.currentTarget); void perform('/checkins', { roundId: snapshot.round.id, scores: { energy: Number(values.get('energy')), clarity: Number(values.get('clarity')), support: Number(values.get('support')) } }, 'Чек-ин сохранён. Повторный ответ заменяет предыдущий.') }}><fieldset disabled={busy}>
              {([['energy','Сколько сил на работу?','Почти нет сил','Много сил'],['clarity','Понятно, что сейчас главное?','Непонятно','Полностью понятно'],['support','Легко попросить помощи?','Трудно','Легко']] as const).map(([key,label,low,high]) => <label className="team-field" key={key}>{label}<select name={key} required defaultValue=""><option value="" disabled>Выберите оценку</option>{[1,2,3,4,5].map(n => <option key={n} value={n}>{n}{n === 1 ? ' — ' + low : n === 5 ? ' — ' + high : ''}</option>)}</select></label>)}
              <button className="button" type="submit">{busy ? 'Сохраняем…' : 'Сохранить чек-ин'}</button></fieldset>
            </form></>}
        </section>
        {snapshot.member.role === 'organizer' && <section className="panel"><h2>Пригласить участника</h2><p className="muted">Каждая ссылка действует 24 часа и используется один раз. Создавайте отдельное приглашение для каждого человека.</p><button className="button secondary" disabled={busy} onClick={() => void issueInvite()}>Создать приглашение</button>{inviteLink && <><label className="team-field">Ссылка для одного участника<input readOnly value={inviteLink} onFocus={event => event.currentTarget.select()}/></label><button className="text-button" onClick={() => { void navigator.clipboard.writeText(inviteLink).then(() => setNotice('Приглашение скопировано.'), () => setNotice('Выделите ссылку и скопируйте её вручную.')) }}>Скопировать ссылку</button></>}</section>}
        <section className="panel"><h2>Вернуться с другого устройства</h2><p className="muted">Сохраните личный код входа. Он действует 30 дней и сохраняет ваши права и участие. Новый код заменяет предыдущий.</p><button className="button secondary" disabled={busy} onClick={() => void createAccessKey()}>Создать личный код входа</button>{accessKey && <label className="team-field">Ваш личный код<input value={accessKey} readOnly onFocus={event => event.currentTarget.select()}/></label>}</section>
        <div className="note"><strong>Приватность в небольших командах</strong><p>При четырёх участниках статистика скрыта. Добровольные упражнения остаются доступны. Сессия привязана к этому браузеру на семь дней.</p></div>
      </aside></div>
    </>}
  </section>
}
