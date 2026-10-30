import { useState } from 'react'
import type { Scores } from '../../core/model'
export function CheckinPanel() {
  const [scores, setScores] = useState<Scores>({ energy: 3, clarity: 3, support: 3 })
  const [saved, setSaved] = useState(false)
  return <section className="panel"><h2>Как ты сегодня?</h2><p className="muted">Три коротких вопроса. Участие добровольное.</p>
    <form onSubmit={e => { e.preventDefault(); setSaved(true) }}>
      {([['energy','Сколько сил на работу?'],['clarity','Понятно, что сейчас главное?'],['support','Легко попросить помощи?']] as const).map(([key,label]) => <label className="field" key={key}>{label} <strong>{scores[key]}/5</strong><input type="range" min="1" max="5" step="1" value={scores[key]} onChange={e => {setSaved(false);setScores({...scores,[key]:Number(e.target.value)})}}/></label>)}
      <button className="button" type="submit">Попробовать чек-ин</button>
      <p className="status" role="status">{saved ? 'Демо-чек-ин пройден. Ответы существуют только в памяти этой страницы и не меняют закрытый раунд.' : 'Демо: ответы не отправляются на сервер.'}</p>
    </form>
  </section>
}
