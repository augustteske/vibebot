import { useEffect, useId, useState } from 'react'
import type { CommunicationHistory, CommunicationView } from '../../core/telegram'
import { api, ApiError } from '../../core/client'
import { RequestError } from '../../core/RequestError'
import { InsightsWidget } from './InsightsWidget'
import './TeamPulse.css'

export function pulsePeriodLabel(view: { period: { start: string; end: string } }) {
  const format = (date: string) => new Date(date).toLocaleString('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Omsk',
  })
  return `${format(view.period.start)} — ${format(view.period.end)} (Омск)`
}

const explanations = {
  disconnected: 'История пока не собирается: нет активной привязки Telegram-чата.',
  paused: 'Сбор приостановлен. Показатели скрыты до возобновления с согласиями участников.',
  awaiting_consents: 'История пока не собирается: ожидается согласие всех участников.',
  calibrating: 'Показатели пока недоступны: настройка и калибровка не завершены.',
  open: 'Текущий период ещё собирается. Показатели появятся после его завершения, если данных будет достаточно.',
  insufficient: 'Недостаточно данных участников для публикации показателей. Отсутствие данных не означает ноль.',
  error: 'Анализ чата временно недоступен. Показатели скрыты.',
}

export function PulseHistory({ history }: { history: CommunicationHistory }) {
  return <>
    {history.demo && <p className="team-pulse__demo">Демо: вымышленные данные, не реальные сообщения команды.</p>}
    <p className="team-pulse__hint">Окно истории: {pulsePeriodLabel({ period: history.window })}</p>
    {history.status !== 'active' ? <p role="status">{explanations[history.status]}</p>
      : history.periods.length === 0 ? <p role="status">За последние 7 дней нет сохранённых закрытых периодов.</p>
      : <div className="team-pulse__history">{history.periods.map((period, index) => <article key={period.period.id}>
        {period.status === 'published' ? <details open={index === history.periods.length - 1}>
          <summary>{pulsePeriodLabel(period)}<span className="team-pulse__values">
            Вне графика: {period.metrics.outsideHoursPercent}% · Участие: {period.metrics.participationEvenness}% · Благодарности: {period.metrics.recognitionPercent}%
          </span></summary>
          <InsightsWidget state="published" metrics={period.metrics} periodLabel={pulsePeriodLabel(period)} demo={history.demo}/>
        </details> : <>
          <h3>{pulsePeriodLabel(period)}</h3>
          <p>{explanations[period.status]}</p>
        </>}
      </article>)}</div>}
  </>
}

export function TeamPulse({ bindingId = null, view, loading, error, onRetry, retrying = false, onLogin, onHistoryUnavailable }: {
  bindingId?: string | null
  view: CommunicationView | null
  loading: boolean
  error: unknown
  onRetry: () => void
  retrying?: boolean
  onLogin?: () => void
  onHistoryUnavailable?: (view: CommunicationView | null, error?: unknown) => void
}) {
  const id = useId()
  const [mode, setMode] = useState('current')
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{
    bindingId: string; view: CommunicationView; data?: CommunicationHistory; error?: unknown
  } | null>(null)
  const available = Boolean(bindingId && view && !loading && !error
    && ['published', 'open', 'calibrating', 'insufficient'].includes(view.status))
  useEffect(() => {
    setResult(null)
    if (mode !== 'week' || !available || !bindingId || !view) return
    let active = true
    void api<CommunicationHistory>('/telegram/bindings/' + encodeURIComponent(bindingId) + '/history').then(
      data => {
        if (!active) return
        if (data.status !== 'active') onHistoryUnavailable?.({ status: data.status })
        setResult({ bindingId, view, data })
      },
      failure => {
        if (!active) return
        if (failure instanceof ApiError && [401, 403, 404].includes(failure.status)) onHistoryUnavailable?.(null, failure)
        setResult({ bindingId, view, error: failure })
      },
    )
    return () => { active = false }
  }, [mode, available, bindingId, view, attempt, onHistoryUnavailable])
  // Do not paint a previous binding/view even before effect cleanup has run.
  const current = available && result?.bindingId === bindingId && result.view === view ? result : null
  const history = current?.data
  return <section className="panel team-pulse" aria-labelledby={`${id}-title`}>
    <div className="team-pulse__header">
      <h2 id={`${id}-title`}>Пульс команды</h2>
      <label className="team-pulse__period">Период
        <select value={mode} onChange={event => { setResult(null); setMode(event.target.value) }} aria-describedby={`${id}-history`}>
          <option value="current">Текущая сводка</option>
          <option value="week">Неделя</option>
          <option value="month" disabled>Месяц — недоступно</option>
        </select>
      </label>
    </div>
    <p className="team-pulse__hint" id={`${id}-history`}>{mode === 'week'
      ? 'Закрытые периоды за последние 168 часов. Пропуски не означают ноль; общий недельный процент не рассчитывается.'
      : 'Текущая сводка или история за неделю. Месячная история пока недоступна.'}</p>
    {loading ? <p role="status">{retrying ? 'Повторяем запрос сводки…' : 'Загружаем текущую сводку…'}</p> : error ? <>
      <RequestError error={error} action="Просматривать сводку может только организатор." onRetry={onRetry} retrying={retrying} onLogin={onLogin}/>
    </> : mode === 'week' && available ? <>
      {current?.error ? <RequestError error={current.error} onLogin={onLogin} onRetry={() => {
        setResult(null); setAttempt(value => value + 1)
      }}/> : !history ? <p role="status">Загружаем историю…</p> : <PulseHistory history={history}/>}
    </> : view?.status === 'published' ? <>
      <p>Данные доступны за опубликованный период. Это текущая сводка, а не итог за неделю или месяц.</p>
      {view.demo && <p className="team-pulse__demo">Демо: вымышленные данные, не реальные сообщения команды.</p>}
      <InsightsWidget state="published" metrics={view.metrics} periodLabel={pulsePeriodLabel(view)} demo={view.demo}/>
    </> : view && <p role="status">{explanations[view.status]}</p>}
  </section>
}
