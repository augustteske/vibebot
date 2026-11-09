import { useState, useRef, useEffect } from 'react'
import type { FormEvent } from 'react'
import { api } from './client'
import type { SessionSnapshot } from './contracts'
import { useLanguage } from './i18n'
import './onboarding.css'

export interface QuickOnboardingModalProps {
  isOpen: boolean
  onClose: () => void
  onComplete: (workspace: { id: string; name: string; roomKey?: string }) => void
}

export function QuickOnboardingModal({ isOpen, onClose, onComplete }: QuickOnboardingModalProps) {
  const { t } = useLanguage()
  const [step, setStep] = useState<1 | 2>(1)
  const [teamName, setTeamName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [createdRoomKey, setCreatedRoomKey] = useState('')
  const [createdWorkspace, setCreatedWorkspace] = useState<{ id: string; name: string; roomKey?: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setStep(1)
      setTeamName('')
      setError('')
      setBusy(false)
      setCopied(false)
      setCreatedRoomKey('')
      setCreatedWorkspace(null)
      setTimeout(() => inputRef.current?.focus(), 80)
    }
  }, [isOpen])

  if (!isOpen) return null

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    const trimmed = teamName.trim()
    if (!trimmed) {
      setError('Пожалуйста, укажите название команды')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await api<SessionSnapshot>('/workspaces', {
        name: trimmed,
        displayName: 'Тимлид',
      })
      const roomKey = result.workspace.roomKey || ''
      setCreatedRoomKey(roomKey)
      setCreatedWorkspace(result.workspace)
      try {
        sessionStorage.setItem('vibee:onboarding-room', roomKey)
        sessionStorage.setItem('vibee:onboarding-active', 'true')
      } catch {}
      setStep(2)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Не удалось создать команду. Попробуйте еще раз.')
    } finally {
      setBusy(false)
    }
  }

  async function handleCopy() {
    if (!createdRoomKey) return
    try {
      await navigator.clipboard.writeText(createdRoomKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      // fallback
      setCopied(true)
    }
  }

  function handleFinish() {
    if (createdWorkspace) {
      onComplete(createdWorkspace)
    } else {
      onClose()
    }
  }

  return (
    <div className="onboarding-overlay" role="dialog" aria-modal="true" aria-labelledby="onboarding-modal-title">
      <div className="onboarding-backdrop" onClick={step === 1 ? onClose : undefined} />
      <div className="onboarding-card">
        {/* Header with progress */}
        <div className="onboarding-card__header">
          <div className="onboarding-progress">
            <div className="onboarding-progress__labels">
              <span className="onboarding-progress__badge">{t.onboarding.modalBadge}</span>
              <span className="onboarding-progress__step">
                {t.onboarding.stepProgress(step, 3)}: {step === 1 ? t.onboarding.step1Title : t.onboarding.step2Title}
              </span>
            </div>
            <div className="onboarding-progress__track" role="progressbar" aria-valuenow={step === 1 ? 33 : 66} aria-valuemin={0} aria-valuemax={100}>
              <div
                className="onboarding-progress__bar"
                style={{ width: step === 1 ? '33%' : '66%' }}
              />
            </div>
          </div>
          {step === 1 && (
            <button
              type="button"
              className="onboarding-close-btn"
              onClick={onClose}
              aria-label={t.onboarding.bannerDismiss}
            >
              ✕
            </button>
          )}
        </div>

        {/* Step 1: One field creation */}
        {step === 1 && (
          <div className="onboarding-step onboarding-step--1">
            <h2 id="onboarding-modal-title" className="onboarding-title">
              {t.onboarding.titleStep1}
            </h2>
            <p className="onboarding-subtitle">
              {t.onboarding.subtitleStep1}
            </p>

            <form onSubmit={handleCreate} className="onboarding-form">
              <div className="onboarding-field">
                <label htmlFor="onboarding-team-name">
                  {t.onboarding.teamNameLabel}
                </label>
                <input
                  id="onboarding-team-name"
                  ref={inputRef}
                  type="text"
                  value={teamName}
                  onChange={e => setTeamName(e.target.value)}
                  placeholder={t.onboarding.teamNamePlaceholder}
                  maxLength={80}
                  required
                  disabled={busy}
                  autoComplete="off"
                  className="onboarding-input"
                />
              </div>

              {error && (
                <div className="onboarding-error" role="alert">
                  {error}
                </div>
              )}

              <button
                type="submit"
                className="onboarding-btn-primary"
                disabled={busy || !teamName.trim()}
              >
                {busy ? t.onboarding.creatingButton : t.onboarding.createButton}
              </button>
            </form>
          </div>
        )}

        {/* Step 2: Room key presentation */}
        {step === 2 && (
          <div className="onboarding-step onboarding-step--2">
            <div className="onboarding-celebration">
              <span className="onboarding-celebration__icon" aria-hidden="true">🎉</span>
              <h2 id="onboarding-modal-title" className="onboarding-title">
                {t.onboarding.titleStep2}
              </h2>
            </div>
            <p className="onboarding-subtitle">
              {t.onboarding.instructionStep2}
            </p>

            <div className="onboarding-key-box">
              <span className="onboarding-key-box__label">{t.onboarding.roomKeyLabel}</span>
              <div className="onboarding-key-box__value">
                {createdRoomKey || '••••••••'}
              </div>
              <button
                type="button"
                className={'onboarding-key-box__copy' + (copied ? ' is-copied' : '')}
                onClick={handleCopy}
              >
                {copied ? t.onboarding.copiedButton : t.onboarding.copyButton}
              </button>
            </div>

            <p className="onboarding-bot-hint">
              <span className="onboarding-bot-hint__icon" aria-hidden="true">🐝</span>
              {t.onboarding.botHint}
            </p>

            <button
              type="button"
              className="onboarding-btn-primary"
              onClick={handleFinish}
            >
              {t.onboarding.openWorkspaceButton}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
