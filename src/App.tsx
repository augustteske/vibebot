import { useEffect, useState } from 'react'
import { CheckinPanel } from './features/checkin/CheckinPanel'
import { InsightsPanel } from './features/insights/InsightsPanel'
import { ActionsPanel } from './features/actions/ActionsPanel'
import { aggregateRound } from './core/rules'
import { demoRounds } from './demo/fixtures'
import { TeamWorkspace } from './core/TeamWorkspace'
import { LandingPage } from './core/LandingPage'
import { DemoDashboard } from './core/DemoDashboard'
import { GuidePage } from './core/GuidePage'
import { NotFoundPage } from './core/NotFoundPage'
import { ThemeToggle } from './core/ThemeToggle'
import { FeedbackModal } from './core/FeedbackModal'
import './App.css'

export default function App() {
  const [scenario, setScenario] = useState<keyof typeof demoRounds>('clarity')
  const [guide, setGuide] = useState(() => window.location.pathname === '/guide')
  const [demo, setDemo] = useState(() => window.location.pathname === '/demo')
  const hasTeamHash = () => window.location.hash.startsWith('#invite=') || window.location.hash.startsWith('#room=')
  const [team, setTeam] = useState(() => window.location.pathname !== '/demo' && window.location.pathname !== '/guide' && (new URLSearchParams(window.location.search).get('mode') === 'team' || hasTeamHash()))
  const [enteredWorkspace, setEnteredWorkspace] = useState(() => window.location.pathname !== '/demo' && window.location.pathname !== '/guide' && (new URLSearchParams(window.location.search).get('mode') === 'team' || hasTeamHash()))
  const summary = aggregateRound(demoRounds[scenario])
  const knownPath = window.location.pathname === '/' || window.location.pathname === '/demo' || window.location.pathname === '/guide'

  useEffect(() => {
    function syncRoute() {
      const guideRoute = window.location.pathname === '/guide'
      const demoRoute = !guideRoute && window.location.pathname === '/demo'
      const teamRoute = !guideRoute && !demoRoute && (new URLSearchParams(window.location.search).get('mode') === 'team' || window.location.hash.startsWith('#invite=') || window.location.hash.startsWith('#room='))
      setGuide(guideRoute)
      setDemo(demoRoute)
      setTeam(teamRoute)
      setEnteredWorkspace(teamRoute)
    }
    window.addEventListener('popstate', syncRoute)
    return () => window.removeEventListener('popstate', syncRoute)
  }, [])

  function mode(next: boolean) {
    setGuide(false)
    setDemo(false)
    setTeam(next)
    setEnteredWorkspace(true)
    window.history.pushState(null, '', '/' + (next ? '?mode=team' : '') + window.location.hash)
  }

  function openDemo() {
    window.history.pushState(null, '', '/demo')
    setGuide(false)
    setDemo(true)
    setTeam(false)
    setEnteredWorkspace(false)
  }

  function openGuide() {
    window.history.pushState(null, '', '/guide')
    setGuide(true)
    setDemo(false)
    setTeam(false)
    setEnteredWorkspace(false)
  }

  function openHome() {
    window.history.pushState(null, '', '/')
    setGuide(false)
    setDemo(false)
    setTeam(false)
    setEnteredWorkspace(false)
  }

  if (guide) {
    return <GuidePage onBack={openHome} onEnter={() => mode(true)} onDemo={openDemo} />
  }
  if (demo) {
    return <DemoDashboard onBack={openHome} onEnter={() => mode(true)} onCreateTeam={() => mode(true)} />
  }
  if (!knownPath) return <NotFoundPage />
  if (!enteredWorkspace) {
    return <LandingPage
      onEnter={() => mode(true)}
      onDemo={openDemo}
      onGuide={openGuide}
      onJoinByKey={key => {
        window.history.pushState(null, '', '/?mode=team#room=' + encodeURIComponent(key))
        setGuide(false)
        setDemo(false)
        setTeam(true)
        setEnteredWorkspace(true)
      }}
    />
  }
  return <main className="workspace">
    <header><a className="brand" href="/" onClick={event => {
      event.preventDefault()
      openHome()
    }}><img src="/bee.svg" alt=""/>Vibee</a><div className="header-actions"><span className="badge">{team ? 'Пространство команды' : 'Демонстрация · вымышленные данные'}</span><ThemeToggle /></div></header>
    <section className="intro"><span className="eyebrow">ПРОСТРАНСТВО КОМАНДЫ</span><h1>Почувствовать команду.<br/>Сделать следующий шаг.</h1><p>Ресурс, ясность и поддержка — повод договориться о том, что поможет сегодня. Утилита для рабочих чатов — в разработке.</p></section>
    <nav className="mode-switch" aria-label="Режим"><button className="button secondary" aria-pressed={!team} onClick={() => mode(false)}>Демонстрационный режим</button><button className="button secondary" aria-pressed={team} onClick={() => mode(true)}>Моя команда</button></nav>
    {team ? <TeamWorkspace onOpenGuide={openGuide}/> : <>
      <label className="scenario">Демо-сценарий <select value={scenario} onChange={e => setScenario(e.target.value as keyof typeof demoRounds)}><option value="clarity">Шесть участников · мало ясности</option><option value="small">Четыре участника · данные скрыты</option><option value="open">Раунд ещё открыт</option></select></label>
      <div className="grid"><section><InsightsPanel summary={summary}/><ActionsPanel key={scenario} summary={summary}/></section><aside><CheckinPanel/><div className="note"><strong>Ты управляешь следующим шагом</strong><p>Предложения публикуются после подтверждения. Этот режим использует вымышленные данные, без подключения ИИ. Для сохранения и совместной работы откройте «Моя команда».</p></div></aside></div>
    </>}
    <footer><div className="footer-links"><span>Vibee · Shertwg group</span><a href="/guide" onClick={event => { event.preventDefault(); openGuide(); }}>Инструкция по подключению</a></div><FeedbackModal/></footer>
  </main>
}
