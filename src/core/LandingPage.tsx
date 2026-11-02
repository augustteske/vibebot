import './LandingPage.css'

interface LandingPageProps {
  onEnter: () => void;
}

const features = [
  {
    icon: '◉',
    title: 'Приватность',
    description: 'Согласия участников, ограниченное хранение данных и никакого чтения личных сообщений.',
  },
  {
    icon: '◷',
    title: 'Умные метрики',
    description: 'Общий взгляд на время общения, равномерность участия и благодарности в команде.',
  },
  {
    icon: '✳',
    title: 'ИИ-рекомендации',
    description: 'Не диагнозы и оценки людей, а осторожные гипотезы и возможные следующие шаги.',
  },
]

export function LandingPage({ onEnter }: LandingPageProps) {
  return (
    <main className="landing">
      <header className="landing-header">
        <a className="landing-brand" href="/" aria-label="Vibee — главная">
          <img src="/bee.svg" alt="" />
          <span>Vibee</span>
        </a>
        <span className="landing-tag">Командная аналитика с уважением к людям</span>
      </header>

      <section className="landing-hero">
        <div className="landing-copy">
          <span className="landing-eyebrow">КОМАНДАМ, КОТОРЫМ НЕ ВСЁ РАВНО</span>
          <h1>Vibee — Почувствовать команду. Сделать следующий шаг.</h1>
          <p>
            Анализ коммуникации в Telegram с уважением к приватности. Помогаем тимлидам
            замечать изменения и предлагаем полезные действия. Показатели становятся
            поводом для диалога, а не оценкой отдельных людей.
          </p>
          <button className="landing-cta" onClick={onEnter}>
            Войти в кабинет <span aria-hidden="true">→</span>
          </button>
        </div>
        <div className="landing-mascot" aria-hidden="true">
          <span className="landing-sun" />
          <img src="/bee.svg" alt="" />
          <span className="landing-spark landing-spark--one">✳</span>
          <span className="landing-spark landing-spark--two">✦</span>
        </div>
      </section>

      <section className="landing-features" aria-labelledby="landing-features-title">
        <div className="landing-section-heading">
          <span className="landing-eyebrow">ПРОСТО И БЕРЕЖНО</span>
          <h2 id="landing-features-title">Features</h2>
        </div>
        <div className="landing-feature-grid">
          {features.map(feature => (
            <article className="landing-feature" key={feature.title}>
              <span className="landing-feature-icon" aria-hidden="true">{feature.icon}</span>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="landing-footer">
        Vibee помогает командам замечать общие сигналы — решения остаются за людьми.
      </footer>
    </main>
  )
}
