import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError } from './client'
import './feedback-modal.css'

const feedbackTypes = [
  { value: 'bug', label: 'Ошибка' },
  { value: 'idea', label: 'Идея' },
  { value: 'other', label: 'Другое' },
] as const

type FeedbackType = (typeof feedbackTypes)[number]['value']

const MESSAGE_MIN = 3
const MESSAGE_MAX = 2000

/** Кнопка в подвале и модальное окно для отзыва: ошибка, идея или другое. */
export function FeedbackModal() {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<FeedbackType>('bug')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const firstFieldRef = useRef<HTMLSelectElement>(null)

  const canSubmit = message.trim().length >= MESSAGE_MIN && !sending

  function openDialog() {
    setSent(false)
    setError('')
    setOpen(true)
  }

  function closeDialog() {
    setOpen(false)
    triggerRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    firstFieldRef.current?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeDialog()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = message.trim()
    if (trimmed.length < MESSAGE_MIN || sending) return
    setSending(true)
    setError('')
    try {
      await api<{ id: string }>('/feedback', { type, message: trimmed })
      setSent(true)
      setMessage('')
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Не удалось отправить отзыв. Попробуйте ещё раз.')
    } finally {
      setSending(false)
    }
  }

  return <>
    <button type="button" className="text-button feedback-trigger" ref={triggerRef} onClick={openDialog}>
      Обратная связь
    </button>
    {open && <div className="feedback-overlay" onMouseDown={event => { if (event.target === event.currentTarget) closeDialog() }}>
      <div className="feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
        <div className="feedback-dialog__head">
          <h2 id="feedback-title">Обратная связь</h2>
          <button type="button" className="feedback-dialog__close" aria-label="Закрыть" onClick={closeDialog}>×</button>
        </div>
        {sent ? <div className="feedback-dialog__done">
          <p role="status">Спасибо! Отзыв сохранён — мы его прочитаем.</p>
          <button type="button" className="button" onClick={closeDialog}>Закрыть</button>
        </div> : <form onSubmit={event => void submit(event)}>
          <p className="muted">Расскажите, что сломалось или чего не хватает. Без входа в пространство.</p>
          <label className="team-field">Тип обращения
            <select ref={firstFieldRef} value={type} onChange={event => setType(event.target.value as FeedbackType)} disabled={sending}>
              {feedbackTypes.map(item => <option value={item.value} key={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label className="team-field">Описание
            <textarea value={message} onChange={event => setMessage(event.target.value)} maxLength={MESSAGE_MAX} rows={5} required placeholder="Что вы делали, что произошло и что ожидали" disabled={sending}/>
          </label>
          <p className="feedback-dialog__counter muted">{message.length} / {MESSAGE_MAX}</p>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="button-row">
            <button type="submit" className="button" disabled={!canSubmit}>{sending ? 'Отправляем…' : 'Отправить'}</button>
            <button type="button" className="button secondary" onClick={closeDialog} disabled={sending}>Отмена</button>
          </div>
        </form>}
      </div>
    </div>}
  </>
}
