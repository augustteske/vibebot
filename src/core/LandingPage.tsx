import { useEffect } from 'react'
import './LandingPage.css'

interface LandingPageProps {
  onEnter: () => void;
}

const steps = [
  {
    number: '01',
    label: 'ПОДКЛЮЧИТЕ ЧАТ',
    title: 'Пригласите бота',
    description: 'Выберите рабочую группу. Личные сообщения остаются личными — Vibee их не анализирует.',
  },
  {
    number: '02',
    label: 'ЗАДАЙТЕ РИТМ',
    title: 'Настройте расписание',
    description: 'Отметьте рабочие часы команды, чтобы сравнивать только подходящие периоды.',
  },
  {
    number: '03',
    label: 'НАЙДИТЕ СЛЕДУЮЩИЙ ШАГ',
    title: 'Получайте ИИ-рекомендации',
    description: 'Бережные гипотезы по общим сигналам помогают начать разговор — без рейтингов людей.',
  },
]

export function LandingPage({ onEnter }: LandingPageProps) {
  useEffect(() => {
    const revealElements = Array.from(document.querySelectorAll<HTMLElement>('.landing-reveal'))
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (reducedMotion || typeof IntersectionObserver === 'undefined') {
      revealElements.forEach(element => element.classList.add('is-visible'))
      return
    }

    const observer = new IntersectionObserver((entries, currentObserver) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible')
          currentObserver.unobserve(entry.target)
        }
      })
    }, { threshold: 0.14, rootMargin: '0px 0px -8% 0px' })

    revealElements.forEach(element => observer.observe(element))
    return () => observer.disconnect()
  }, [])

  return (
    <main className="landing">
      <header className="landing-header">
        <a className="landing-brand" href="/" aria-label="Vibee — главная">
          <img src="/bee.svg" alt="" />
          <span>vibee</span>
        </a>
        <nav className="landing-nav" aria-label="Навигация по странице">
          <a href="#how-it-works">Как это работает</a>
          <a href="#privacy">Приватность</a>
          <button className="landing-nav-cta" onClick={onEnter}>Войти в кабинет</button>
        </nav>
      </header>

      <section className="landing-hero">
        <div className="landing-copy landing-reveal landing-reveal--hero">
          <span className="landing-eyebrow"><span className="landing-eyebrow-dot" /> КОМАНДНАЯ АНАЛИТИКА С УВАЖЕНИЕМ К ЛЮДЯМ</span>
          <h1>Почувствовать команду.<br /><span>Сделать следующий шаг.</span></h1>
          <p>
            Vibee помогает замечать общие сигналы в рабочем чате и превращать их
            в бережные командные договорённости. Не оцениваем людей — помогаем
            команде выбрать, что попробовать дальше.
          </p>
          <div className="landing-actions">
            <button className="landing-cta" onClick={onEnter}>
              Войти в кабинет <span aria-hidden="true">↗</span>
            </button>
            <a className="landing-github" href="https://github.com/augustteske/vibebot" target="_blank" rel="noreferrer">
              GitHub <span aria-hidden="true">↗</span>
            </a>
          </div>
          <div className="landing-proof">
            <span className="landing-proof-icon" aria-hidden="true">✓</span>
            <span>Только с согласия команды · без чтения личных сообщений</span>
          </div>
        </div>
        <div className="landing-mascot landing-reveal landing-reveal--mascot" aria-hidden="true">
          <div className="landing-orbit landing-orbit--outer" />
          <div className="landing-orbit landing-orbit--inner" />
          <div className="landing-mascot-glow" />
          <img src="/bee.svg" alt="" />
          <div className="landing-float-card landing-float-card--top">
            <span className="landing-float-dot" />
            Команда — не набор метрик
          </div>
          <div className="landing-float-card landing-float-card--bottom">
            <span className="landing-float-spark" aria-hidden="true">✳</span>
            Следующий шаг — вместе
          </div>
        </div>
      </section>

      <section className="landing-how landing-reveal" id="how-it-works" aria-labelledby="landing-how-title">
        <div className="landing-section-heading">
          <div>
            <span className="landing-eyebrow">ТРИ ШАГА К ЯСНОСТИ</span>
            <h2 id="landing-how-title">Как это работает</h2>
          </div>
          <p>Небольшой ритуал, который помогает команде говорить о важном.</p>
        </div>
        <div className="landing-step-grid">
          {steps.map(step => (
            <article className={`landing-step-card landing-reveal landing-step-card--${step.number}`} key={step.number}>
              <div className="landing-step-top">
                <span className="landing-step-number">{step.number}</span>
                <span className="landing-step-line" />
              </div>
              <span className="landing-step-label">{step.label}</span>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-privacy landing-reveal" id="privacy" aria-labelledby="landing-privacy-title">
        <div className="landing-lock" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M7.5 10V7.5a4.5 4.5 0 0 1 9 0V10M6.75 10h10.5c.97 0 1.75.78 1.75 1.75v7.5c0 .97-.78 1.75-1.75 1.75H6.75C5.78 21 5 20.22 5 19.25v-7.5C5 10.78 5.78 10 6.75 10Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M12 14v3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        </div>
        <div className="landing-privacy-copy">
          <span className="landing-eyebrow">ПРИВАТНОСТЬ — ОСНОВА</span>
          <h2 id="landing-privacy-title">Доверие не должно быть настройкой.</h2>
          <p>
            Аналитика включается только после согласия участников. Сырые тексты
            автоматически удаляются не позднее чем через 15 минут; личные сообщения
            не анализируются. Данные помогают обсуждать процессы, а не оценивать людей.
          </p>
        </div>
        <span className="landing-privacy-stamp">СОГЛАСИЕ<br />ПРЕЖДЕ ВСЕГО</span>
      </section>

      <footer className="landing-footer landing-reveal">
        <a className="landing-footer-brand" href="/" aria-label="Vibee — главная">
          <img src="/bee.svg" alt="" />
          <span>vibee</span>
        </a>
        <span className="landing-footer-note">Командные сигналы. Решения — за людьми.</span>
        <nav className="landing-footer-links" aria-label="Ресурсы">
          <a href="https://github.com/augustteske/vibebot" target="_blank" rel="noreferrer">GitHub <span aria-hidden="true">↗</span></a>
          <a href="https://gitlab.com/shertwg-group1/vibebot/-/tree/main/docs" target="_blank" rel="noreferrer">Документация</a>
          <a href="https://opensource.org/license/mit" target="_blank" rel="noreferrer">MIT License</a>
        </nav>
      </footer>
    </main>
  )
}
