import { useEffect, useRef, useState } from 'react'
import { canvasToBlob, renderShareCard, shareCardText } from './shareCard'
import type { ShareCardData } from './shareCard'
import './ShareCard.css'

function ShareIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v12"/>
    <path d="m7 8 5-5 5 5"/>
    <path d="M5 13v5a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-5"/>
  </svg>
}

const fileName = (data: ShareCardData) =>
  'vibee-pulse-' + data.periodLabel.replace(/[^0-9a-zа-яё]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() + '.png'

/** Кнопка «Поделиться» и модальное окно с PNG-карточкой «Пульс команды». */
export function ShareCardButton({ data }: { data: ShareCardData }) {
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState('')
  const [rendering, setRendering] = useState(false)
  const [status, setStatus] = useState('')
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const text = shareCardText(data)
  const canShareFiles = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function'

  function close() {
    setOpen(false)
    triggerRef.current?.focus()
  }

  async function openCard() {
    setOpen(true)
    setStatus('')
    setPreview('')
    setRendering(true)
    try {
      const canvas = await renderShareCard(data)
      canvasRef.current = canvas
      setPreview(canvas.toDataURL('image/png'))
    } catch {
      canvasRef.current = null
      setStatus('Не удалось нарисовать картинку. Скопируйте текстовую версию ниже.')
    } finally {
      setRendering(false)
    }
  }

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKeyDown(event: KeyboardEvent) { if (event.key === 'Escape') close() }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  async function copyImage() {
    const canvas = canvasRef.current
    if (!canvas) return
    try {
      if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) throw new Error('unsupported')
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': canvasToBlob(canvas) })])
      setStatus('Картинка скопирована — вставьте её в чат или презентацию.')
    } catch {
      setStatus('Браузер не разрешил копировать картинку. Скачайте PNG или скопируйте текст.')
    }
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text)
      setStatus('Текст карточки скопирован.')
    } catch {
      setStatus('Выделите текст ниже и скопируйте его вручную.')
    }
  }

  async function shareNative() {
    const canvas = canvasRef.current
    if (!canvas) return
    try {
      const file = new File([await canvasToBlob(canvas)], fileName(data), { type: 'image/png' })
      if (!navigator.canShare?.({ files: [file] })) throw new Error('unsupported')
      await navigator.share({ files: [file], title: 'Пульс команды · Vibee', text })
    } catch (failure) {
      if (failure instanceof DOMException && failure.name === 'AbortError') return
      setStatus('Системное меню «Поделиться» недоступно. Скачайте PNG или скопируйте картинку.')
    }
  }

  return <>
    <button type="button" className="share-card-trigger" ref={triggerRef} onClick={() => void openCard()}>
      <ShareIcon/>Поделиться
    </button>
    {open && <div className="share-card-overlay" onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
      <div className="share-card-dialog" role="dialog" aria-modal="true" aria-labelledby="share-card-title">
        <div className="share-card-dialog__head">
          <div>
            <h2 id="share-card-title">Поделиться пульсом команды</h2>
            <p className="muted">Карточка для ретроспективы: период, три общих показателя и слоган Vibee.</p>
          </div>
          <button type="button" className="share-card-dialog__close" aria-label="Закрыть" ref={closeRef} onClick={close}>×</button>
        </div>
        <div className="share-card-preview" aria-busy={rendering}>
          {preview
            ? <img src={preview} width={1200} height={630} alt={`Карточка «Пульс команды» за ${data.periodLabel}`}/>
            : <p role="status">{rendering ? 'Рисуем карточку…' : 'Предпросмотр недоступен.'}</p>}
        </div>
        <div className="share-card-actions">
          <a className={`button${preview ? '' : ' is-disabled'}`} href={preview || undefined} download={fileName(data)} aria-disabled={!preview} onClick={event => { if (!preview) event.preventDefault() }}>Скачать PNG</a>
          <button type="button" className="button secondary" disabled={!preview} onClick={() => void copyImage()}>Скопировать картинку</button>
          <button type="button" className="button secondary" onClick={() => void copyText()}>Скопировать текст</button>
          {canShareFiles && <button type="button" className="button secondary" disabled={!preview} onClick={() => void shareNative()}>Отправить…</button>}
        </div>
        {status && <p className="share-card-status" role="status">{status}</p>}
        <details className="share-card-text">
          <summary>Текстовая версия</summary>
          <textarea readOnly rows={6} value={text} onFocus={event => event.currentTarget.select()}/>
        </details>
        <p className="share-card-note">Карточка содержит только опубликованные общие показатели, без имён и сообщений. Перед публикацией за пределами команды согласуйте это с участниками.</p>
      </div>
    </div>}
  </>
}
