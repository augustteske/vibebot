import { lazy, Suspense, useId, useState } from 'react'
import { CuteBeeMagnifier } from '../../core/CuteBeeMagnifier'
import type { ExtendedAnalyticsMetrics, MetricComparisonTrends } from '../../core/telegram'
import './InsightsWidget.css'

const InsightsCharts = lazy(() => import('./InsightsCharts').then(module => ({ default: module.InsightsCharts })))

export interface InsightsMetrics {
  outsideHoursPercent: number;
  participationEvenness: number;
  recognitionPercent: number;
  participantCount?: number;
  messageCount?: number;
  unansweredQuestionsPercent?: number;
  responseMedianMinutes?: number | null;
  positivityIndex?: number;
  intensityIndex?: number;
  activityDistribution?: {
    byDay: Record<string, number>;
    byHour: Record<string | number, number>;
  };
  trends?: MetricComparisonTrends | null;
}

export interface InsightsWidgetProps {
  state: 'calibrating' | 'insufficient' | 'published' | 'paused';
  metrics: InsightsMetrics | null;
  teamProfile?: 'informal' | 'formal';
  periodLabel?: string;
  demo?: boolean;
  extendedMetrics?: ExtendedAnalyticsMetrics;
  trends?: MetricComparisonTrends | null;
}

interface MetricInfoProps {
  label: string;
  measures: string;
  doesNotProve: string;
  note?: string;
}

const PROFILE_NOTE: Record<'informal' | 'formal', string> = {
  informal: 'Возможно, команда просто продолжает общаться в неформальном режиме.',
  formal: 'Возможно, изменились ожидания по доступности.',
}

function MetricInfo({ label, measures, doesNotProve, note }: MetricInfoProps) {
  const [hovered, setHovered] = useState(false)
  const [pinned, setPinned] = useState(false)
  const tooltipId = useId()
  const open = hovered || pinned

  return (
    <span
      className="iw-info"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setPinned(false) }}
    >
      <button
        type="button"
        className="iw-info__button"
        aria-label={`Что показывает метрика «${label}»`}
        aria-expanded={open}
        aria-describedby={tooltipId}
        onClick={() => setPinned(value => !value)}
        onFocus={() => setPinned(true)}
        onBlur={() => setPinned(false)}
        onKeyDown={event => {
          if (event.key === 'Escape') setPinned(false)
        }}
      >
        <span aria-hidden="true">i</span>
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        className={`iw-info__tooltip${open ? ' iw-info__tooltip--open' : ''}`}
      >
        <strong>{label}</strong>
        <span><b>Что измеряет:</b> {measures}</span>
        <span><b>Чего не доказывает:</b> {doesNotProve}</span>
        {note && <span className="iw-info__note">{note}</span>}
      </span>
    </span>
  )
}

interface TrendBadgeProps {
  diff?: number | null;
  unit?: string;
  invert?: boolean;
}

function TrendBadge({ diff, unit = '%', invert = false }: TrendBadgeProps) {
  if (diff === undefined || diff === null || Number.isNaN(diff)) return null
  if (diff === 0) return <span className="iw-trend iw-trend--neutral">0{unit}</span>
  const isUp = diff > 0
  const isGood = invert ? !isUp : isUp
  const sign = isUp ? '+' : ''
  return (
    <span
      className={`iw-trend ${isGood ? 'iw-trend--good' : 'iw-trend--warn'}`}
      title={`Динамика по сравнению с прошлым периодом: ${sign}${diff}${unit}`}
    >
      <span className="iw-trend__arrow" aria-hidden="true">{isUp ? '↑' : '↓'}</span>
      <span>{sign}{diff}{unit}</span>
    </span>
  )
}

interface RhythmHeatmapProps {
  distribution?: {
    byDay: Record<string, number>;
    byHour: Record<string | number, number>;
  };
}

