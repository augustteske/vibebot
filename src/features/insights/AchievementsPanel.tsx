import { useEffect, useId, useMemo, useState } from 'react'
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

const STORAGE_KEY = 'vibee_seen_achievements'

function getSeenAchievements(): string[] {
  try {
    if (typeof localStorage === 'undefined') return []
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveSeenAchievements(ids: string[]) {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // Ignore in private browsing / sandboxed storage
  }
}

interface ConfettiPiece {
  x: number
  color: string
  delay: number
  duration: number
  angle: number
  size: number
}

function generateConfettiPieces(count = 36): ConfettiPiece[] {
  const colors = [
    '#ffd638',
    '#f59e0b',
    '#10b981',
    '#3b82f6',
    '#ec4899',
    '#8b5cf6',
    '#f97316',
    '#06b6d4',
  ]
  const pieces: ConfettiPiece[] = []
  for (let i = 0; i < count; i++) {
    pieces.push({
      x: Math.round(Math.random() * 96 + 2),
      color: colors[i % colors.length],
      delay: Math.round(Math.random() * 800) / 1000,
      duration: Math.round((2.2 + Math.random() * 1.6) * 10) / 10,
      angle: Math.round(Math.random() * 360),
      size: Math.round(7 + Math.random() * 6),
    })
  }
  return pieces
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
  isNewlyUnlocked?: boolean
}

function AchievementCard({ item, isNewlyUnlocked = false }: AchievementCardProps) {
  const [hovered, setHovered] = useState(false)
  const tooltipId = useId()

  return (
    <div
      className={`ach-card ${item.unlocked ? 'ach-card--unlocked' : 'ach-card--locked'} ${
        isNewlyUnlocked ? 'ach-card--newly-unlocked' : ''
      }`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      tabIndex={0}
      role="region"
      aria-label={`${item.title}: ${item.unlocked ? 'Разблокировано' : 'Заблокировано'}`}
      aria-describedby={tooltipId}
    >
      {isNewlyUnlocked && (
        <span className="ach-card__new-ribbon" aria-hidden="true">
          Новое!
        </span>
      )}

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
        <span
          className={`ach-card__status ${
            item.unlocked ? 'ach-card__status--unlocked' : 'ach-card__status--locked'
          }`}
        >
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
  const [celebratingItems, setCelebratingItems] = useState<AchievementItem[]>([])
  const [showConfetti, setShowConfetti] = useState(false)

  const confettiPieces = useMemo(() => generateConfettiPieces(40), [])

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
        // Fallback to client-computed achievements
      })
    return () => {
      cancelled = true
    }
  }, [])

  const items = propAchievements ?? serverAchievements ?? computeClientAchievements(metrics)
  const unlockedCount = items.filter(a => a.unlocked).length
  const totalCount = items.length

  // Check for newly unlocked achievements and trigger animation
  useEffect(() => {
    const unlockedNow = items.filter(a => a.unlocked)
    if (unlockedNow.length === 0) return

    const seen = getSeenAchievements()
    const newlyUnlocked = unlockedNow.filter(a => !seen.includes(a.id))

    if (newlyUnlocked.length > 0) {
      setCelebratingItems(newlyUnlocked)
      setShowConfetti(true)

      const updatedSeen = Array.from(new Set([...seen, ...unlockedNow.map(a => a.id)]))
      saveSeenAchievements(updatedSeen)

      const timer = window.setTimeout(() => {
        setShowConfetti(false)
      }, 4500)

      return () => window.clearTimeout(timer)
    }
  }, [items])

  const newlyUnlockedIdSet = useMemo(
    () => new Set(celebratingItems.map(c => c.id)),
    [celebratingItems],
  )

  return (
    <section className={`ach-panel ${className}`} aria-labelledby="ach-panel-heading">
      {/* Confetti Animation Effect */}
      {showConfetti && (
        <div className="ach-confetti-container" aria-hidden="true">
          {confettiPieces.map((piece, i) => (
            <div
              key={i}
              className="ach-confetti-piece"
              style={{
                left: `${piece.x}%`,
                backgroundColor: piece.color,
                animationDelay: `${piece.delay}s`,
                animationDuration: `${piece.duration}s`,
                width: `${piece.size}px`,
                height: `${Math.round(piece.size * 1.5)}px`,
                transform: `rotate(${piece.angle}deg)`,
              }}
            />
          ))}
        </div>
      )}

      {/* Celebration Notification Toast */}
      {celebratingItems.length > 0 && (
        <div className="ach-celebration-toast" role="status" aria-live="polite">
          <span className="ach-celebration-toast__icon" aria-hidden="true">
            🎉
          </span>
          <div className="ach-celebration-toast__content">
            <strong className="ach-celebration-toast__title">
              {celebratingItems.length === 1
                ? 'Новое достижение разблокировано!'
                : 'Новые достижения команды!'}
            </strong>
            <span className="ach-celebration-toast__items">
              {celebratingItems.map(c => `${c.emoji} «${c.title}»`).join(', ')}
            </span>
          </div>
          <button
            type="button"
            className="ach-celebration-toast__close"
            onClick={() => setCelebratingItems([])}
            aria-label="Скрыть уведомление"
          >
            ×
          </button>
        </div>
      )}

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
          <AchievementCard
            key={item.id}
            item={item}
            isNewlyUnlocked={newlyUnlockedIdSet.has(item.id)}
          />
        ))}
      </div>
    </section>
  )
}
