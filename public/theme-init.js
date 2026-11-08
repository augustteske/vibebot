// Тема ставится до первой отрисовки, чтобы не было вспышки светлого экрана.
try {
  var theme = localStorage.getItem('vibee-theme')
  if (theme !== 'light' && theme !== 'dark') {
    theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  document.documentElement.dataset.theme = theme
  var now = new Date()
  var m = now.getMonth()
  var d = now.getDate()
  if (m === 11 || (m === 0 && d >= 1 && d <= 15)) {
    document.documentElement.dataset.season = 'new-year'
  }
} catch {
  document.documentElement.dataset.theme = 'light'
}
