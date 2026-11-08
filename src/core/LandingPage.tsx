import { useEffect } from 'react'
import { ThemeToggle } from './ThemeToggle'
import './LandingPage.css'

interface LandingPageProps {
  onEnter: () => void;
  onDemo: () => void;
}

const features = [
  {
    number: '01',
    title: 'Только общая картина',
    description: 'Показатели помогают заметить динамику команды — без персональных рейтингов и оценки отдельных людей.',
    icon: '↗',
  },
  {
    number: '02',
    title: 'Рекомендации — повод обсудить',
    description: 'Шаблонная гипотеза предлагает небольшой следующий шаг. Решение всегда остаётся за командой.',
    icon: '✳',
  },
  {
    number: '03',
    title: 'Обратная связь замыкает цикл',
    description: 'Команда отмечает, помог ли выбранный шаг, и использует этот опыт для следующего обсуждения.',
    icon: '✓',
  },
]

const steps = [
  {
    number: '01',
    label: 'СНАЧАЛА СОГЛАСИЕ',
    title: 'Подключите чат',
    description: 'Участие начинается только после согласия компании и каждого участника группы.',
  },
  {
    number: '02',
    label: 'ЗАТЕМ — ДАННЫЕ',
    title: 'Дождитесь периода',
    description: 'Система проверяет, достаточно ли сообщений для допустимых общих показателей.',
  },
  {
    number: '03',
    label: 'НАКОНЕЦ — ДИАЛОГ',
    title: 'Выберите следующий шаг',
    description: 'Обсудите шаблонную рекомендацию, подтвердите действие и поделитесь обратной связью.',
  },
]

export function LandingPage({ onEnter, onDemo }: LandingPageProps) {
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
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' })

    revealElements.forEach(element => observer.observe(element))
    return () => observer.disconnect()
  }, [])

  return (
    <main className="landing" id="top">
      <header className="landing-header">
        <a className="landing-brand" href="#top" aria-label="Vibee — главная">
          <img src="/bee.svg" alt="" />
          <span>vibee</span>
        </a>
        <nav className="landing-nav" aria-label="Навигация по странице">
          <a href="#features">Преимущества</a>
          <a href="#how-it-works">Как это работает</a>
          <ThemeToggle />
          <button className="landing-nav-cta" onClick={onEnter}>Войти в кабинет</button>
        </nav>
      </header>

      <section className="landing-hero" aria-labelledby="landing-hero-title">
        <div className="landing-copy landing-reveal landing-reveal--hero">
          <span className="landing-eyebrow"><span className="landing-eyebrow-dot" /> VIBEE · ДЛЯ КОМАНД</span>
          <h1 id="landing-hero-title">Общайтесь.<br /><span>Замечайте главное.</span></h1>
          <p>
            Общие сигналы помогают команде обсуждать рабочий ритм, выбирать
            бережные шаги и вместе проверять, что изменилось.
          </p>
          <div className="landing-actions">
            <button className="landing-cta" onClick={onEnter}>
              Войти в кабинет <span aria-hidden="true">→</span>
            </button>
            <button className="landing-demo-link" type="button" onClick={onDemo}>
              Посмотреть демо <span aria-hidden="true">↗</span>
            </button>
            <a className="landing-github" href="https://github.com/augustteske/vibebot" target="_blank" rel="noreferrer">
              GitHub <span aria-hidden="true">↗</span>
            </a>
            <span className="landing-demo-note">Демонстрация на вымышленных данных</span>
          </div>
        </div>
        <div className="landing-mascot landing-reveal landing-reveal--mascot" aria-hidden="true">
          <div className="landing-mascot-glow" />
          <div className="landing-orbit landing-orbit--outer" />
          <img src="/bee-mascot.png" alt="" width="1280" height="1280" fetchPriority="high" />
          <span className="landing-float-card landing-float-card--top">Решения — за командой</span>
          <span className="landing-float-card landing-float-card--bottom">Только общие сигналы</span>
        </div>
      </section>

      <section className="landing-features" id="features" aria-labelledby="landing-features-title">
        <div className="landing-section-inner">
          <div className="landing-section-heading landing-reveal">
            <div>
              <span className="landing-eyebrow">ПРИНЦИПЫ VIBEE</span>
              <h2 id="landing-features-title">Больше ясности.<br /><span>Меньше шума.</span></h2>
            </div>
            <p>Инструменты для общего разговора — не для наблюдения за отдельными людьми.</p>
          </div>
          <div className="landing-feature-grid">
            {features.map(feature => (
              <article className="landing-feature-card landing-reveal" key={feature.number}>
                <div className="landing-feature-top">
                  <span className="landing-feature-number">{feature.number}</span>
                  <span className="landing-feature-icon" aria-hidden="true">{feature.icon}</span>
                </div>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-how" id="how-it-works" aria-labelledby="landing-how-title">
        <div className="landing-section-inner">
          <div className="landing-section-heading landing-reveal">
            <div>
              <span className="landing-eyebrow">ПРОСТОЙ ПУТЬ</span>
              <h2 id="landing-how-title">От согласия<br />к общему шагу.</h2>
            </div>
            <p>Каждый этап понятен участникам, а решение о следующем действии принимает сама команда.</p>
          </div>
          <div className="landing-step-grid">
            {steps.map(step => (
              <article className="landing-step-card landing-reveal" key={step.number}>
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
        </div>
      </section>

      <section className="landing-privacy" id="privacy" aria-labelledby="landing-privacy-title">
        <div className="landing-privacy-inner landing-reveal">
          <div className="landing-lock" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M7.5 10V7.5a4.5 4.5 0 0 1 9 0V10M6.75 10h10.5c.97 0 1.75.78 1.75 1.75v7.5c0 .97-.78 1.75-1.75 1.75H6.75C5.78 21 5 20.22 5 19.25v-7.5C5 10.78 5.78 10 6.75 10Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M12 14v3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </div>
          <div className="landing-privacy-copy">
            <span className="landing-eyebrow">ПРИВАТНОСТЬ — ОСНОВА</span>
            <h2 id="landing-privacy-title">Нет согласия — нет сбора.</h2>
            <p>
              Каждый участник может отказаться или отозвать согласие. Тогда обработка
              останавливается, а сохранённые сообщения удаляются по правилам хранения.
            </p>
            <p className="landing-privacy-note">
              Сейчас Telegram-контур проверяется только на вымышленных данных. Реальные
              чаты не подключены, внешний ИИ не используется.
            </p>
          </div>
          <span className="landing-privacy-stamp">ВЫМЫШЛЕННЫЕ<br />ДЕМО-ДАННЫЕ</span>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <a className="landing-footer-brand" href="#top" aria-label="Vibee — наверх">
            <img src="/bee.svg" alt="" />
            <span>vibee</span>
          </a>
          <span className="landing-footer-note">Общие сигналы. Решения — за командой.</span>
          <nav className="landing-footer-links" aria-label="Ссылки">
            <a href="https://github.com/augustteske/vibebot" target="_blank" rel="noreferrer">GitHub <span aria-hidden="true">↗</span></a>
            <a href="/docs.html">Документация</a>
            <a href="https://opensource.org/license/mit" target="_blank" rel="noreferrer">MIT License</a>
          </nav>
        </div>
      </footer>
    </main>
  )
}
