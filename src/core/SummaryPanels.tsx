import { useEffect, useState } from 'react'
import { api } from './client'
import type { CommunicationRecommendation, CommunicationView } from './telegram'
import { ActionRecommendationCard } from '../features/actions/ActionRecommendationCard'
import { TeamPulse, pulsePeriodLabel } from '../features/insights/TeamPulse'
import { RequestError } from './RequestError'
import './SummaryPanels.css'

export function SummaryPanels({ onLogin }: { onLogin?: () => void }) {
  const [view, setView] = useState<CommunicationView | null>(null)
  const [recommendation, setRecommendation] = useState<CommunicationRecommendation | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [recommendationError, setRecommendationError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [retryingSummary, setRetryingSummary] = useState(false)
  const [recommendationLoading, setRecommendationLoading] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [recommendationAttempt, setRecommendationAttempt] = useState(0)

  useEffect(() => {
    let active = true
    void api<CommunicationView>('/telegram/summary').then(
      result => { if (active) { setView(result); setError(null) } },
      failure => { if (active) setError(failure) },
    ).finally(() => { if (active) { setLoading(false); setRetryingSummary(false) } })
    return () => { active = false }
  }, [attempt])

  useEffect(() => {
    if (view?.status !== 'published') { setRecommendation(null); setRecommendationError(null); return }
    let active = true
    setRecommendation(null)
    setRecommendationError(null)
    setRecommendationLoading(true)
    void api<CommunicationRecommendation>('/telegram/recommendation?periodId=' + encodeURIComponent(view.period.id)).then(
      result => { if (active) setRecommendation(result) },
      failure => { if (active) setRecommendationError(failure) },
    ).finally(() => { if (active) setRecommendationLoading(false) })
    return () => { active = false }
  }, [view?.status === 'published' ? view.period.id : '', recommendationAttempt])

  return <div className="telegram-summary">
    <TeamPulse view={view} loading={loading} error={error} onLogin={onLogin} retrying={retryingSummary} onRetry={() => {
      setLoading(true)
      setRetryingSummary(true)
      setError(null)
      setView(null)
      setAttempt(value => value + 1)
    }}/>
    {view?.status === 'published' && recommendationLoading && <p role="status">Загружаем рекомендацию…</p>}
    {view?.status === 'published' && !!recommendationError && <RequestError error={recommendationError} action="Просматривать рекомендацию может только организатор." onLogin={onLogin} onRetry={() => {
      setRecommendationError(null)
      setRecommendationLoading(true)
      setRecommendationAttempt(value => value + 1)
    }} retrying={recommendationLoading}/>}
    {view?.status === 'published' && recommendation &&
    <ActionRecommendationCard
      observation={recommendation.observation}
      explanation={recommendation.explanation}
      limitation={recommendation.limitation}
      metrics={{
        outsideHoursPercent: view.metrics.outsideHoursPercent,
        participationEvenness: view.metrics.participationEvenness,
      }}
      suggestedAction={recommendation.action}
      dataSource={recommendation.dataSource}
      generationSource={recommendation.source}
      periodLabel={pulsePeriodLabel(view)}
      demo={recommendation.demo ?? false}
    />}
  </div>
}
