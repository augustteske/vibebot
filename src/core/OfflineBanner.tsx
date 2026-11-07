import { useEffect, useState } from 'react'
import './OfflineBanner.css'

/** Плашка «нет сети»: появляется при потере соединения и сама исчезает, когда оно вернулось. */
export function OfflineBanner() {
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false)

  useEffect(() => {
    function handleOffline() {
      setOffline(true)
    }
    function handleOnline() {
      setOffline(false)
    }

    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)
    return () => {
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
    }
  }, [])

  if (!offline) return null

  return (
    <div className="offline-banner" role="status" aria-live="polite">
      <span className="offline-banner__bee" aria-hidden="true">🐝</span>
      <span className="offline-banner__text">Нет подключения к интернету. Проверьте сеть.</span>
    </div>
  )
}
