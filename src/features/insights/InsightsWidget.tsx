import { lazy, Suspense } from 'react'
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

export function InsightsWidget({ state, metrics, teamProfile, periodLabel, demo = false }: InsightsWidgetProps) {
  // Проверка на недостаток данных (по ТЗ Августа)
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

  // Разная интерпретация для разных профилей
  const interpretation = teamProfile === 'informal'
    ? 'Возможно, вы просто продолжаете общение в relaxed режиме.'
    : teamProfile === 'formal'
      ? 'Возможно, изменились ожидания по доступности.'
      : 'Причины изменений неизвестны без контекста команды.';
  return (
    <div className="iw-container">
      <div className="iw-header">
        <h2 className="iw-title">Коммуникация команды</h2>
        {demo && <span className="iw-badge">демо-данные</span>}
      </div>

      {periodLabel && <p className="iw-period">Период: {periodLabel}</p>}

      <div className="iw-grid">
        <div className="iw-card">
          <h3>Общение вне рабочих часов</h3>
          <Suspense fallback={<div className="iw-chart iw-chart--donut" aria-hidden="true" />}>
            <InsightsCharts metric="outsideHoursPercent" value={metrics.outsideHoursPercent} />
          </Suspense>
          <p className="iw-method">Ограничение: {interpretation}</p>
        </div>
        <div className="iw-card">
          <h3>Равномерность участия</h3>
          <Suspense fallback={<div className="iw-chart" aria-hidden="true" />}>
            <InsightsCharts metric="participationEvenness" value={metrics.participationEvenness} />
          </Suspense>
          <p className="iw-method">Ограничение: Не измеряет вклад людей.</p>
        </div>
        <div className="iw-card">
          <h3>Благодарности</h3>
          <p className="iw-value">{metrics.recognitionPercent}%</p>
          <p className="iw-method">Ограничение: Приблизительное распознавание.</p>
        </div>
      </div>
    </div>
  );
}
