import { useState } from 'react'
import { useLanguage } from './i18n'
import './language-toggle.css'

export function LanguageToggle({ className = '' }: { className?: string }) {
  const { lang, setLanguage, isTransitioning } = useLanguage()
  const [animating, setAnimating] = useState(false)

  const targetLang = lang === 'ru' ? 'en' : 'ru'
  const label = lang === 'ru' ? 'Switch to English' : 'Переключить на русский'

  const handleToggle = () => {
    setAnimating(true)
    setLanguage(targetLang)
    window.setTimeout(() => setAnimating(false), 360)
  }

  return (
    <button
      type="button"
      className={
        'language-toggle' +
        (animating || isTransitioning ? ' is-animating' : '') +
        (className ? ' ' + className : '')
      }
      onClick={handleToggle}
      aria-label={label}
      title={label}
    >
      <span className="language-toggle__badge" key={lang}>
        {lang.toUpperCase()}
      </span>
    </button>
  )
}
