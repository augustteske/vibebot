import { useEffect, useState } from 'react'
import type { SyntheticEvent } from 'react'
import { ThemeToggle } from './ThemeToggle'
import { isNewYearSeason } from './theme'
import './LandingPage.css'

// Большая картинка идёт через прокси предпросмотра и иногда получает 502.
// Одна повторная загрузка с новым адресом возвращает её без перезагрузки страницы.
function retryImageOnce(event: SyntheticEvent<HTMLImageElement>) {
  const image = event.currentTarget
  if (image.dataset.retry) return
  image.dataset.retry = '1'
  const source = image.src.split('?')[0]
  window.setTimeout(() => { image.src = source + '?retry=' + Date.now() }, 600)
}

interface LandingPageProps {
  onEnter: () => void;
  onDemo: () => void;
  onJoinByKey?: (roomKey: string) => void;
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

const contrastPairs = [
  {
    id: 'focus',
    beforeTitle: 'Размытые приоритеты в потоке чатов',
    beforeText: 'Десятки параллельных обсуждений и срочных пингов: к середине дня непонятно, какая задача действительно главная.',
    beforeDetail: 'Хаотичные переписки отнимают время команды. Люди переключаются между тредами и теряют контекст важных договорённостей.',
    afterTitle: 'Понятный фокус на день',
    afterText: 'Короткий чек-ин и сводка показывают уровень ясности приоритетов и помогают команде выбрать одну главную цель.',
    afterDetail: 'Один вопрос утром задаёт единый фокус всей команде. В чате появляется прозрачность: каждый понимает приоритеты на сегодня.',
  },
  {
    id: 'rhythm',
    beforeTitle: 'Незаметная усталость и переработки',
    beforeText: 'Ночные сообщения и неравномерная вовлечённость видны только постфактум, когда у людей уже закончился ресурс.',
    beforeDetail: 'Поздние ответы создают негласное давление отвечать 24/7. Команда незаметно выгорает, а тимлид узнаёт об этом слишком поздно.',
    afterTitle: 'Бережные командные метрики',
    afterText: 'Агрегаты без личных рейтингов подсвечивают долю сообщений вне расписания, равномерность участия и уровень поддержки.',
    afterDetail: 'Анонимная агрегация фиксирует баланс общения и мягко сигнализирует о перегрузке без слежки за конкретными людьми.',
  },
  {
    id: 'action',
    beforeTitle: 'Обсуждения без конкретного шага',
    beforeText: 'Проблемы озвучиваются на созвонах, но теряются в переписке без понятной договорённости и проверки результата.',
    beforeDetail: 'Ретроспективы превращаются в бесконечные разговоры: много жалоб, но никто не фиксирует одно простое действие на следующую неделю.',
    afterTitle: 'Готовая рекомендация и обратная связь',
    afterText: 'Vibee предлагает конкретный следующий шаг по самому заметному сигналу, а команда отмечает, принёс ли он пользу.',
    afterDetail: 'Готовые шаблоны гипотез и голосование за 10 секунд: команда выбирает шаг и через неделю проверяет, стало ли лучше.',
  },
]

const snowflakes = Array.from({ length: 18 }, (_, index) => ({
  id: index,
  left: `${(index * 17 + 5) % 96}%`,
  delay: `${((index * 1.3) % 8).toFixed(1)}s`,
  duration: `${10 + (index % 6) * 2}s`,
  size: `${6 + (index % 4) * 3}px`,
}))

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

export function LandingPage({ onEnter, onDemo, onJoinByKey }: LandingPageProps) {
  const [roomKey, setRoomKey] = useState('')
  const [newYear] = useState(() => isNewYearSeason())
  const [activeContrastIndex, setActiveContrastIndex] = useState(0)
  const [expandedContrastCard, setExpandedContrastCard] = useState<string | null>(null)
  const [contrastView, setContrastView] = useState<'split' | 'before' | 'after'>('split')

  const handleToggleContrast = (cardKey: string, index: number) => {
    setActiveContrastIndex(index)
    setExpandedContrastCard((prev) => (prev === cardKey ? null : cardKey))
  }

  useEffect(() => {
    document.documentElement.dataset.season = newYear ? 'new-year' : 'default'
  }, [newYear])

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
    <main className={'landing' + (newYear ? ' landing--new-year' : '')} id="top">
      {newYear && (
        <div className="landing-snow" aria-hidden="true">
          {snowflakes.map(flake => (
            <span
              key={flake.id}
              className="landing-snowflake"
              style={{
                left: flake.left,
                width: flake.size,
                height: flake.size,
                animationDelay: flake.delay,
                animationDuration: flake.duration,
              }}
            />
          ))}
        </div>
      )}
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
          <form
            className="landing-room-key"
            aria-label="У меня есть ключ комнаты"
            onSubmit={event => {
              event.preventDefault()
              const trimmed = roomKey.trim().toUpperCase()
              if (!trimmed) return
              if (onJoinByKey) {
                onJoinByKey(trimmed)
              } else {
                window.history.pushState(null, '', '/?mode=team#room=' + encodeURIComponent(trimmed))
                onEnter()
              }
            }}
          >
            <label className="landing-room-key__label" htmlFor="landing-room-key-input">
              У меня есть ключ комнаты
            </label>
            <div className="landing-room-key__controls">
              <input
                id="landing-room-key-input"
                name="roomKey"
                value={roomKey}
                onChange={event => setRoomKey(event.target.value.toUpperCase())}
                maxLength={16}
                autoComplete="off"
                placeholder="Код от тимлида (напр. A1B2C3D4)"
                required
              />
              <button className="landing-room-key__submit" type="submit">
                Войти
              </button>
            </div>
          </form>
        </div>
        <div className="landing-mascot landing-reveal landing-reveal--mascot" aria-hidden="true">
          <div className="landing-mascot-glow" />
          <div className="landing-orbit landing-orbit--outer" />
          <div className="landing-mascot-figure">
            {newYear && (
              <svg
                className="landing-mascot-hat"
                viewBox="0 0 160 120"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path
                  d="M26 86C34 44 68 18 118 22C130 23 138 34 134 45C124 41 105 44 92 58L122 86H26Z"
                  fill="url(#vibeeHatRed)"
                />
                <circle cx="136" cy="38" r="15" fill="#FFFDF7" stroke="#E5DEC9" strokeWidth="2" />
                <rect x="16" y="80" width="114" height="24" rx="12" fill="#FFFDF7" stroke="#E5DEC9" strokeWidth="2" />
                <defs>
                  <linearGradient id="vibeeHatRed" x1="26" y1="20" x2="128" y2="90" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#EF3B2D" />
                    <stop offset="0.6" stopColor="#C81E1E" />
                    <stop offset="1" stopColor="#9B1414" />
                  </linearGradient>
                </defs>
              </svg>
            )}
            <img src="/bee-mascot.png" alt="" width="1280" height="1280" fetchPriority="high" onError={retryImageOnce} />
          </div>
          <span className="landing-float-card landing-float-card--top">Решения — за командой</span>
          <span className="landing-float-card landing-float-card--bottom">Только общие сигналы</span>
        </div>
      </section>

      <section className="landing-contrast" id="contrast" aria-labelledby="landing-contrast-title">
        <div className="landing-section-inner">
          <div className="landing-section-heading landing-reveal">
            <div>
              <span className="landing-eyebrow">ПРОБЛЕМА → РЕШЕНИЕ</span>
              <h2 id="landing-contrast-title">Было — хаос.<br /><span>Стало — ясность.</span></h2>
            </div>
            <div className="landing-contrast-controls">
              <p>Выберите любую ситуацию или переключите режим сравнения, чтобы увидеть, как меняется командный ритм.</p>
              <div className="landing-contrast-tabs" role="group" aria-label="Режим сравнения">
                <button
                  type="button"
                  className={'landing-contrast-tab' + (contrastView === 'split' ? ' is-active' : '')}
                  aria-pressed={contrastView === 'split'}
                  onClick={() => setContrastView('split')}
                >
                  Было / Стало
                </button>
                <button
                  type="button"
                  className={'landing-contrast-tab' + (contrastView === 'before' ? ' is-active' : '')}
                  aria-pressed={contrastView === 'before'}
                  onClick={() => setContrastView('before')}
                >
                  Было: проблема
                </button>
                <button
                  type="button"
                  className={'landing-contrast-tab' + (contrastView === 'after' ? ' is-active' : '')}
                  aria-pressed={contrastView === 'after'}
                  onClick={() => setContrastView('after')}
                >
                  Стало: решение
                </button>
              </div>
            </div>
          </div>

          <div className={'landing-contrast-grid landing-contrast-grid--' + contrastView}>
            {contrastView !== 'after' && (
              <article className="landing-contrast-card landing-contrast-card--before landing-reveal">
                <div className="landing-contrast-card__header">
                  <span className="landing-contrast-badge landing-contrast-badge--before">БЫЛО · ПРОБЛЕМА</span>
                  <h3>Было: хаос в чатах, непонятные задачи</h3>
                </div>
                <ul className="landing-contrast-list">
                  {contrastPairs.map((pair, index) => {
                    const cardKey = `before-${index}`
                    const isExpanded = expandedContrastCard === cardKey
                    const isSelected = activeContrastIndex === index
                    return (
                      <li key={pair.id}>
                        <button
                          type="button"
                          className={
                            'landing-contrast-item' +
                            (isSelected ? ' is-selected' : '') +
                            (isExpanded ? ' is-expanded' : '')
                          }
                          onClick={() => handleToggleContrast(cardKey, index)}
                          aria-expanded={isExpanded}
                          aria-pressed={isSelected}
                          aria-label={`Было 0${index + 1}: ${pair.beforeTitle}`}
                        >
                          <span className="landing-contrast-item__index">0{index + 1}</span>
                          <div className="landing-contrast-item__body">
                            <strong>{pair.beforeTitle}</strong>
                            <p>{pair.beforeText}</p>
                            <div className="landing-contrast-item__expanded">
                              <div className="landing-contrast-item__expanded-inner">
                                <p className="landing-contrast-item__detail">{pair.beforeDetail}</p>
                                <div className="landing-contrast-video-box" aria-label="Видео подключения">
                                  <div className="landing-contrast-video-placeholder">
                                    <div className="landing-contrast-video-play-btn" aria-hidden="true">
                                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M8 5v14l11-7z" />
                                      </svg>
                                    </div>
                                    <span className="landing-contrast-video-title">Видео подключения</span>
                                    <span className="landing-contrast-video-badge">демо · без звука</span>
                                  </div>
                                  {/* Временная заглушка: для подключения видео добавьте src="/demo/contrast-before.mp4" */}
                                  <video
                                    className="landing-contrast-video"
                                    autoPlay
                                    muted
                                    loop
                                    playsInline
                                    aria-hidden="true"
                                    tabIndex={-1}
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </article>
            )}

            {contrastView === 'split' && (
              <div className="landing-contrast-arrow landing-reveal" aria-hidden="true">
                <span>→</span>
              </div>
            )}

            {contrastView !== 'before' && (
              <article className="landing-contrast-card landing-contrast-card--after landing-reveal">
                <div className="landing-contrast-card__header">
                  <span className="landing-contrast-badge landing-contrast-badge--after">СТАЛО · РЕШЕНИЕ VIBEE</span>
                  <h3>Стало: понятные метрики и рекомендации</h3>
                </div>
                <ul className="landing-contrast-list">
                  {contrastPairs.map((pair, index) => {
                    const cardKey = `after-${index}`
                    const isExpanded = expandedContrastCard === cardKey
                    const isSelected = activeContrastIndex === index
                    return (
                      <li key={pair.id}>
                        <button
                          type="button"
                          className={
                            'landing-contrast-item' +
                            (isSelected ? ' is-selected' : '') +
                            (isExpanded ? ' is-expanded' : '')
                          }
                          onClick={() => handleToggleContrast(cardKey, index)}
                          aria-expanded={isExpanded}
                          aria-pressed={isSelected}
                          aria-label={`Стало 0${index + 1}: ${pair.afterTitle}`}
                        >
                          <span className="landing-contrast-item__index">0{index + 1}</span>
                          <div className="landing-contrast-item__body">
                            <strong>{pair.afterTitle}</strong>
                            <p>{pair.afterText}</p>
                            <div className="landing-contrast-item__expanded">
                              <div className="landing-contrast-item__expanded-inner">
                                <p className="landing-contrast-item__detail">{pair.afterDetail}</p>
                                <div className="landing-contrast-video-box" aria-label="Видео подключения">
                                  <div className="landing-contrast-video-placeholder">
                                    <div className="landing-contrast-video-play-btn" aria-hidden="true">
                                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M8 5v14l11-7z" />
                                      </svg>
                                    </div>
                                    <span className="landing-contrast-video-title">Видео подключения</span>
                                    <span className="landing-contrast-video-badge">демо · без звука</span>
                                  </div>
                                  {/* Временная заглушка: для подключения видео добавьте src="/demo/contrast-after.mp4" */}
                                  <video
                                    className="landing-contrast-video"
                                    autoPlay
                                    muted
                                    loop
                                    playsInline
                                    aria-hidden="true"
                                    tabIndex={-1}
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </article>
            )}
          </div>
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
