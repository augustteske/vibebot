import { lazy, Suspense, useId, useState } from 'react'
import './InsightsWidget.css'

const InsightsCharts = lazy(() => import('./InsightsCharts').then(module => ({ default: module.InsightsCharts })))

export interface InsightsMetrics {
  outsideHoursPercent: number;
  participationEvenness: number;
  recognitionPercent: number;
  participantCount?: number;
  messageCount?: number;
}

export interface InsightsWidgetProps {
  state: 'calibrating' | 'insufficient' | 'published' | 'paused';
  metrics: InsightsMetrics | null;
  teamProfile?: 'informal' | 'formal';
  periodLabel?: string;
  demo?: boolean;
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

/** Маленькая «i» у метрики: что она измеряет и чего не доказывает. */
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

export function InsightsWidget({ state, metrics, teamProfile, periodLabel, demo = false }: InsightsWidgetProps) {
  // Avoid exposing aggregates until the publication threshold is met.
  const isInsufficient = state === 'insufficient' || (metrics && (
    (metrics.participantCount !== undefined && metrics.participantCount < 5)
    || (metrics.messageCount !== undefined && metrics.messageCount < 20)
  ));

  if (state === 'paused') {
    return (
      <div className="iw-container iw-state-warn">
        <h2 className="iw-title">Анализ приостановлен</h2>
        <p>Новые показатели не публикуются до возобновления.</p>
      </div>
    );
  }

  if (state === 'calibrating') {
    return (
      <div className="iw-container">
        <h2 className="iw-title">Идёт калибровка</h2>
        <p>Пока накапливается история команды, сравнение с нормой недоступно.</p>
      </div>
    );
  }

  if (isInsufficient) {
    return (
      <div className="iw-container">
        <h2 className="iw-title">Недостаточно данных</h2>
        <p>Для публикации показателей нужно минимум 5 участников и 20 сообщений.</p>
        <p className="iw-hint">Отсутствие данных не означает ноль.</p>
      </div>
    );
  }

  if (!metrics) return null;

  return (
    <div className="iw-container">
      <div className="iw-header">
        <h2 className="iw-title">Коммуникация команды</h2>
        {demo && <span className="iw-badge">демо-данные</span>}
      </div>

      {periodLabel && <p className="iw-period">Период: {periodLabel}</p>}

      <div className="iw-grid">
        <div className="iw-card">
          <div className="iw-card__head">
            <h3>Общение вне рабочих часов</h3>
            <MetricInfo
              label="Общение вне рабочих часов"
              measures="долю сообщений, отправленных вне заданного рабочего графика команды."
              doesNotProve="что люди перерабатывают: у кого-то может быть личный график или другая часовая зона."
              note={teamProfile ? PROFILE_NOTE[teamProfile] : undefined}
            />
          </div>
          <Suspense fallback={<div className="iw-chart iw-chart--donut" aria-hidden="true" />}>
            <InsightsCharts metric="outsideHoursPercent" value={metrics.outsideHoursPercent} />
          </Suspense>
        </div>
        <div className="iw-card">
          <div className="iw-card__head">
            <h3>Равномерность участия</h3>
            <MetricInfo
              label="Равномерность участия"
              measures="насколько равномерно сообщения распределены между участниками, от 0 до 100%."
              doesNotProve="вклад людей в результат и не показывает, кто «главный» в команде."
            />
          </div>
          <Suspense fallback={<div className="iw-chart" aria-hidden="true" />}>
            <InsightsCharts metric="participationEvenness" value={metrics.participationEvenness} />
          </Suspense>
        </div>
        <div className="iw-card">
          <div className="iw-card__head">
            <h3>Благодарности</h3>
            <MetricInfo
              label="Благодарности"
              measures="долю сообщений с автоматически найденными признаками благодарности."
              doesNotProve="качество работы и настоящую культуру признания: распознавание приблизительное."
            />
          </div>
          <p className="iw-value">{metrics.recognitionPercent}%</p>
        </div>
      </div>
    </div>
  );
}
