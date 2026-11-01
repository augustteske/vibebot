import './InsightsWidget.css';

export interface InsightsMetrics {
  outsideHoursPercent: number;
  participationEvenness: number;
  recognitionPercent: number;
  participantCount: number;
  messageCount: number;
}

export interface InsightsWidgetProps {
  state: 'calibrating' | 'insufficient' | 'published' | 'paused';
  metrics: InsightsMetrics | null;
  teamProfile: 'informal' | 'formal';
  periodLabel?: string;
}

export function InsightsWidget({ state, metrics, teamProfile, periodLabel }: InsightsWidgetProps) {
  // Проверка на недостаток данных (по ТЗ Августа)
  const isInsufficient = state === 'insufficient' || (metrics && (metrics.participantCount < 5 || metrics.messageCount < 20));

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
    : 'Возможно, изменились ожидания по доступности.';

  return (
    <div className="iw-container">
      <div className="iw-header">
        <h2 className="iw-title">Коммуникация команды</h2>
        <span className="iw-badge">демо-данные</span>
      </div>
      
      {periodLabel && <p className="iw-period">Период: {periodLabel}</p>}

      <div className="iw-grid">
        <div className="iw-card">
          <h3>Общение вне рабочих часов</h3>
          <p className="iw-value">{metrics.outsideHoursPercent}%</p>
          <p className="iw-method">Ограничение: {interpretation}</p>
        </div>
        <div className="iw-card">
          <h3>Равномерность участия</h3>
          <p className="iw-value">{metrics.participationEvenness}%</p>
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