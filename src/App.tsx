import { useState } from 'react'
import { CheckinPanel } from './features/checkin/CheckinPanel'
import { InsightsPanel } from './features/insights/InsightsPanel'
import { ActionsPanel } from './features/actions/ActionsPanel'
import { aggregateRound } from './core/rules'
import { demoRounds } from './demo/fixtures'
import './App.css'

export default function App() {
  const [scenario, setScenario] = useState<keyof typeof demoRounds>('clarity')
  const summary = aggregateRound(demoRounds[scenario])
  return <main className="workspace">
    <header><a className="brand" href="#">✦ VibeBot</a><span className="badge">Демонстрация · вымышленные данные</span></header>
    <section className="intro"><span className="eyebrow">ПРОСТРАНСТВО КОМАНДЫ</span><h1>Почувствовать команду.<br/>Сделать следующий шаг.</h1><p>Ресурс, ясность и поддержка — повод договориться о том, что поможет сегодня.</p></section>
    <label className="scenario">Демо-сценарий <select value={scenario} onChange={e => setScenario(e.target.value as keyof typeof demoRounds)}><option value="clarity">Шесть участников · мало ясности</option><option value="small">Четыре участника · данные скрыты</option><option value="open">Раунд ещё открыт</option></select></label>
    <div className="grid"><section><InsightsPanel summary={summary}/><ActionsPanel key={scenario} summary={summary}/></section><aside><CheckinPanel/><div className="note"><strong>Ты управляешь следующим шагом</strong><p>Предложения публикуются после подтверждения. Этот прототип работает локально, с вымышленными данными и без подключения ИИ.</p></div></aside></div>
    <footer>VibeBot · Hackathon 2026 · Август, Илиан, Арина, Алиса</footer>
  </main>
}
