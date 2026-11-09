import { useEffect, useRef, useState } from 'react'
import type { SyntheticEvent } from 'react'
import { ThemeToggle } from './ThemeToggle'
import { LanguageToggle } from './LanguageToggle'
import { LanguageProvider, useLanguage } from './i18n'
import { isNewYearSeason } from './theme'
import { HoneycombBackground } from './HoneycombBackground'
import { DemoStamp } from './DemoStamp'
import './LandingPage.css'

export { DemoStamp }

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
  onGuide?: () => void;
}

const snowflakes = Array.from({ length: 18 }, (_, index) => ({
  id: index,
  left: `${(index * 17 + 5) % 96}%`,
  delay: `${((index * 1.3) % 8).toFixed(1)}s`,
  duration: `${10 + (index % 6) * 2}s`,
  size: `${6 + (index % 4) * 3}px`,
}))

function LandingPageContent({ onEnter, onDemo, onJoinByKey, onGuide }: LandingPageProps) {
  const { t, features, contrastPairs, steps, isTransitioning } = useLanguage()
  const [roomKey, setRoomKey] = useState('')
  const [newYear] = useState(() => isNewYearSeason())
  const [activeContrastIndex, setActiveContrastIndex] = useState(0)
  const [expandedContrastCard, setExpandedContrastCard] = useState<string | null>(null)
  const [contrastView, setContrastView] = useState<'split' | 'before' | 'after'>('split')
  const [isPrivacyLocked, setIsPrivacyLocked] = useState(false)
  const [isScrolled, setIsScrolled] = useState(false)
  const privacyRef = useRef<HTMLElement | null>(null)
  const lockTimeoutRef = useRef<number | null>(null)

  const handleRetriggerLock = () => {
    setIsPrivacyLocked(false)
    if (lockTimeoutRef.current) window.clearTimeout(lockTimeoutRef.current)
    lockTimeoutRef.current = window.setTimeout(() => {
      setIsPrivacyLocked(true)
    }, 280)
  }

  const handleToggleContrast = (cardKey: string, index: number) => {
    setActiveContrastIndex(index)
    setExpandedContrastCard((prev) => (prev === cardKey ? null : cardKey))
  }

  useEffect(() => {
    document.documentElement.dataset.season = newYear ? 'new-year' : 'default'
  }, [newYear])

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 16)
    }
    handleScroll()
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    const el = privacyRef.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setIsPrivacyLocked(true)
      return
    }

    const observer = new IntersectionObserver(
      entries => {
        const entry = entries[0]
        if (!entry) return

        if (entry.isIntersecting) {
          // При входе на слайд: задерживаем на 400мс в открытом состоянии, затем захлопываем
          if (lockTimeoutRef.current) window.clearTimeout(lockTimeoutRef.current)
          lockTimeoutRef.current = window.setTimeout(() => {
            setIsPrivacyLocked(true)
          }, 400)
        } else {
          // При уходе со слайда: сбрасываем в открытое состояние, чтобы при возврате анимация повторилась
          if (lockTimeoutRef.current) window.clearTimeout(lockTimeoutRef.current)
          setIsPrivacyLocked(false)
        }
      },
      { threshold: 0.2 }
    )

    observer.observe(el)
    return () => {
      observer.disconnect()
      if (lockTimeoutRef.current) window.clearTimeout(lockTimeoutRef.current)
    }
  }, [])

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
    <main className={'landing' + (newYear ? ' landing--new-year' : '') + (isTransitioning ? ' is-lang-switching' : '')} id="top">
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
      <header className={`landing-header${isScrolled ? ' is-scrolled' : ''}`}>
        <a className="landing-brand" href="#top" aria-label={t.footer.brandAria}>
          <img src="/bee.svg" alt="" />
          <span>vibee</span>
        </a>
        <nav className="landing-nav" aria-label={t.nav.ariaLabel}>
          <a href="#features">{t.nav.features}</a>
          <a href="#how-it-works">{t.nav.howItWorks}</a>
          <a
            href="/guide"
            onClick={event => {
              if (onGuide) {
                event.preventDefault()
                onGuide()
              }
            }}
          >
            {t.nav.guide}
          </a>
          <LanguageToggle />
          <ThemeToggle />
          <button className="landing-nav-cta" onClick={onEnter}>{t.nav.enter}</button>
        </nav>
      </header>

      <section className="landing-hero" aria-labelledby="landing-hero-title">
        <div className="landing-copy landing-reveal landing-reveal--hero">
          <span className="landing-eyebrow"><span className="landing-eyebrow-dot" /> {t.hero.eyebrow}</span>
          <h1 id="landing-hero-title">{t.hero.titleBefore}<br /><span>{t.hero.titleHighlight}</span></h1>
          <p>
            {t.hero.lead}
          </p>
          <div className="landing-actions">
            <button className="landing-cta" onClick={onEnter}>
              {t.hero.enterCta} <span aria-hidden="true">→</span>
            </button>
            <button
              className="landing-guide-link"
              type="button"
              onClick={() => {
                if (onGuide) onGuide()
                else window.location.href = '/guide'
              }}
            >
              {t.hero.guideLink} <span aria-hidden="true">↗</span>
            </button>
            <button className="landing-demo-link" type="button" onClick={onDemo}>
              {t.hero.demoLink} <span aria-hidden="true">↗</span>
            </button>
            <a className="landing-github" href="https://github.com/augustteske/vibebot" target="_blank" rel="noreferrer">
              GitHub <span aria-hidden="true">↗</span>
            </a>
            <span className="landing-demo-note">{t.hero.demoNote}</span>
          </div>
          <form
            className="landing-room-key"
            aria-label={t.hero.roomKeyLabel}
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
              {t.hero.roomKeyLabel}
            </label>
            <div className="landing-room-key__controls">
              <input
                id="landing-room-key-input"
                name="roomKey"
                value={roomKey}
                onChange={event => setRoomKey(event.target.value.toUpperCase())}
                maxLength={16}
                autoComplete="off"
                placeholder={t.hero.roomKeyPlaceholder}
                required
              />
              <button className="landing-room-key__submit" type="submit">
                {t.hero.roomKeySubmit}
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
          <span className="landing-float-card landing-float-card--top">{t.hero.floatTop}</span>
          <span className="landing-float-card landing-float-card--bottom">{t.hero.floatBottom}</span>
        </div>
      </section>

      <section className="landing-contrast" id="contrast" aria-labelledby="landing-contrast-title">
        <div className="landing-section-inner">
          <div className="landing-section-heading landing-reveal">
            <div>
              <span className="landing-eyebrow">{t.contrast.eyebrow}</span>
              <h2 id="landing-contrast-title">{t.contrast.titleBefore}<br /><span>{t.contrast.titleHighlight}</span></h2>
            </div>
            <div className="landing-contrast-controls">
              <p>{t.contrast.lead}</p>
              <div className="landing-contrast-tabs" role="group" aria-label="Режим сравнения">
                <button
                  type="button"
                  className={'landing-contrast-tab' + (contrastView === 'split' ? ' is-active' : '')}
                  aria-pressed={contrastView === 'split'}
                  onClick={() => setContrastView('split')}
                >
                  {t.contrast.tabSplit}
                </button>
                <button
                  type="button"
                  className={'landing-contrast-tab' + (contrastView === 'before' ? ' is-active' : '')}
                  aria-pressed={contrastView === 'before'}
                  onClick={() => setContrastView('before')}
                >
                  {t.contrast.tabBefore}
                </button>
                <button
                  type="button"
                  className={'landing-contrast-tab' + (contrastView === 'after' ? ' is-active' : '')}
                  aria-pressed={contrastView === 'after'}
                  onClick={() => setContrastView('after')}
                >
                  {t.contrast.tabAfter}
                </button>
              </div>
            </div>
          </div>

          <div className={'landing-contrast-grid landing-contrast-grid--' + contrastView}>
            {contrastView !== 'after' && (
              <article className="landing-contrast-card landing-contrast-card--before landing-reveal">
                <div className="landing-contrast-card__header">
                  <span className="landing-contrast-badge landing-contrast-badge--before">{t.contrast.beforeBadge}</span>
                  <h3>{t.contrast.beforeHeader}</h3>
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
                          aria-label={t.contrast.ariaBefore(index, pair.beforeTitle)}
                        >
                          <span className="landing-contrast-item__index">0{index + 1}</span>
                          <div className="landing-contrast-item__body">
                            <strong>{pair.beforeTitle}</strong>
                            <p>{pair.beforeText}</p>
                            <div className="landing-contrast-item__expanded">
                              <div className="landing-contrast-item__expanded-inner">
                                <p className="landing-contrast-item__detail">{pair.beforeDetail}</p>
                                <div className="landing-contrast-video-box" aria-label={t.contrast.videoPlaceholderTitle}>
                                  <div className="landing-contrast-video-placeholder">
                                    <div className="landing-contrast-video-play-btn" aria-hidden="true">
                                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M8 5v14l11-7z" />
                                      </svg>
                                    </div>
                                    <span className="landing-contrast-video-title">{t.contrast.videoPlaceholderTitle}</span>
                                    <span className="landing-contrast-video-badge">{t.contrast.videoPlaceholderBadge}</span>
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
                  <span className="landing-contrast-badge landing-contrast-badge--after">{t.contrast.afterBadge}</span>
                  <h3>{t.contrast.afterHeader}</h3>
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
                          aria-label={t.contrast.ariaAfter(index, pair.afterTitle)}
                        >
                          <span className="landing-contrast-item__index">0{index + 1}</span>
                          <div className="landing-contrast-item__body">
                            <strong>{pair.afterTitle}</strong>
                            <p>{pair.afterText}</p>
                            <div className="landing-contrast-item__expanded">
                              <div className="landing-contrast-item__expanded-inner">
                                <p className="landing-contrast-item__detail">{pair.afterDetail}</p>
                                <div className="landing-contrast-video-box" aria-label={t.contrast.videoPlaceholderTitle}>
                                  <div className="landing-contrast-video-placeholder">
                                    <div className="landing-contrast-video-play-btn" aria-hidden="true">
                                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M8 5v14l11-7z" />
                                      </svg>
                                    </div>
                                    <span className="landing-contrast-video-title">{t.contrast.videoPlaceholderTitle}</span>
                                    <span className="landing-contrast-video-badge">{t.contrast.videoPlaceholderBadge}</span>
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
              <span className="landing-eyebrow">{t.features.eyebrow}</span>
              <h2 id="landing-features-title">{t.features.titleBefore}<br /><span>{t.features.titleHighlight}</span></h2>
            </div>
            <p>{t.features.lead}</p>
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
              <span className="landing-eyebrow">{t.howItWorks.eyebrow}</span>
              <h2 id="landing-how-title">{t.howItWorks.titleBefore}<br /><span>{t.howItWorks.titleHighlight}</span></h2>
            </div>
            <p>{t.howItWorks.lead}</p>
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

      <section
        className={`landing-privacy${isPrivacyLocked ? ' is-in-view' : ''}`}
        id="privacy"
        ref={privacyRef}
        aria-labelledby="landing-privacy-title"
      >
        <HoneycombBackground opacity={0.85} interactive={true} />
        <div className="landing-privacy-inner landing-reveal">
          <div className={`landing-lock-wrapper${isPrivacyLocked ? ' is-locked' : ''}`}>
            <div className="landing-lock__shockwave" aria-hidden="true" />
            <button
              type="button"
              className={`landing-lock${isPrivacyLocked ? ' is-locked' : ''}`}
              onClick={handleRetriggerLock}
              aria-label={isPrivacyLocked ? t.privacy.lockAriaLocked : t.privacy.lockAriaUnlocked}
              title={t.privacy.lockTitle}
            >
              <div className="landing-lock__shimmer" aria-hidden="true" />
              <div className="landing-lock__spark" aria-hidden="true" />
              <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
                <path
                  className="landing-lock__shackle"
                  d="M10 15V9.5a6 6 0 0 1 12 0V15"
                  stroke="currentColor"
                  strokeWidth="2.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  className="landing-lock__body"
                  d="M6.5 14h19a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-19a3 3 0 0 1-3-3v-9a3 3 0 0 1 3-3Z"
                  stroke="currentColor"
                  strokeWidth="2.6"
                  strokeLinejoin="round"
                />
                <path
                  className="landing-lock__keyhole"
                  d="M16 19a2 2 0 0 0-1 3.73V24.5a1 1 0 0 0 2 0v-1.77A2 2 0 0 0 16 19Z"
                  fill="currentColor"
                />
              </svg>
            </button>
            <span className="landing-lock-badge">
              {isPrivacyLocked ? t.privacy.lockBadgeLocked : t.privacy.lockBadgeUnlocked}
            </span>
          </div>
          <div className="landing-privacy-copy">
            <span className="landing-eyebrow">{t.privacy.eyebrow}</span>
            <h2 id="landing-privacy-title">
              {t.privacy.titleBefore}<br />
              <span>{t.privacy.titleHighlight}</span>
            </h2>
            <p className="landing-privacy-lead">{t.privacy.lead}</p>
            <div className="landing-privacy-grid">
              <div className="landing-privacy-card">
                <span className="landing-privacy-card__badge">01</span>
                <strong>{t.privacy.card1Title}</strong>
                <p>{t.privacy.card1Text}</p>
              </div>
              <div className="landing-privacy-card">
                <span className="landing-privacy-card__badge">02</span>
                <strong>{t.privacy.card2Title}</strong>
                <p>{t.privacy.card2Text}</p>
              </div>
              <div className="landing-privacy-card">
                <span className="landing-privacy-card__badge">03</span>
                <strong>{t.privacy.card3Title}</strong>
                <p>{t.privacy.card3Text}</p>
              </div>
            </div>
            <p className="landing-privacy-note">{t.privacy.note}</p>
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <a className="landing-footer-brand" href="#top" aria-label={t.footer.brandAria}>
            <img src="/bee.svg" alt="" />
            <span>vibee</span>
          </a>
          <span className="landing-footer-note">{t.footer.note}</span>
          <nav className="landing-footer-links" aria-label="Ссылки">
            <a href="https://github.com/augustteske/vibebot" target="_blank" rel="noreferrer">GitHub <span aria-hidden="true">↗</span></a>
            <a href="/docs.html">{t.footer.documentation}</a>
            <a href="https://opensource.org/license/mit" target="_blank" rel="noreferrer">{t.footer.license}</a>
          </nav>
        </div>
      </footer>
    </main>
  )
}

export function LandingPage(props: LandingPageProps) {
  return (
    <LanguageProvider>
      <LandingPageContent {...props} />
    </LanguageProvider>
  )
}
