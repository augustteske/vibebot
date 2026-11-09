import { useId } from 'react'
import type { ExtendedAnalyticsMetrics } from '../../core/telegram'
import type { InsightsMetrics } from './InsightsWidget'
import { calculateTeamHealthScore, getTeamHealthGradation, getTeamHealthAdvice } from './teamHealth'
import './TeamHealthVessel.css'

export interface TeamHealthVesselProps {
  metrics: InsightsMetrics | null | undefined
  extendedMetrics?: ExtendedAnalyticsMetrics | null
  className?: string
}

export function TeamHealthVessel({ metrics, extendedMetrics, className = '' }: TeamHealthVesselProps) {
  const id = useId()

  const ext = extendedMetrics ?? (metrics as unknown as ExtendedAnalyticsMetrics | undefined)
  const score = ext?.teamHealthScore ?? calculateTeamHealthScore(metrics)
  const gradation = getTeamHealthGradation(score)
  const advice = getTeamHealthAdvice(metrics, extendedMetrics)

  // Clamp visual liquid fill between 10% and 94% so liquid never clips outside or looks fully empty
  const visualFill = Math.max(10, Math.min(94, score))

  return (
    <article
      className={`th-vessel-card ${className}`}
      aria-labelledby={`${id}-title`}
      data-zone={gradation.zone}
    >
      <div className="th-vessel-card__glow" aria-hidden="true" />

      <div className="th-vessel-card__layout">
        {/* Колба с медом */}
        <div className="th-vessel-col">
          <div
            className="th-vessel"
            title={`Общий индекс здоровья: ${score}% (${gradation.title})`}
            role="img"
            aria-label={`Колба с мёдом: наполнена на ${score}%, статус: ${gradation.title}`}
          >
            {/* Мерные риски на стекле */}
            <div className="th-vessel__ticks" aria-hidden="true">
              <span className="th-vessel__tick" style={{ bottom: '90%' }}>100</span>
              <span className="th-vessel__tick" style={{ bottom: '70%' }}>75</span>
              <span className="th-vessel__tick" style={{ bottom: '48%' }}>50</span>
              <span className="th-vessel__tick" style={{ bottom: '26%' }}>25</span>
            </div>

            {/* Горлышко и ободок колбы */}
            <div className="th-vessel__neck" aria-hidden="true">
              <div className="th-vessel__lip" />
            </div>

            {/* Тело колбы со скругленным дном */}
            <div className="th-vessel__body">
              {/* Жидкий мед */}
              <div className="th-vessel__liquid-wrap" style={{ height: `${visualFill}%` }}>
                {/* Анимированные волны на поверхности меда */}
                <div className="th-vessel__wave th-vessel__wave--back" aria-hidden="true" />
                <div className="th-vessel__wave th-vessel__wave--front" aria-hidden="true" />

                {/* Толща меда с пузырьками */}
                <div className="th-vessel__honey-fill">
                  <span className="th-vessel__bubble b1" aria-hidden="true" />
                  <span className="th-vessel__bubble b2" aria-hidden="true" />
                  <span className="th-vessel__bubble b3" aria-hidden="true" />
                  <span className="th-vessel__bubble b4" aria-hidden="true" />
                </div>
              </div>

              {/* Блики и стекло */}
              <div className="th-vessel__glare-left" aria-hidden="true" />
              <div className="th-vessel__glare-specular" aria-hidden="true" />
              <div className="th-vessel__bottom-reflection" aria-hidden="true" />

              {/* Крупное число в центре колбы */}
              <div className="th-vessel__center-score" aria-hidden="true">
                <span className="th-vessel__number">{score}%</span>
                <span className="th-vessel__label">Индекс</span>
              </div>
            </div>
          </div>
        </div>

        {/* Описание, шкала градаций и персональный совет */}
        <div className="th-vessel-details">
          <header className="th-vessel-details__header">
            <div className="th-vessel-badge" style={{ borderColor: gradation.badgeColor }}>
              <span
                className="th-vessel-badge__dot"
                style={{ backgroundColor: gradation.badgeColor }}
                aria-hidden="true"
              />
              <span className="th-vessel-badge__text" style={{ color: gradation.badgeColor }}>
                {gradation.title}
              </span>
            </div>
            <h3 id={`${id}-title`} className="th-vessel-details__title">
              Общая температура команды
            </h3>
          </header>

          <p className="th-vessel-details__lead">{gradation.subtitle}</p>

          <div className="th-vessel-section">
            <span className="th-vessel-section__label">Что это значит?</span>
            <p className="th-vessel-section__text">
              100% — идеальный баланс и здоровая культура взаимодействия, 0% — зона критического риска. Индекс
              учитывает вовлечённость, позитив, границы нерабочего времени и скорость ответов.
            </p>
          </div>

          {/* 4 ступени шкалы с подсветкой текущей зоны */}
          <div className="th-vessel-scale" aria-label="Шкала градаций">
            <div className={`th-vessel-scale__item ${gradation.zone === 'risk' ? 'th-vessel-scale__item--active' : ''}`}>
              <span className="th-vessel-scale__range">0–19%</span>
              <span className="th-vessel-scale__name">Зона риска</span>
            </div>
            <div className={`th-vessel-scale__item ${gradation.zone === 'attention' ? 'th-vessel-scale__item--active' : ''}`}>
              <span className="th-vessel-scale__range">20–49%</span>
              <span className="th-vessel-scale__name">Внимание</span>
            </div>
            <div className={`th-vessel-scale__item ${gradation.zone === 'hive' ? 'th-vessel-scale__item--active' : ''}`}>
              <span className="th-vessel-scale__range">50–79%</span>
              <span className="th-vessel-scale__name">Рабочий улей</span>
            </div>
            <div className={`th-vessel-scale__item ${gradation.zone === 'paradise' ? 'th-vessel-scale__item--active' : ''}`}>
              <span className="th-vessel-scale__range">80–100%</span>
              <span className="th-vessel-scale__name">Пчелиный рай</span>
            </div>
          </div>

          {/* Персональный совет */}
          <div className="th-vessel-advice">
            <span className="th-vessel-advice__icon" aria-hidden="true">💡</span>
            <div className="th-vessel-advice__content">
              <strong>Совет для команды:</strong>
              <p>{advice}</p>
            </div>
          </div>
        </div>
      </div>
    </article>
  )
}
