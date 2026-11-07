import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import './ErrorBoundary.css'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

/** Ловит критическую ошибку React и показывает брендированный экран вместо белой страницы. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Vibee: не удалось отрисовать интерфейс', error, info.componentStack)
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <main className="error-screen">
        <section className="error-screen__card" role="alert" aria-labelledby="error-screen-title">
          <img
            className="error-screen__mascot"
            src="/bee-mascot.png"
            alt=""
            width="168"
            height="168"
          />
          <p className="error-screen__eyebrow">Vibee</p>
          <h1 id="error-screen-title">Упс, что-то пошло не так.</h1>
          <p className="error-screen__text">Мы уже чиним! Обычно помогает простое обновление страницы.</p>
          <button
            type="button"
            className="error-screen__button"
            onClick={() => window.location.reload()}
          >
            Обновить страницу
          </button>
          <p className="error-screen__note">Если ошибка повторится — зайдите чуть позже.</p>
        </section>
      </main>
    )
  }
}