function RhythmHeatmap({ distribution }: RhythmHeatmapProps) {
  const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
  const byDay = distribution?.byDay ?? {}
  const byHour = distribution?.byHour ?? {}

  const dayValues = days.map(d => byDay[d] ?? 0)
  const maxDay = Math.max(1, ...dayValues)

  const night = [0, 1, 2, 3, 4, 5].reduce((sum, h) => sum + (byHour[h] ?? 0), 0)
  const morning = [6, 7, 8, 9, 10, 11].reduce((sum, h) => sum + (byHour[h] ?? 0), 0)
  const day = [12, 13, 14, 15, 16, 17].reduce((sum, h) => sum + (byHour[h] ?? 0), 0)
  const evening = [18, 19, 20, 21, 22, 23].reduce((sum, h) => sum + (byHour[h] ?? 0), 0)
  const totalQuarter = night + morning + day + evening || 1

  return (
    <div className="iw-rhythm">
      <div className="iw-rhythm__section">
        <span className="iw-rhythm__title">Активность по дням недели</span>
        <div className="iw-rhythm__days">
          {days.map(d => {
            const count = byDay[d] ?? 0
            const pct = Math.round((count / maxDay) * 100)
            return (
              <div key={d} className="iw-rhythm__day-col" title={`${d}: ${count} сообщ.`}>
                <div className="iw-rhythm__bar-wrap">
                  <div className="iw-rhythm__bar" style={{ height: `${Math.max(10, pct)}%` }} />
                </div>
                <span className="iw-rhythm__day-label">{d}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="iw-rhythm__section">
        <span className="iw-rhythm__title">Время суток</span>
        <div className="iw-rhythm__blocks">
          <div className="iw-rhythm__block">
            <span className="iw-rhythm__block-name">Утро (06–12)</span>
            <span className="iw-rhythm__block-pct">{Math.round((morning / totalQuarter) * 100)}%</span>
          </div>
          <div className="iw-rhythm__block">
            <span className="iw-rhythm__block-name">День (12–18)</span>
            <span className="iw-rhythm__block-pct">{Math.round((day / totalQuarter) * 100)}%</span>
          </div>
          <div className="iw-rhythm__block">
            <span className="iw-rhythm__block-name">Вечер (18–24)</span>
            <span className="iw-rhythm__block-pct">{Math.round((evening / totalQuarter) * 100)}%</span>
          </div>
          <div className="iw-rhythm__block">
            <span className="iw-rhythm__block-name">Ночь (00–06)</span>
            <span className="iw-rhythm__block-pct">{Math.round((night / totalQuarter) * 100)}%</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export function InsightsWidget({
  state,
  metrics,
  teamProfile,
  periodLabel,
  demo = false,
  extendedMetrics,
  trends,
}: InsightsWidgetProps) {
  // Avoid exposing aggregates until the publication threshold is met.
  const isInsufficient = state === 'insufficient' || (metrics && (
    (metrics.participantCount !== undefined && metrics.participantCount < 5)
    || (metrics.messageCount !== undefined && metrics.messageCount < 20)
  ));

  if (state === 'paused') {
    return (
      <div className="iw-container iw-state-warn iw-empty-state">
        <div className="iw-empty-state__icon">⏸️</div>
        <h2 className="iw-title">Анализ приостановлен</h2>
        <p className="iw-empty-state__lead">Сбор временно на паузе.</p>
        <p className="iw-hint">Новые показатели не публикуются до возобновления работы.</p>
      </div>
    );
  }

  if (state === 'calibrating') {
    return (
      <div className="iw-container iw-empty-state">
        <div className="iw-empty-state__icon">
          <CuteBeeMagnifier size={84} />
        </div>
        <h2 className="iw-title">Мы собираем данные...</h2>
        <p className="iw-empty-state__lead">Идёт калибровка первых сообщений команды.</p>
        <p className="iw-hint">Мы анализируем стиль и ритм вашей команды, чтобы сформировать объективную картину без шума.</p>
      </div>
    );
  }

  if (isInsufficient) {
    return (
      <div className="iw-container iw-empty-state">
        <div className="iw-empty-state__icon">🐝✨</div>
        <h2 className="iw-title">Недостаточно данных</h2>
        <p className="iw-empty-state__lead">Пока нет данных для анализа. Пригласите коллег в чат, и мы начнём!</p>
        <p className="iw-hint">Для бережной публикации нужно минимум 5 участников и 20 сообщений. Отсутствие данных не означает ноль.</p>
      </div>
    );
  }

  if (!metrics) return null;

  const ext = extendedMetrics ?? (metrics as unknown as ExtendedAnalyticsMetrics | undefined)
  const currentTrends = trends ?? ext?.trends ?? metrics?.trends
  const unansweredPercent = ext?.unansweredQuestionsPercent ?? metrics.unansweredQuestionsPercent
  const responseTime = ext?.responseMedianMinutes ?? metrics.responseMedianMinutes
  const positivity = ext?.positivityIndex ?? metrics.positivityIndex
  const intensity = ext?.intensityIndex ?? metrics.intensityIndex
  const activity = ext?.activityDistribution ?? metrics.activityDistribution

  return (
    <div className="iw-container">
      <div className="iw-header">
        <h2 className="iw-title">Коммуникация команды</h2>
        {demo && <span className="iw-badge">демо-данные</span>}
      </div>

      {periodLabel && <p className="iw-period">Период: {periodLabel}</p>}

      <div className="iw-grid">
        {/* Карточка 1: Общение вне рабочих часов */}
        <div className="iw-card">
          <div className="iw-card__head">
            <h3>Общение вне рабочих часов</h3>
            <MetricInfo
              label="Общение вне рабочих часов"
              measures={`${metrics.outsideHoursPercent}% сообщений пришлось на нерабочее время.`}
              doesNotProve="что кто-то перерабатывает: возможно, у коллег гибкий график или команда просто активна вечером."
              note={teamProfile ? PROFILE_NOTE[teamProfile] : undefined}
            />
          </div>
          <div className="iw-hero-stat">
            <div className="iw-hero-stat__row">
              <span className="iw-hero-stat__number">{metrics.outsideHoursPercent}%</span>
              <TrendBadge diff={currentTrends?.outsideHoursPercentDiff} invert />
            </div>
            <span className="iw-hero-stat__label">сообщений вне работы</span>
          </div>
          <Suspense fallback={<div className="iw-chart iw-chart--donut" aria-hidden="true" />}>
            <InsightsCharts metric="outsideHoursPercent" value={metrics.outsideHoursPercent} />
          </Suspense>
        </div>

        {/* Карточка 2: Равномерность участия */}
        <div className="iw-card">
          <div className="iw-card__head">
            <h3>Равномерность участия</h3>
            <MetricInfo
              label="Равномерность участия"
              measures={metrics.participationEvenness >= 70
                ? "Участие довольно равномерное. Все члены команды активно включены в обсуждение."
                : "Распределение сообщений между участниками. Помогает заметить, если в чате говорят только 1–2 человека."}
              doesNotProve="вклад людей в результат и не определяет «главного» в команде."
            />
          </div>
          <div className="iw-hero-stat">
            <div className="iw-hero-stat__row">
              <span className="iw-hero-stat__number">{metrics.participationEvenness.toFixed(1)}%</span>
              <TrendBadge diff={currentTrends?.participationEvennessDiff} />
            </div>
            <span className="iw-hero-stat__label">вовлечённость команды</span>
          </div>
          <Suspense fallback={<div className="iw-chart" aria-hidden="true" />}>
            <InsightsCharts metric="participationEvenness" value={metrics.participationEvenness} />
          </Suspense>
        </div>

        {/* Карточка 3: Индекс позитива / Признание */}
        <div className="iw-card">
          <div className="iw-card__head">
            <h3>{positivity !== undefined ? 'Индекс позитива' : 'Благодарности'}</h3>
            <MetricInfo
              label={positivity !== undefined ? 'Индекс позитива' : 'Благодарности'}
              measures={positivity !== undefined
                ? `${positivity}% сообщений содержат слова поддержки, вдохновения или признательности.`
                : `${metrics.recognitionPercent}% сообщений содержат слова признательности и поддержки.`}
              doesNotProve="отсутствие трудностей: метрика лишь отражает эмоциональный тон диалогов."
            />
          </div>
          <div className="iw-hero-stat">
            <div className="iw-hero-stat__row">
              <span className="iw-hero-stat__number">
                {positivity !== undefined ? `${positivity}%` : `${metrics.recognitionPercent}%`}
              </span>
              <TrendBadge diff={positivity !== undefined ? currentTrends?.positivityIndexDiff : currentTrends?.recognitionPercentDiff} />
            </div>
            <span className="iw-hero-stat__label">
              {positivity !== undefined ? 'позитивный фон сообщений' : 'сообщений с благодарностью'}
            </span>
          </div>
          <p className="iw-value-sub">
            {positivity !== undefined
              ? `Из них ${metrics.recognitionPercent}% содержат слова прямой благодарности`
              : 'Тёплые слова и признание вклада в диалогах'}
          </p>
        </div>

        {/* Карточка 4: Скорость реакции */}
        <div className="iw-card">
          <div className="iw-card__head">
            <h3>Скорость реакции</h3>
            <MetricInfo
              label="Скорость реакции"
              measures={responseTime !== undefined && responseTime !== null
                ? `Медианное время ответа на сообщение составляет ${responseTime} мин.`
                : "Медианное время до ответа на сообщение между участниками."}
              doesNotProve="обязанность моментально отвечать: асинхронный диалог часто продуктивнее."
            />
          </div>
          <div className="iw-hero-stat">
            <div className="iw-hero-stat__row">
              <span className="iw-hero-stat__number">
                {responseTime !== undefined && responseTime !== null ? `${responseTime} мин` : '—'}
              </span>
              <TrendBadge diff={currentTrends?.responseMedianMinutesDiff} unit=" мин" invert />
            </div>
            <span className="iw-hero-stat__label">медианное время ответа</span>
          </div>
          <p className="iw-value-sub">Время между репликами разных участников в диалоге</p>
        </div>
      </div>

      {/* Раскрывающийся блок: Дополнительные сигналы и ритм работы */}
      <details className="iw-details">
        <summary className="iw-details__summary">
          <span className="iw-details__summary-text">Дополнительные сигналы и ритм команды</span>
          <span className="iw-details__chevron" aria-hidden="true">▾</span>
        </summary>

        <div className="iw-details__content">
          <div className="iw-grid iw-grid--sub">
            {/* Вопросы без ответа */}
            <div className="iw-card iw-card--sub">
              <div className="iw-card__head">
                <h3>Вопросы без ответа</h3>
                <MetricInfo
                  label="Вопросы без ответа"
                  measures={`${unansweredPercent ?? 0}% сообщений с вопросом остались без ответа за сутки.`}
                  doesNotProve="что вопрос проигнорировали: коллега мог ответить лично или голосом."
                />
              </div>
              <div className="iw-hero-stat">
                <div className="iw-hero-stat__row">
                  <span className="iw-hero-stat__number">
                    {unansweredPercent !== undefined ? `${unansweredPercent}%` : '—'}
                  </span>
                  <TrendBadge diff={currentTrends?.unansweredQuestionsPercentDiff} invert />
                </div>
                <span className="iw-hero-stat__label">вопросов без ответа за 24 ч</span>
              </div>
              <p className="iw-value-sub">Доля сообщений с «?», на которые никто не ответил в чате</p>
            </div>

            {/* Индекс накала */}
            <div className="iw-card iw-card--sub">
              <div className="iw-card__head">
                <h3>Индекс накала</h3>
                <MetricInfo
                  label="Индекс накала"
                  measures={`${intensity ?? 0}% сообщений содержат экспрессивную или неформальную лексику.`}
                  doesNotProve="конфликт: в доверительной команде неформальный сленг часто естественен."
                />
              </div>
              <div className="iw-hero-stat">
                <div className="iw-hero-stat__row">
                  <span className="iw-hero-stat__number">
                    {intensity !== undefined ? `${intensity}%` : '—'}
                  </span>
                  <TrendBadge diff={currentTrends?.intensityIndexDiff} invert />
                </div>
                <span className="iw-hero-stat__label">экспрессивных сообщений</span>
              </div>
              <p className="iw-value-sub">Анонимный счётчик тональности (слова не сохраняются)</p>
            </div>

            {/* Ритм работы команды */}
            <div className="iw-card iw-card--sub iw-card--span">
              <div className="iw-card__head">
                <h3>Ритм работы команды</h3>
                <MetricInfo
                  label="Ритм работы команды"
                  measures="Агрегированное распределение активности чата по дням и времени суток."
                  doesNotProve="эффективность в конкретный день: показывает только интенсивность общения."
                />
              </div>
              <RhythmHeatmap distribution={activity} />
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}
