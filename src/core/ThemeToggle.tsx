import { useEffect, useState } from 'react'
import { applyTheme, nextTheme, readTheme } from './theme'
import { THEME_STORAGE_KEY } from './theme'
import type { Theme } from './theme'
import './theme-toggle.css'

/** Кнопка солнце/луна: переключает светлую и тёмную тему. */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>(readTheme)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  // Другая вкладка переключила тему — подхватываем выбор без перезагрузки.
  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key !== THEME_STORAGE_KEY) return
      if (event.newValue === 'light' || event.newValue === 'dark') setTheme(event.newValue)
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  const target = nextTheme(theme)
  const label = target === 'dark' ? 'Включить тёмную тему' : 'Включить светлую тему'

  return (
    <button
      type="button"
      className={'theme-toggle' + (className ? ' ' + className : '')}
      onClick={() => {
        applyTheme(target, true)
        setTheme(target)
      }}
      aria-label={label}
      title={label}
      aria-pressed={theme === 'dark'}
    >
      <span className="theme-toggle__icon" aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
    </button>
  )
}
