import { ApiError } from './client'
import './RequestError.css'

type ErrorKind = 'retry' | 'session' | 'permission' | 'message'

function describe(error: unknown, action?: string, mutation = false): { kind: ErrorKind; text: string } {
  if (error instanceof ApiError) {
    if (error.status === 0 || error.status >= 500 || error.code === 'INVALID_RESPONSE') {
      return { kind: 'retry', text: mutation
        ? 'Сервер временно не отвечает. Введённые данные сохранены; после восстановления повторите действие вручную.'
        : 'Сервер временно не отвечает. Проверьте соединение и повторите запрос.' }
    }
    if (error.status === 401) return { kind: 'session', text: 'Сессия завершилась или вход не выполнен. Войдите, чтобы продолжить.' }
    if (error.status === 403) {
      if (error.code === 'FORBIDDEN') return { kind: 'permission', text: action ?? 'У вас недостаточно прав для этого действия.' }
      return { kind: 'message', text: 'Запрос отклонён. Вернитесь в команду и попробуйте ещё раз.' }
    }
    if (error.status === 404) return { kind: 'message', text: 'Запрошенные данные больше недоступны.' }
    if (error.status === 400 || error.status === 422) return { kind: 'message', text: 'Проверьте введённые данные и попробуйте ещё раз.' }
    if (error.status === 409) return { kind: 'message', text: 'Данные изменились. Обновите раздел и проверьте результат.' }
    if (error.status === 429) return { kind: 'message', text: 'Слишком много запросов. Подождите немного и повторите.' }
  }
  if (typeof error === 'string' && error) return { kind: 'message', text: error }
  return { kind: 'message', text: 'Не удалось выполнить запрос. Попробуйте ещё раз.' }
}

export function RequestError({ error, action, onRetry, retrying = false, onLogin, returnHref = '/?mode=team#team-overview', mutation = false }: {
  error: unknown
  action?: string
  onRetry?: () => void
  retrying?: boolean
  onLogin?: () => void
  returnHref?: string
  mutation?: boolean
}) {
  if (!error) return null
  const detail = describe(error, action, mutation)
  return <div className="request-error" role="alert" aria-live="assertive">
    <p>{detail.text}</p>
    {detail.kind === 'retry' && onRetry && !mutation && <button type="button" className="button secondary" onClick={onRetry} disabled={retrying} aria-busy={retrying}>
      {retrying ? 'Повторяем…' : 'Повторить'}
    </button>}
    {detail.kind === 'session' && onLogin && <button type="button" className="button secondary" onClick={onLogin}>Войти</button>}
    {detail.kind === 'permission' && <a className="button secondary" href={returnHref}>Вернуться в команду</a>}
  </div>
}
