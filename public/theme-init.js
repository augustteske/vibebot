// Тема ставится до первой отрисовки, чтобы не было вспышки светлого экрана.
try {
  var theme = localStorage.getItem('vibee-theme')
  if (theme !== 'light' && theme !== 'dark') {
    theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  document.documentElement.dataset.theme = theme
} catch {
  document.documentElement.dataset.theme = 'light'
}
