import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from './client'
import { RequestError } from './RequestError'
import './LeaderMessagesPanel.css'

export interface LeaderMessage {
  id: string
  workspaceId: string
  message: string
  isAnonymous: boolean
  author: string
  memberId: string | null
  status: 'new' | 'read' | 'replied'
  reply: string | null
  repliedAt: string | null
  createdAt: string
}

function formatDate(iso: string): string {
  try {
    const date = new Date(iso)
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) + ', ' +
      date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
  } catch {
    return iso
  }
}

export function LeaderMessagesPanel({ onLogin, className = '' }: { onLogin?: () => void; className?: string }) {
  const [messages, setMessages] = useState<LeaderMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [replyTextMap, setReplyTextMap] = useState<Record<string, string>>({})
  const [submittingId, setSubmittingId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'new' | 'replied'>('all')
  const loadingRef = useRef(false)

  const load = useCallback(async () => {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    setError(null)
    try {
      const res = await api<LeaderMessage[]>('/messages')
      setMessages(Array.isArray(res) ? res : [])
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
  }, [load])

  const handleMarkAsRead = async (id: string) => {
    setSubmittingId(id)
    try {
      const updated = await api<LeaderMessage>(`/messages/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'read' }),
      })
      setMessages(prev => prev.map(m => (m.id === id ? updated : m)))
    } catch (err) {
      setError(err)
    } finally {
      setSubmittingId(null)
    }
  }

  const handleSendReply = async (event: FormEvent, id: string) => {
    event.preventDefault()
    const text = replyTextMap[id]?.trim()
    if (!text) return
    setSubmittingId(id)
    try {
      const updated = await api<LeaderMessage>(`/messages/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ reply: text }),
      })
      setMessages(prev => prev.map(m => (m.id === id ? updated : m)))
      setReplyTextMap(prev => ({ ...prev, [id]: '' }))
    } catch (err) {
      setError(err)
    } finally {
      setSubmittingId(null)
    }
  }

  const newCount = messages.filter(m => m.status === 'new').length

  const filteredMessages = messages.filter(m => {
    if (filter === 'new') return m.status === 'new'
    if (filter === 'replied') return m.status === 'replied'
    return true
  })

  return (
    <section className={`panel leader-messages-panel ${className}`} aria-labelledby="leader-messages-heading">
      <div className="leader-messages-panel__header">
        <div className="leader-messages-panel__title-box">
          <span className="leader-messages-panel__icon" aria-hidden="true">✉️</span>
          <h2 id="leader-messages-heading" className="leader-messages-panel__title">
            Обращения к тимлиду
          </h2>
          {newCount > 0 && (
            <span className="leader-messages-panel__counter" title="Новые обращения">
              {newCount}
            </span>
          )}
        </div>
        <div className="leader-messages-panel__actions">
          <div className="leader-messages-panel__filters" role="tablist">
            <button
              type="button"
              className={`leader-messages-panel__tab ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
            >
              Все ({messages.length})
            </button>
            <button
              type="button"
              className={`leader-messages-panel__tab ${filter === 'new' ? 'active' : ''}`}
              onClick={() => setFilter('new')}
            >
              Новые ({newCount})
            </button>
            <button
              type="button"
              className={`leader-messages-panel__tab ${filter === 'replied' ? 'active' : ''}`}
              onClick={() => setFilter('replied')}
            >
              С ответом
            </button>
          </div>
          <button
            type="button"
            className="button secondary leader-messages-panel__refresh"
            onClick={() => void load()}
            disabled={loading}
            title="Обновить список обращений"
          >
            {loading ? '…' : '↻'}
          </button>
        </div>
      </div>

      <p className="leader-messages-panel__desc muted">
        Прямой канал связи с командой. Участники могут писать открыто или анонимно через Telegram-бота.
      </p>

      {error ? (
        <div className="error" role="alert">
          <RequestError error={error} onLogin={onLogin} />
          <button type="button" className="button secondary" onClick={() => void load()} style={{ marginTop: 8 }}>
            Повторить
          </button>
        </div>
      ) : loading && messages.length === 0 ? (
        <p className="muted" role="status">Загрузка обращений…</p>
      ) : filteredMessages.length === 0 ? (
        <div className="leader-messages-panel__empty">
          <p className="muted">
            {filter === 'new'
              ? 'Новых обращений нет.'
              : filter === 'replied'
              ? 'Отвеченных обращений пока нет.'
              : 'Обращений пока нет. Когда коллеги отправят сообщение боту, оно появится здесь.'}
          </p>
        </div>
      ) : (
        <div className="leader-messages-list">
          {filteredMessages.map(msg => (
            <article key={msg.id} className={`leader-message-card status-${msg.status}`}>
              <div className="leader-message-card__header">
                <div className="leader-message-card__meta">
                  <span className={`leader-message-card__badge ${msg.isAnonymous ? 'anon' : 'author'}`}>
                    {msg.isAnonymous ? '🕶️ Аноним' : `👤 ${msg.author}`}
                  </span>
                  <span className={`leader-message-card__status status-${msg.status}`}>
                    {msg.status === 'new' ? 'Новое' : msg.status === 'replied' ? 'Отвечено' : 'Прочитано'}
                  </span>
                </div>
                <time className="leader-message-card__date muted" dateTime={msg.createdAt}>
                  {formatDate(msg.createdAt)}
                </time>
              </div>

              <div className="leader-message-card__content">
                <p className="leader-message-card__text">{msg.message}</p>
              </div>

              {msg.reply && (
                <div className="leader-message-card__reply">
                  <div className="leader-message-card__reply-header">
                    <strong>Ваш ответ:</strong>
                    {msg.repliedAt && <time className="muted">{formatDate(msg.repliedAt)}</time>}
                  </div>
                  <p className="leader-message-card__reply-text">{msg.reply}</p>
                </div>
              )}

              <div className="leader-message-card__footer">
                {msg.status === 'new' && (
                  <button
                    type="button"
                    className="button secondary leader-message-card__btn-read"
                    onClick={() => void handleMarkAsRead(msg.id)}
                    disabled={submittingId === msg.id}
                  >
                    Отметить прочитанным
                  </button>
                )}

                <form
                  className="leader-message-card__reply-form"
                  onSubmit={e => void handleSendReply(e, msg.id)}
                >
                  <input
                    type="text"
                    className="leader-message-card__input"
                    placeholder={msg.isAnonymous ? 'Ответить на обращение…' : `Ответить ${msg.author}…`}
                    value={replyTextMap[msg.id] ?? ''}
                    maxLength={1000}
                    onChange={e => setReplyTextMap(prev => ({ ...prev, [msg.id]: e.target.value }))}
                    disabled={submittingId === msg.id}
                  />
                  <button
                    type="submit"
                    className="button primary"
                    disabled={submittingId === msg.id || !replyTextMap[msg.id]?.trim()}
                  >
                    {submittingId === msg.id ? '…' : 'Ответить'}
                  </button>
                </form>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
