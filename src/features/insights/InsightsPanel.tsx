import type { InsightsProps } from '../../core/model'
export function InsightsPanel({ summary }: InsightsProps) {
  return <div className="panel"><h2>Температура команды</h2>
    {summary.status === 'open' ? <p>Раунд открыт. Результаты появятся после его завершения.</p> : summary.status === 'insufficient' ? <p>Недостаточно данных. Для публикации нужны ответы минимум пяти разных участников.</p> : <>
      <p>{summary.needs.includes('clarity') ? '🌥 Не хватает ясности. Давайте сверим приоритеты.' : summary.needs.length ? 'Команде может пригодиться поддержка.' : '☀️ Сигналы ровные. Продолжайте замечать вклад друг друга.'}</p>
      <div className="metrics">{([['energy','Ресурс'],['clarity','Ясность'],['support','Поддержка']] as const).map(([key,label]) => <div className="metric" key={key}>{label}<strong>{summary.means[key].toFixed(1)}<small>/5</small></strong></div>)}</div>
      <p className="muted">Демонстрационный закрытый раунд · данные вымышленные</p>
    </>}
  </div>
}
