interface CuteBeeMagnifierProps {
  className?: string
  size?: number
}

/**
 * Милая пчелка Vibee с лупой для состояния калибровки и сбора данных.
 */
export function CuteBeeMagnifier({ className = '', size = 84 }: CuteBeeMagnifierProps) {
  return (
    <div
      className={`cute-bee-magnifier ${className}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label="Пчёлка Vibee исследует данные с лупой"
    >
      <svg
        viewBox="0 0 96 96"
        width={size}
        height={size}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          <radialGradient id="beeGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffd638" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#ffd638" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="lensShine" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#ffd638" stopOpacity="0.2" />
          </linearGradient>
        </defs>

        {/* Мягкий золотистый ореол */}
        <circle cx="48" cy="48" r="42" fill="url(#beeGlow)" />

        {/* Персонаж Пчёлка */}
        <g stroke="#171719" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
          {/* Крылышки */}
          <path d="M35 29C13 5 12 36 29 38" fill="#ffffff" />
          <path d="M47 28C55 2 74 23 57 37" fill="#ffffff" />

          {/* Жало */}
          <path d="M23 45 13 50l10 4" fill="#171719" />

          {/* Тельце */}
          <ellipse cx="42" cy="49" rx="24" ry="18" fill="#ffd638" />

          {/* Фирменные полоски */}
          <path d="M31 34c-4 8-4 22 0 30M42 31c-4 10-4 25 0 36" fill="none" strokeWidth="6.5" />

          {/* Голова */}
          <circle cx="63" cy="45" r="13" fill="#ffd638" />

          {/* Усики */}
          <path d="m57 32-3-7m11 7 4-6" fill="none" />

          {/* Глазки с искорками и дружелюбная улыбка */}
          <circle cx="60" cy="43" r="2.2" fill="#171719" stroke="none" />
          <circle cx="69" cy="43" r="2.2" fill="#171719" stroke="none" />
          <path d="M61 50q3.5 3.5 7-1" fill="none" strokeWidth="2" />
        </g>

        {/* Лупа в лапках у пчёлки */}
        <g transform="translate(45, 38)">
          {/* Стекло лупы */}
          <circle cx="21" cy="21" r="12" fill="url(#lensShine)" />
          {/* Оправа */}
          <circle cx="21" cy="21" r="12" stroke="#171719" strokeWidth="3" fill="none" />
          {/* Блик на линзе */}
          <path d="M14 17a8 8 0 0 1 10-4" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" />
          {/* Ручка лупы */}
          <path d="m30 30 9 9" stroke="#171719" strokeWidth="4.2" strokeLinecap="round" />
        </g>
      </svg>
    </div>
  )
}
