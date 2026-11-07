import './NotFoundPage.css'

export function NotFoundPage() {
  return <main className="workspace not-found" aria-labelledby="not-found-title">
    <header><a className="brand" href="/"><img src="/bee.svg" alt=""/>Vibee</a><span className="badge">Страница не найдена</span></header>
    <section className="panel not-found__card">
      <span className="not-found__code" aria-hidden="true">404</span>
      <h1 id="not-found-title">Такой страницы нет</h1>
      <p className="muted">Проверьте адрес или вернитесь на главную.</p>
      <a className="button" href="/">На главную</a>
    </section>
    <footer>Vibee · Shertwg group</footer>
  </main>
}
