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
        <div className="iw-empty-state__icon">🐝🔍</div>
        <h2 className="iw-title">Идёт калибровка</h2>
        <p className="iw-empty-state__lead">Мы собираем первые сообщения, чтобы понять ритм и стиль вашей команды.</p>
        <p className="iw-hint">Пока накапливается история, сравнение с привычной нормой недоступно.</p>
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
              measures={`${metrics.outsideHoursPercent}% сообщений пришлось на нерабочее время.`}
              doesNotProve="что кто-то перерабатывает: возможно, у коллег гибкий график или команда просто активна вечером."
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
              measures={metrics.participationEvenness >= 70
                ? "Участие довольно равномерное. Все члены команды активно включены в обсуждение."
                : "Распределение сообщений между участниками. Помогает заметить, если в чате говорят только 1–2 человека."}
              doesNotProve="вклад людей в результат и не определяет «главного» в команде."
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
              measures={`${metrics.recognitionPercent}% сообщений содержат слова признательности и поддержки.`}
              doesNotProve="настоящую культуру признания: автоматическое распознавание лишь подсвечивает добрые слова."
            />
          </div>
          <p className="iw-value">{metrics.recognitionPercent}%</p>
        </div>
      </div>
    </div>
  );
}
