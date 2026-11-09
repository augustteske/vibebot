import type { CSSProperties, ReactNode } from 'react'
import './DemoStamp.css'

export interface DemoStampProps {
  className?: string
  style?: CSSProperties
  label?: ReactNode
  rotation?: number
  variant?: 'circle' | 'badge'
}

/**
 * Фирменная табличка / штамп «Вымышленные демо-данные».
 * Стиль круглого штампа с пунктирным контуром и легким наклоном.
 */
export function DemoStamp({
  className = '',
  style,
  label = (
    <>
      ВЫМЫШЛЕННЫЕ
      <br />
      ДЕМО-ДАННЫЕ
    </>
  ),
  rotation = 8,
  variant = 'circle',
}: DemoStampProps) {
  return (
    <span
      className={`vibee-stamp vibee-stamp--${variant} ${className}`}
      style={{ transform: `rotate(${rotation}deg)`, ...style }}
      aria-label="Демонстрационные данные"
    >
      {label}
    </span>
  )
}
