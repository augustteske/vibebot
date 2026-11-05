import { useId } from 'react'
import type { CommunicationView } from '../../core/telegram'
import { InsightsWidget } from './InsightsWidget'
import './TeamPulse.css'

export function pulsePeriodLabel(view: Extract<CommunicationView, { status: 'published' }>) {
  const format = (date: string) => new Date(date).toLocaleString('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Omsk',
  })
  return `${format(view.period.start)} — ${format(view.period.end)} (Омск)`
}

const explanations = {
  disconnected: 'История пока не собирается: нет активной привязки Telegram-чата.',
  paused: 'Сбор приостановлен. Показатели скрыты до возобновления с согласиями участников.',
  awaiting_consents: 'История пока не собирается: ожидается согласие всех участников.',
  calibrating: 'Показатели пока недоступны: настройка и калибровка не завершены.',
  open: 'Текущий период ещё собирается. Показатели появятся после его завершения, если данных будет достаточно.',
  insufficient: 'Недостаточно данных участников для публикации показателей. Отсутствие данных не означает ноль.',
  error: 'Анализ чата временно недоступен. Показатели скрыты.',
}

export function TeamPulse({ view, loading, error, onRetry }: {
  view: CommunicationView | null
  loading: boolean
  error: string
  onRetry: () => void
}) {
  const id = useId()
  return <section className="panel team-pulse" aria-labelledby={`${id}-title`}>
    <div className="team-pulse__header">
      <h2 id={`${id}-title`}>Пульс команды</h2>
      <label className="team-pulse__period">Период
        <select defaultValue="current" aria-describedby={`${id}-history`}>
          <option value="current">Текущая сводка</option>
          <option value="week" disabled>Неделя — недоступно</option>
          <option value="month" disabled>Месяц — недоступно</option>
        </select>
      </label>
    </div>
    <p className="team-pulse__hint" id={`${id}-history`}>История за неделю и месяц недоступна: API возвращает только текущую сводку. Сравнение и динамика не рассчитываются.</p>
    {loading ? <p role="status">Загружаем текущую сводку…</p> : error ? <>
      <p className="error" role="alert">Не удалось загрузить сводку. {error}</p>
      <button type="button" className="button secondary" onClick={onRetry}>Повторить</button>
    </> : view?.status === 'published' ? <>
      <p>Данные доступны за опубликованный период. Это текущая сводка, а не итог за неделю или месяц.</p>
      {view.demo && <p className="team-pulse__demo">Демо: вымышленные данные, не реальные сообщения команды.</p>}
      <InsightsWidget state="published" metrics={view.metrics} periodLabel={pulsePeriodLabel(view)} demo={view.demo}/>
    </> : view && <p role="status">{explanations[view.status]}</p>}
  </section>
}
