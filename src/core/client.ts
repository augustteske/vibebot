import type { SessionSnapshot } from './contracts'

export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code }
}
export async function api<T = SessionSnapshot>(path: string, input?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch('/api' + path, { method: input === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: input === undefined ? {} : { 'Content-Type': 'application/json', 'X-VibeBot': '1' }, ...(input === undefined ? {} : { body: JSON.stringify(input) }), signal: AbortSignal.timeout(10000) })
  } catch { throw new ApiError(0, 'NETWORK_ERROR', 'Нет связи. Проверьте подключение и попробуйте ещё раз.') }
  let data
  try { data = await response.json() } catch { throw new ApiError(response.status, 'INVALID_RESPONSE', 'Сервис временно недоступен. Попробуйте ещё раз.') }
  if (!response.ok) throw new ApiError(response.status, data.error?.code ?? 'REQUEST_FAILED', data.error?.message ?? 'Не удалось выполнить действие')
  return data as T
}
