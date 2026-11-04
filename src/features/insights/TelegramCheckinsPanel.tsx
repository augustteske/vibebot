import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../core/client'

interface MetricStats {
  average: number
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>
}

export interface TelegramCheckinStats {
  status: 'visible' | 'hidden'
  total: number
  reason?: string
  metrics?: Record<'energy' | 'clarity' | 'support', MetricStats>
}

const labels = { energy: 'Ресурс', clarity: 'Ясность', support: 'Поддержка' } as const
const metricKeys = ['energy', 'clarity', 'support'] as const
const scoreKeys = ['1', '2', '3', '4', '5'] as const

function isTelegramCheckinStats(value: unknown): value is TelegramCheckinStats {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  if ((item.status !== 'visible' && item.status !== 'hidden') || typeof item.total !== 'number') return false
  if (item.status === 'hidden') return item.reason === 'insufficient_responses'
  if (!item.metrics || typeof item.metrics !== 'object') return false
  const metrics = item.metrics as Record<string, unknown>
  return metricKeys.every(key => {
    const metric = metrics[key] as Record<string, unknown> | undefined
    if (!metric || typeof metric.average !== 'number' || !metric.distribution) return false
    return scoreKeys.every(score => typeof (metric.distribution as Record<string, unknown>)[score] === 'number')
  })
}

export function TelegramCheckinsPanel() {
  const [stats, setStats] = useState<TelegramCheckinStats | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const result = await api<unknown>('/telegram-checkin-stats')
      if (!isTelegramCheckinStats(result)) throw new Error('Сервер вернул статистику в неожиданном формате.')
      setStats(result)
    } catch (failure) {
      setStats(null)
      setError(failure instanceof Error ? failure.message
        : failure instanceof ApiError ? 'Не удалось загрузить статистику' : 'Не удалось загрузить статистику')
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  return <details className="panel telegram-checkins">
    <summary>Чек-ины из Telegram <span className="muted">· анонимно</span></summary>
    <p className="muted">Агрегированные оценки из личных чек-инов бота. Ответы хранятся без привязки к аккаунтам; при менее пяти ответах показатели остаются скрытыми.</p>
    {loading ? <p role="status">Загружаем статистику…</p>
      : error ? <div className="error" role="alert">{error} <button type="button" onClick={() => void load()}>Повторить загрузку</button></div>
      : stats?.status === 'hidden' ? <p role="status">Пока недостаточно ответов ({stats.total} из 5). Показатели появятся, когда участники завершат больше чек-инов.</p>
      : stats?.metrics ? <>
        {metricKeys.map(key => {
          const metric = stats.metrics![key]
          const max = Math.max(1, ...scoreKeys.map(score => metric.distribution[score]))
          return <div className="metric-row" key={key}>
            <strong>{labels[key]} {metric.average.toFixed(1)}<small>/5</small></strong>
            <div className="metric-bars">{scoreKeys.map(score => <div className="metric-bar" key={score}
              title={`${score}: ${metric.distribution[score]}`}
              style={{ height: Math.round(100 * metric.distribution[score] / max) + '%' }}>
              <span>{score}</span>
            </div>)}</div>
          </div>
        })}
        <p className="muted">Всего ответов: {stats.total}</p>
      </>
      : null}
  </details>
}
