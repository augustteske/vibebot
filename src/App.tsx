import { useEffect, useState } from 'react'
import { CheckinPanel } from './features/checkin/CheckinPanel'
import { InsightsPanel } from './features/insights/InsightsPanel'
import { ActionsPanel } from './features/actions/ActionsPanel'
import { aggregateRound } from './core/rules'
import { demoRounds } from './demo/fixtures'
import { TeamWorkspace } from './core/TeamWorkspace'
import { LandingPage } from './core/LandingPage'
import { DemoDashboard } from './core/DemoDashboard'
import './App.css'

export default function App() {
  const [scenario, setScenario] = useState<keyof typeof demoRounds>('clarity')
  const [demo, setDemo] = useState(() => window.location.pathname === '/demo')
  const [team, setTeam] = useState(() => window.location.pathname !== '/demo' && (new URLSearchParams(window.location.search).get('mode') === 'team' || window.location.hash.startsWith('#invite=')))
  const [enteredWorkspace, setEnteredWorkspace] = useState(() => window.location.pathname !== '/demo' && (new URLSearchParams(window.location.search).get('mode') === 'team' || window.location.hash.startsWith('#invite=')))
  const summary = aggregateRound(demoRounds[scenario])

  useEffect(() => {
    function syncRoute() {
      const demoRoute = window.location.pathname === '/demo'
      const teamRoute = !demoRoute && (new URLSearchParams(window.location.search).get('mode') === 'team' || window.location.hash.startsWith('#invite='))
      setDemo(demoRoute)
      setTeam(teamRoute)
      setEnteredWorkspace(teamRoute)
    }
    window.addEventListener('popstate', syncRoute)
    return () => window.removeEventListener('popstate', syncRoute)
  }, [])

  function mode(next: boolean) {
    setDemo(false)
    setTeam(next)
    setEnteredWorkspace(true)
    window.history.pushState(null, '', '/' + (next ? '?mode=team' : '') + window.location.hash)
  }

  function openDemo() {
    window.history.pushState(null, '', '/demo')
    setDemo(true)
    setTeam(false)
    setEnteredWorkspace(false)
  }

  function openHome() {
    window.history.pushState(null, '', '/')
    setDemo(false)
    setTeam(false)
    setEnteredWorkspace(false)
  }

  if (demo) {
    return <DemoDashboard onBack={openHome} onEnter={() => mode(true)} onCreateTeam={() => mode(true)} />
  }
  if (!enteredWorkspace) {
    return <LandingPage onEnter={() => mode(true)} onDemo={openDemo} />
  }
  return <main className="workspace">
    <header><a className="brand" href="/" onClick={event => {
      event.preventDefault()
      openHome()
    }}><img src="/bee.svg" alt=""/>Vibee</a><span className="badge">{team ? 'Пространство команды' : 'Демонстрация · вымышленные данные'}</span></header>
    <section className="intro"><span className="eyebrow">ПРОСТРАНСТВО КОМАНДЫ</span><h1>Почувствовать команду.<br/>Сделать следующий шаг.</h1><p>Ресурс, ясность и поддержка — повод договориться о том, что поможет сегодня. Утилита для рабочих чатов — в разработке.</p></section>
    <nav className="mode-switch" aria-label="Режим"><button className="button secondary" aria-pressed={!team} onClick={() => mode(false)}>Демо для питча</button><button className="button secondary" aria-pressed={team} onClick={() => mode(true)}>Моя команда</button></nav>
    {team ? <TeamWorkspace/> : <>
      <label className="scenario">Демо-сценарий <select value={scenario} onChange={e => setScenario(e.target.value as keyof typeof demoRounds)}><option value="clarity">Шесть участников · мало ясности</option><option value="small">Четыре участника · данные скрыты</option><option value="open">Раунд ещё открыт</option></select></label>
      <div className="grid"><section><InsightsPanel summary={summary}/><ActionsPanel key={scenario} summary={summary}/></section><aside><CheckinPanel/><div className="note"><strong>Ты управляешь следующим шагом</strong><p>Предложения публикуются после подтверждения. Этот режим использует вымышленные данные, без подключения ИИ. Для сохранения и совместной работы откройте «Моя команда».</p></div></aside></div>
    </>}
    <footer>Vibee · Hackathon 2026 · Август, Илиан, Арина, Алиса</footer>
  </main>
}
