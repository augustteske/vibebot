import { useEffect, useRef, useState } from 'react'
import './InviteModal.css'

function UserPlusIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
    <circle cx="8.5" cy="7" r="4"/>
    <line x1="20" y1="8" x2="20" y2="14"/>
    <line x1="23" y1="11" x2="17" y2="11"/>
  </svg>
}

interface InviteModalProps {
  roomKey?: string | null;
  onIssueInvite?: () => Promise<string | void>;
  inviteLink?: string;
  triggerClassName?: string;
}

export function InviteColleagueButton({ roomKey, onIssueInvite, inviteLink: externalInviteLink = '', triggerClassName }: InviteModalProps) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState('')
  const [generating, setGenerating] = useState(false)
  const [generatedLink, setGeneratedLink] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  const activeInviteLink = generatedLink || externalInviteLink

  function close() {
    setOpen(false)
    triggerRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKeyDown(event: KeyboardEvent) { if (event.key === 'Escape') close() }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  async function handleCreateInvite() {
    if (!onIssueInvite || generating) return
    setGenerating(true)
    setStatus('')
    try {
      const link = await onIssueInvite()
      if (typeof link === 'string') setGeneratedLink(link)
      setStatus('Одноразовая ссылка на 24 часа создана.')
    } catch {
      setStatus('Не удалось создать ссылку-приглашение.')
    } finally {
      setGenerating(false)
    }
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text)
      setStatus(`${label} скопирован в буфер обмена.`)
    } catch {
      setStatus(`Выделите ${label.toLowerCase()} и скопируйте его вручную.`)
    }
  }

  return <>
    <button
      type="button"
      className={triggerClassName || 'button secondary invite-colleague-trigger'}
      ref={triggerRef}
      onClick={() => { setOpen(true); setStatus('') }}
    >
      <UserPlusIcon/> Пригласить коллегу
    </button>
    {open && <div className="invite-modal-overlay" onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
      <div className="invite-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="invite-modal-title">
        <div className="invite-modal-dialog__head">
          <div>
            <h2 id="invite-modal-title">Пригласить коллегу в команду</h2>
            <p className="muted">Передайте ключ комнаты для быстрого входа или создайте персональную ссылку.</p>
          </div>
          <button type="button" className="invite-modal-dialog__close" aria-label="Закрыть" ref={closeRef} onClick={close}>×</button>
        </div>

        {roomKey && <div className="invite-modal-section">
          <label className="team-field" htmlFor="invite-room-key-field">
            <strong>Ключ комнаты (быстрый вход)</strong>
            <span className="muted">Коллега вводит этот 8-значный код на главной странице:</span>
            <div className="invite-modal-row">
              <input
                id="invite-room-key-field"
                readOnly
                value={roomKey}
                onFocus={event => event.currentTarget.select()}
              />
              <button
                type="button"
                className="button"
                onClick={() => void copyText(roomKey, 'Ключ комнаты')}
              >
                Скопировать ключ
              </button>
            </div>
          </label>
        </div>}

        <div className="invite-modal-section">
          <strong>Одноразовая ссылка</strong>
          <span className="muted">Действует 24 часа для одного участника.</span>
          {activeInviteLink ? <div className="invite-modal-row">
            <input
              readOnly
              value={activeInviteLink}
              onFocus={event => event.currentTarget.select()}
            />
            <button
              type="button"
              className="button secondary"
              onClick={() => void copyText(activeInviteLink, 'Ссылка')}
            >
              Скопировать ссылку
            </button>
          </div> : onIssueInvite ? <div className="invite-modal-actions">
            <button
              type="button"
              className="button secondary"
              disabled={generating}
              onClick={() => void handleCreateInvite()}
            >
              {generating ? 'Создаём…' : 'Сгенерировать ссылку'}
            </button>
          </div> : null}
        </div>

        {status && <p className="invite-modal-status" role="status">{status}</p>}

        <div className="invite-modal-footer">
          <button type="button" className="button secondary" onClick={close}>Закрыть</button>
        </div>
      </div>
    </div>}
  </>
}
