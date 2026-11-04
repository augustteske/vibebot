import { useEffect, useState } from 'react'
import { api } from './client'
import type { CommunicationRecommendation, CommunicationView } from './telegram'
import { ActionRecommendationCard } from '../features/actions/ActionRecommendationCard'
import { InsightsWidget } from '../features/insights/InsightsWidget'
import './SummaryPanels.css'

type TelegramSummaryResponse = {
  view: CommunicationView
  recommendation: CommunicationRecommendation | null
}

const periodLabel = (view: Extract<CommunicationView, { status: 'published' }>) => {
  const format = (date: string) => new Date(date).toLocaleString('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Omsk',
  })
  return `${format(view.period.start)} — ${format(view.period.end)}`
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

  if (loading) return <section className="panel"><p role="status">Загружаем аналитику чата…</p></section>
  if (error) return <section className="panel" aria-labelledby="telegram-summary-error-title">
    <h2 id="telegram-summary-error-title">Не удалось загрузить аналитику чата</h2>
    <p className="error" role="alert">{error}</p>
    <button className="button secondary" onClick={() => {
      setLoading(true)
      setError('')
      setResult(null)
      setAttempt(value => value + 1)
    }}>Повторить</button>
  </section>
  if (!result) return null

  const { view, recommendation } = result
  if (view.status === 'disconnected' || view.status === 'paused') {
    return <section className="panel telegram-summary-state"><h2>Нет активной привязки</h2></section>
  }
  if (view.status === 'calibrating' || view.status === 'insufficient') {
    return <section className="telegram-summary-state telegram-summary-state--calibrating">
      <h2>Идет калибровка</h2>
      <p>Показатели появятся, когда накопится достаточно данных.</p>
    </section>
  }
  if (view.status === 'awaiting_consents') {
    return <section className="panel telegram-summary-state"><h2>Ожидается согласие участников</h2></section>
  }
  if (view.status === 'open') {
    return <section className="panel telegram-summary-state"><h2>Период еще собирается</h2></section>
  }
  if (view.status === 'error') {
    return <section className="panel telegram-summary-state" role="alert"><h2>Анализ чата временно недоступен</h2></section>
  }
  if (view.status !== 'published') return null
  const metrics = {
    outsideHoursPercent: view.metrics.outsideHoursPercent,
    participationEvenness: view.metrics.participationEvenness,
    recognitionPercent: view.metrics.recognitionPercent,
  }
  if (!recommendation) {
    return <section className="panel telegram-summary-state" role="alert">
      <h2>Рекомендация для периода недоступна</h2>
      <InsightsWidget state="published" metrics={metrics} periodLabel={periodLabel(view)} demo={view.demo}/>
    </section>
  }

  return <div className="telegram-summary">
    <InsightsWidget state="published" metrics={metrics} periodLabel={periodLabel(view)} demo={view.demo}/>
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
      periodLabel={periodLabel(view)}
      demo={recommendation.demo ?? false}
    />
  </div>
}
