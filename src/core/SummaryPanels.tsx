import { useCallback, useEffect, useState } from 'react'
import { api } from './client'
import type { CommunicationRecommendation, CommunicationView } from './telegram'
import { ActionRecommendationCard } from '../features/actions/ActionRecommendationCard'
import { TeamPulse, pulsePeriodLabel } from '../features/insights/TeamPulse'
import { RequestError } from './RequestError'
import './SummaryPanels.css'

export function SummaryPanels({ onLogin, refreshKey = 0 }: { onLogin?: () => void; refreshKey?: number }) {
  const [view, setView] = useState<CommunicationView | null>(null)
  const [bindingId, setBindingId] = useState<string | null>(null)
  const [recommendation, setRecommendation] = useState<CommunicationRecommendation | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [recommendationError, setRecommendationError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [retryingSummary, setRetryingSummary] = useState(false)
  const [recommendationLoading, setRecommendationLoading] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [recommendationAttempt, setRecommendationAttempt] = useState(0)
  const historyUnavailable = useCallback((next: CommunicationView | null, failure?: unknown) => {
    setView(next)
    setRecommendation(null)
    setBindingId(null)
    if (failure) setError(failure)
  }, [])

  useEffect(() => {
    let active = true
    void api<{ bindingId: string | null; view: CommunicationView }>('/telegram/summary?includeBinding=1').then(
      result => {
        if (!active) return
        // Keep the same reference when nothing changed, so the weekly history is not reset on every refresh.
        setView(previous => previous && JSON.stringify(previous) === JSON.stringify(result.view) ? previous : result.view)
        setBindingId(result.bindingId)
        setError(null)
      },
      failure => { if (active) { setView(null); setBindingId(null); setError(failure) } },
    ).finally(() => { if (active) { setLoading(false); setRetryingSummary(false) } })
    return () => { active = false }
  }, [attempt, refreshKey])

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
    <TeamPulse bindingId={bindingId} onHistoryUnavailable={historyUnavailable} view={view} loading={loading} error={error} onLogin={onLogin} retrying={retryingSummary} onRetry={() => {
      setLoading(true)
      setRetryingSummary(true)
      setError(null)
      setView(null)
      setBindingId(null)
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
