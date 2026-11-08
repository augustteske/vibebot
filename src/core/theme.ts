/** Светлая и тёмная темы: выбор хранится в localStorage, по умолчанию — системный. */
export type Theme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'vibee-theme'

const DARK_QUERY = '(prefers-color-scheme: dark)'

/** Тема, сохранённая пользователем, или системная, если выбора ещё не было. */
export function readTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // Приватный режим может запрещать localStorage — тогда просто берём системную тему.
  }
  return window.matchMedia?.(DARK_QUERY).matches ? 'dark' : 'light'
}

let transitionTimer: number | undefined

/** Ставит тему на <html> и запоминает выбор, чтобы он пережил перезагрузку. */
export function applyTheme(theme: Theme, animate = false): void {
  const root = document.documentElement
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

  const commit = () => {
    root.dataset.theme = theme
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      // Без localStorage тема работает, но не сохраняется.
    }
  }

  if (!animate || reducedMotion || root.dataset.theme === theme) {
    commit()
    return
  }

  root.classList.add('theme-transitioning')
  window.clearTimeout(transitionTimer)
  transitionTimer = window.setTimeout(() => {
    root.classList.remove('theme-transitioning')
  }, 380)

  const docWithTransition = document as Document & {
    startViewTransition?: (callback: () => void) => void
  }
  if (typeof docWithTransition.startViewTransition === 'function') {
    docWithTransition.startViewTransition(commit)
  } else {
    commit()
  }
}

/** Следующая тема при переключении: тёмная меняется на светлую и наоборот. */
export function nextTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark'
}
