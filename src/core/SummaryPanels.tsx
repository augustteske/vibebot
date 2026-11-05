import { useEffect, useState } from 'react'
import { api } from './client'
import type { CommunicationRecommendation, CommunicationView } from './telegram'
import { ActionRecommendationCard } from '../features/actions/ActionRecommendationCard'
import { TeamPulse, pulsePeriodLabel } from '../features/insights/TeamPulse'
import './SummaryPanels.css'

type TelegramSummaryResponse = {
  view: CommunicationView
  recommendation: CommunicationRecommendation | null
}

export function SummaryPanels() {
  const [result, setResult] = useState<TelegramSummaryResponse | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    void api<CommunicationView>('/telegram/summary').then(async view => ({
      view,
      recommendation: view.status === 'published'
        ? await api<CommunicationRecommendation>('/telegram/recommendation?periodId=' + encodeURIComponent(view.period.id))
        : null,
    })).then(
      response => { if (active) setResult(response) },
      failure => { if (active) setError(failure instanceof Error ? failure.message : 'Не удалось загрузить результаты') },
    ).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [attempt])

  const view = result?.view ?? null
  const recommendation = result?.recommendation
  return <div className="telegram-summary">
    <TeamPulse view={view} loading={loading} error={error} onRetry={() => {
      setLoading(true)
      setError('')
      setResult(null)
      setAttempt(value => value + 1)
    }}/>
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
