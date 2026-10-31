import { useState } from 'react'
import type { ActionsProps } from '../../core/model'
export function ActionsPanel({ summary }: ActionsProps) {
  const [state, setState] = useState<'suggested'|'accepted'|'later'|'helped'|'unhelpful'>('suggested')
  const title = summary.status === 'published' && summary.needs.includes('clarity') ? 'Одна цель на сегодня' : 'Замеченный вклад'
  return <section className="panel"><div className="card-icon">✦</div><h2>Vibee предлагает</h2>
    {state === 'later' ? <><p>Подсказка отложена до смены сценария или обновления страницы.</p><button className="button secondary" onClick={() => setState('suggested')}>Вернуть сейчас</button></> : state === 'suggested' ? <>
      <h3>{title}</h3><p>{title === 'Одна цель на сегодня' ? 'В части демонстрационных чек-инов отмечены непонятные приоритеты. За три минуты сформулируйте один общий результат дня.' : 'Предложите добровольный круг благодарностей: какой конкретный поступок коллеги помог вам в работе?'}</p><div className="button-row"><button className="button" onClick={() => setState('accepted')}>Предложить команде</button><button className="button secondary" onClick={() => setState('later')}>Позже</button></div>
    </> : <div className="success"><h3>Наш следующий шаг</h3><p>{title}</p><p className="muted">Демонстрационная договорённость. Обсудите её и затем оцените пользу.</p>{state === 'accepted' ? <div className="button-row"><button className="button" onClick={() => setState('helped')}>Помогло</button><button className="button secondary" onClick={() => setState('unhelpful')}>Не помогло</button></div> : <p role="status">{state === 'helped' ? 'Демо-отзыв: предложение помогло.' : 'Демо-отзыв: стоит попробовать другое предложение.'} Командная статистика отзывов здесь не публикуется.</p>}</div>}
  </section>
}
