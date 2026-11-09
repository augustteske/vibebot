import { useEffect, useId, useState } from 'react'
import type { InsightsMetrics } from './InsightsWidget'
import './AchievementsPanel.css'

export interface AchievementItem {
  id: string
  title: string
  description: string
  emoji: string
  unlocked: boolean
}

export interface AchievementsPanelProps {
  metrics?: InsightsMetrics | null
  achievements?: AchievementItem[]
  className?: string
}

function computeClientAchievements(metrics?: InsightsMetrics | null): AchievementItem[] {
  const m = metrics || ({} as InsightsMetrics)
  return [
    {
      id: 'healthy_rhythm',
      title: 'Здоровый ритм',
      description: 'Менее 20% сообщений отправлено в нерабочее время (забота о балансе)',
      emoji: '🌙',
      unlocked: typeof m.outsideHoursPercent === 'number' && m.outsideHoursPercent < 20,
    },
    {
      id: 'balanced_team',
      title: 'Идеальный баланс',
      description: 'Равномерность участия команды превышает 80% (каждый голос важен)',
      emoji: '⚖️',
      unlocked: typeof m.participationEvenness === 'number' && m.participationEvenness > 80,
    },
    {
      id: 'gratitude_culture',
      title: 'Культура благодарности',
      description: 'Позитивный настрой или благодарность выражены более чем в 20% сообщений',
      emoji: '🙏',
      unlocked:
        (typeof m.positivityIndex === 'number' && m.positivityIndex > 20) ||
        (typeof m.recognitionPercent === 'number' && m.recognitionPercent > 20),
    },
    {
      id: 'fast_responders',
      title: 'Быстрые ответы',
      description: 'Медианное время ответа на сообщения меньше 30 минут',
      emoji: '⚡',
      unlocked:
        typeof m.responseMedianMinutes === 'number' &&
        m.responseMedianMinutes !== null &&
        m.responseMedianMinutes < 30,
    },
    {
      id: 'no_unanswered',
      title: 'Все услышаны',
      description: 'Менее 5% вопросов в командном чате остались без ответа за сутки',
      emoji: '💬',
      unlocked:
        typeof m.unansweredQuestionsPercent === 'number' && m.unansweredQuestionsPercent < 5,
    },
    {
      id: 'zen_communication',
      title: 'Дзен-общение',
      description: 'Индекс накала менее 2% — спокойная и продуктивная атмосфера в диалоге',
      emoji: '🧘',
      unlocked: typeof m.intensityIndex === 'number' && m.intensityIndex < 2,
    },
  ]
}

interface AchievementCardProps {
  item: AchievementItem
}

function AchievementCard({ item }: AchievementCardProps) {
  const [hovered, setHovered] = useState(false)
  const tooltipId = useId()

  return (
    <div
      className={`ach-card ${item.unlocked ? 'ach-card--unlocked' : 'ach-card--locked'}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      tabIndex={0}
      role="region"
      aria-label={`${item.title}: ${item.unlocked ? 'Разблокировано' : 'Заблокировано'}`}
      aria-describedby={tooltipId}
    >
      <div className="ach-card__icon-wrapper">
        <span className="ach-card__emoji" aria-hidden="true">
          {item.emoji}
        </span>
        {!item.unlocked && (
          <span className="ach-card__lock-badge" aria-label="Заблокировано" title="Заблокировано">
            🔒
          </span>
        )}
      </div>

      <div className="ach-card__content">
        <h4 className="ach-card__title">{item.title}</h4>
        <span className={`ach-card__status ${item.unlocked ? 'ach-card__status--unlocked' : 'ach-card__status--locked'}`}>
          {item.unlocked ? '✨ Открыто' : '🔒 Заблокировано'}
        </span>
      </div>

      {hovered && (
        <div id={tooltipId} role="tooltip" className="ach-tooltip">
          <div className="ach-tooltip__title">{item.title}</div>
          <div className="ach-tooltip__desc">
            {item.unlocked ? '🎉 Условие выполнено: ' : '🎯 Как открыть: '}
            {item.description}
          </div>
        </div>
      )}
    </div>
  )
}

export function AchievementsPanel({
  metrics,
  achievements: propAchievements,
  className = '',
}: AchievementsPanelProps) {
  const [serverAchievements, setServerAchievements] = useState<AchievementItem[] | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/telegram/achievements')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!cancelled && Array.isArray(data) && data.length > 0) {
          setServerAchievements(data)
        }
      })
      .catch(() => {
        // Fallback to client-computed achievements on failure or offline
      })
    return () => {
      cancelled = true
    }
  }, [])

  const items = propAchievements ?? serverAchievements ?? computeClientAchievements(metrics)
  const unlockedCount = items.filter(a => a.unlocked).length
  const totalCount = items.length

  return (
    <section className={`ach-panel ${className}`} aria-labelledby="ach-panel-heading">
      <div className="ach-panel__header">
        <div className="ach-panel__heading-group">
          <h3 id="ach-panel-heading" className="ach-panel__title">
            🏆 Достижения команды
          </h3>
          <p className="ach-panel__subtitle">
            Геймификация здоровых привычек и вовлеченности в чате
          </p>
        </div>
        <div className="ach-panel__progress-badge">
          <span className="ach-panel__progress-count">
            {unlockedCount} / {totalCount}
          </span>
          <span className="ach-panel__progress-label">открыто</span>
        </div>
      </div>

      <div className="ach-grid">
        {items.map(item => (
          <AchievementCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  )
}
