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

/** Ставит тему на <html> и запоминает выбор, чтобы он пережил перезагрузку. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Без localStorage тема работает, но не сохраняется.
  }
}

/** Следующая тема при переключении: тёмная меняется на светлую и наоборот. */
export function nextTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark'
}
