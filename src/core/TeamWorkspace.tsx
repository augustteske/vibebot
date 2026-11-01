import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError } from './client'
import type { SessionSnapshot } from './contracts'
import './team.css'

const labels = { energy: 'Ресурс', clarity: 'Ясность', support: 'Поддержка' }
const dateLabel = (date: string) => new Date(date).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Omsk' })
const initialToken = () => new URLSearchParams(window.location.hash.slice(1)).get('invite') ?? ''
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
  const requestVersion = useRef(0)
  const busyRef = useRef(false)
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
