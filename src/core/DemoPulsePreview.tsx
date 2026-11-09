import { useState } from 'react'
import { useLanguage } from './i18n'
import './onboarding.css'

export interface DemoPulsePreviewProps {
  onConnectBot?: () => void
}

export function DemoPulsePreview({ onConnectBot }: DemoPulsePreviewProps) {
  const { t } = useLanguage()
  const [collapsed, setCollapsed] = useState(false)

  function handleConnect() {
    if (onConnectBot) {
      onConnectBot()
    } else {
      window.location.href = '/guide'
    }
  }

  if (collapsed) {
    return (
      <section className="panel demo-pulse-preview demo-pulse-preview--collapsed">
        <div className="demo-pulse-preview__collapsed-row">
          <span className="demo-pulse-badge">{t.onboarding.demoBadge}</span>
          <span className="demo-pulse-preview__collapsed-title">{t.onboarding.demoCardTitle}</span>
          <button
            type="button"
            className="text-button demo-pulse-toggle"
            onClick={() => setCollapsed(false)}
          >
            {t.onboarding.showDemoButton}
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="panel demo-pulse-preview" aria-labelledby="demo-pulse-preview-title">
      <div className="demo-pulse-preview__header">
        <div>
          <div className="demo-pulse-preview__title-row">
            <span className="demo-pulse-badge">{t.onboarding.demoBadge}</span>
            <h2 id="demo-pulse-preview-title">{t.onboarding.demoCardTitle}</h2>
          </div>
          <p className="muted demo-pulse-preview__subtitle">
            {t.onboarding.demoCardSubtitle}
          </p>
        </div>
        <button
          type="button"
          className="text-button demo-pulse-toggle"
          onClick={() => setCollapsed(true)}
          aria-label={t.onboarding.hideDemoButton}
        >
          {t.onboarding.hideDemoButton}
        </button>
      </div>

      <div className="demo-pulse-preview__metrics">
        <article className="demo-metric-card">
          <span className="demo-metric-card__icon" aria-hidden="true">🌙</span>
          <strong className="demo-metric-card__value">14%</strong>
          <span className="demo-metric-card__label">{t.onboarding.metricOutsideHours}</span>
          <small className="demo-metric-card__note">{t.onboarding.metricOutsideHoursNote}</small>
        </article>

        <article className="demo-metric-card">
          <span className="demo-metric-card__icon" aria-hidden="true">⚖️</span>
          <strong className="demo-metric-card__value">82%</strong>
          <span className="demo-metric-card__label">{t.onboarding.metricParticipation}</span>
          <small className="demo-metric-card__note">{t.onboarding.metricParticipationNote}</small>
        </article>

        <article className="demo-metric-card">
          <span className="demo-metric-card__icon" aria-hidden="true">💛</span>
          <strong className="demo-metric-card__value">28%</strong>
          <span className="demo-metric-card__label">{t.onboarding.metricRecognition}</span>
          <small className="demo-metric-card__note">{t.onboarding.metricRecognitionNote}</small>
        </article>

        <article className="demo-metric-card">
          <span className="demo-metric-card__icon" aria-hidden="true">☀️</span>
          <strong className="demo-metric-card__value">4.2 <small>/5</small></strong>
          <span className="demo-metric-card__label">{t.onboarding.metricEnergy}</span>
          <small className="demo-metric-card__note">{t.onboarding.metricEnergyNote}</small>
        </article>
      </div>

      <div className="demo-pulse-callout">
        <div className="demo-pulse-callout__copy">
          <span className="demo-pulse-callout__mascot" aria-hidden="true">🐝</span>
          <p className="demo-pulse-callout__text">
            {t.onboarding.demoHint}
          </p>
        </div>
        <button
          type="button"
          className="button demo-pulse-callout__cta"
          onClick={handleConnect}
        >
          {t.onboarding.connectBotButton} <span aria-hidden="true">↗</span>
        </button>
      </div>
    </section>
  )
}
