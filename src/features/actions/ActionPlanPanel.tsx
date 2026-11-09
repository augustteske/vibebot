import { useEffect, useId, useState } from 'react'
import type { ExtendedAnalyticsMetrics, MetricComparisonTrends } from '../../core/telegram'
import type { InsightsMetrics } from '../insights/InsightsWidget'
import { generateActionPlan } from './actionPlan'
import type { ActionPlanItem } from './actionPlan'
import './ActionPlanPanel.css'

export interface ActionPlanPanelProps {
  metrics: InsightsMetrics | null | undefined
  extendedMetrics?: ExtendedAnalyticsMetrics | null
  trends?: MetricComparisonTrends | null
  periodId?: string
  className?: string
}

const STORAGE_PREFIX = 'vibebot_action_plan_'

function getDifficultyLabel(diff: ActionPlanItem['difficulty']) {
  switch (diff) {
    case 'easy':
      return { text: 'Простой', badgeClass: 'app-diff--easy' }
    case 'medium':
      return { text: 'Средний', badgeClass: 'app-diff--medium' }
    case 'hard':
      return { text: 'Комплексный', badgeClass: 'app-diff--hard' }
  }
}

export function ActionPlanPanel({
  metrics,
  extendedMetrics,
  trends,
  periodId = 'default',
  className = '',
}: ActionPlanPanelProps) {
  const headingId = useId()
  const storageKey = `${STORAGE_PREFIX}${periodId}`

  const [seed, setSeed] = useState(0)
  const [completedMap, setCompletedMap] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      return saved ? JSON.parse(saved) : {}
    } catch {
      return {}
    }
  })

  // Synchronize with localStorage
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(completedMap))
    } catch {
      // localStorage might be disabled in sandboxed environments
    }
  }, [completedMap, storageKey])

  const planItems = generateActionPlan(
    metrics,
    trends ?? extendedMetrics?.trends,
    seed
  )

  const completedCount = planItems.filter(item => Boolean(completedMap[item.id])).length
  const totalCount = planItems.length
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0
  const allCompleted = totalCount > 0 && completedCount === totalCount

  const handleToggle = (id: string) => {
    setCompletedMap(prev => ({
      ...prev,
      [id]: !prev[id],
    }))
  }

  const handleRegenerate = () => {
    setSeed(s => s + 1)
  }

  return (
    <section className={`app-card ${className}`} aria-labelledby={headingId}>
      {/* Header with Title and Regenerate Button */}
      <div className="app-card__header">
        <div className="app-card__titles">
          <div className="app-card__badge">
            <span className="app-card__icon" aria-hidden="true">📋</span>
            <span>Интерактивный чек-лист</span>
          </div>
          <h3 id={headingId} className="app-card__title">
            План действий команды
          </h3>
          <p className="app-card__subtitle">
            Персональные практические шаги для улучшения командного климата на основе текущих сигналов.
          </p>
        </div>

        <button
          type="button"
          className="app-btn app-btn--secondary"
          onClick={handleRegenerate}
          title="Сгенерировать альтернативные шаги"
          aria-label="Сгенерировать новый план"
        >
          <span className="app-btn__icon" aria-hidden="true">🔄</span>
          <span>Новый план</span>
        </button>
      </div>

      {/* Progress Bar */}
      <div className="app-progress-wrap" aria-label={`Прогресс выполнения: ${completedCount} из ${totalCount}`}>
        <div className="app-progress-meta">
          <span className="app-progress-label">
            {allCompleted
              ? '🎉 Все действия выполнены!'
              : `Выполнено: ${completedCount} из ${totalCount} (${progressPercent}%)`}
          </span>
          <span className="app-progress-pct">{progressPercent}%</span>
        </div>
        <div className="app-progress-track">
          <div
            className={`app-progress-fill ${allCompleted ? 'app-progress-fill--done' : ''}`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Checklist items */}
      <div className="app-list" role="list">
        {planItems.map(item => {
          const isDone = Boolean(completedMap[item.id])
          const diffInfo = getDifficultyLabel(item.difficulty)
          const isPriority = item.isPriority || item.title.includes('⚠️ Приоритет')

          return (
            <div
              key={item.id}
              className={`app-item ${isDone ? 'app-item--done' : ''} ${isPriority ? 'app-item--priority' : ''}`}
              role="listitem"
            >
              <label className="app-item__check-wrap">
                <input
                  type="checkbox"
                  className="app-item__checkbox"
                  checked={isDone}
                  onChange={() => handleToggle(item.id)}
                  aria-label={`Отметить действие: ${item.title}`}
                />
                <span className="app-item__checkmark" aria-hidden="true">
                  {isDone && '✓'}
                </span>
              </label>

              <div className="app-item__content">
                <div className="app-item__head">
                  <span className={`app-item__title ${isDone ? 'app-item__title--done' : ''}`}>
                    {item.title}
                  </span>
                  {isPriority && !isDone && (
                    <span className="app-badge app-badge--priority" title="Метрика показала спад в текущем периоде">
                      Приоритет
                    </span>
                  )}
                </div>

                <p className={`app-item__desc ${isDone ? 'app-item__desc--done' : ''}`}>
                  {item.description}
                </p>

                <div className="app-item__meta">
                  <span className={`app-pill ${diffInfo.badgeClass}`}>
                    {diffInfo.text}
                  </span>
                  <span className="app-pill app-pill--time">
                    ⏱️ {item.estimatedTime}
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Completion announcement */}
      {allCompleted && (
        <div className="app-congrats" role="status">
          <span className="app-congrats__icon" aria-hidden="true">🏆</span>
          <div className="app-congrats__text">
            <strong>Отличная работа команды!</strong>
            <p>Вы закрыли все запланированные действия на этот период. Продолжайте поддерживать друг друга!</p>
          </div>
        </div>
      )}
    </section>
  )
}
