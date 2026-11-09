import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './client'
import { RequestError } from './RequestError'
import './SystemHealthPanel.css'

export interface SystemHealthData {
  status: 'ok' | 'idle' | 'offline' | 'error' | 'disconnected'
  botOnline: boolean
  processed24h: number
  lastEventAt: string | null
  lastError: string | null
  checkedAt: string
}

function formatMessagesWord(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod100 >= 11 && mod100 <= 19) return 'сообщений'
  if (mod10 === 1) return 'сообщение'
  if (mod10 >= 2 && mod10 <= 4) return 'сообщения'
  return 'сообщений'
}

function formatTime(iso: string): string {
  try {
    const date = new Date(iso)
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) + ', ' +
      date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
  } catch {
    return iso
  }
}

export function SystemHealthPanel({ onLogin, className = '' }: { onLogin?: () => void; className?: string }) {
  const [data, setData] = useState<SystemHealthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [isOpen, setIsOpen] = useState(false)
  const loadingRef = useRef(false)

  const load = useCallback(async () => {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    setError(null)
    try {
      const res = await api<SystemHealthData>('/telegram/system-health')
      setData(res)
      setError(null)
    } catch (err) {
      setError(err)
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    // Периодическое обновление раз в минуту
    const timer = window.setInterval(() => {
      if (!document.hidden) void load()
    }, 60000)
    return () => window.clearInterval(timer)
  }, [load])

  const botOnline = data?.botOnline ?? false
  const processedCount = data?.processed24h ?? 0
  const lastError = data?.lastError ?? null

  return (
    <details
      className={`panel system-health-panel ${className}`}
      open={isOpen}
      onToggle={(e) => setIsOpen(e.currentTarget.open)}
    >
      <summary className="system-health-panel__summary">
        <div className="system-health-panel__title-group">
          <span className="system-health-panel__icon" aria-hidden="true">📡</span>
          <strong>Состояние бота</strong>
          <span
            className={`system-health-pill ${botOnline ? 'system-health-pill--online' : 'system-health-pill--offline'}`}
          >
            {botOnline ? '🟢 Работает' : '🔴 Офлайн'}
          </span>
        </div>
        <div className="system-health-panel__summary-meta">
          <span className="system-health-panel__quick-stat">
            {processedCount} {formatMessagesWord(processedCount)} за 24 ч
          </span>
          <span className="system-health-panel__chevron" aria-hidden="true">▾</span>
        </div>
      </summary>

      <div className="system-health-panel__content">
        {error ? (
          <div className="system-health-panel__error">
            <RequestError
              error={error}
              action="Не удалось запросить состояние бота."
              onRetry={() => void load()}
              retrying={loading}
              onLogin={onLogin}
            />
          </div>
        ) : loading && !data ? (
          <p className="muted system-health-panel__loading">Проверяем статус бота…</p>
        ) : (
          <>
            <div className="system-health-grid">
              {/* 1. Карточка статуса бота */}
              <div className={`system-health-card ${botOnline ? 'system-health-card--ok' : 'system-health-card--alert'}`}>
                <span className="system-health-card__label">Статус бота</span>
                <div className="system-health-card__value">
                  {botOnline ? 'Бот: 🟢 Работает' : 'Бот: 🔴 Офлайн'}
                </div>
                <p className="system-health-card__hint muted">
                  {botOnline
                    ? 'Принимает сообщения и чек-ины команды'
                    : lastError || 'Событий за 24 ч не зафиксировано'}
                </p>
              </div>

              {/* 2. Обработано сообщений за 24ч */}
              <div className="system-health-card">
                <span className="system-health-card__label">Активность</span>
                <div className="system-health-card__value system-health-card__value--number">
                  {processedCount}
                </div>
                <p className="system-health-card__hint muted">
                  {formatMessagesWord(processedCount)} за последние 24 часа
                </p>
              </div>

              {/* 3. Статус ошибок */}
              <div className={`system-health-card ${lastError ? 'system-health-card--alert' : 'system-health-card--ok'}`}>
                <span className="system-health-card__label">Диагностика</span>
                <div className="system-health-card__value">
                  {lastError ? (
                    <span className="system-health-error-text">⚠️ Ошибка</span>
                  ) : (
                    <span className="system-health-ok-text">🟢 Ошибок нет</span>
                  )}
                </div>
                <p className="system-health-card__hint muted">
                  {lastError ? lastError : 'Все сервисы работают штатно'}
                </p>
              </div>
            </div>

            <div className="system-health-footer">
              <span className="system-health-footer__timestamp muted">
                {data?.lastEventAt
                  ? `Последнее событие: ${formatTime(data.lastEventAt)}`
                  : 'Событий пока не поступало'}
              </span>
              <button
                type="button"
                className="button secondary system-health-panel__refresh-btn"
                onClick={() => void load()}
                disabled={loading}
              >
                {loading ? 'Проверяем…' : 'Проверить сейчас'}
              </button>
            </div>
          </>
        )}
      </div>
    </details>
  )
}
