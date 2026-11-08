import { useEffect, useRef } from 'react'

interface HoneycombBackgroundProps {
  className?: string
  opacity?: number
  interactive?: boolean
}

/**
 * Минималистичный 3D-паттерн сот в стиле Apple.
 * Чистая геометрия, шелковистый световой блик, тактильный микро-параллакс без визуального шума.
 */
export function HoneycombBackground({
  className = '',
  opacity = 0.9,
  interactive = true,
}: HoneycombBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationFrameId: number
    let isVisible = true
    let width = 0
    let height = 0
    let dpr = Math.min(window.devicePixelRatio || 1, 2)

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // Плавное слежение за курсором (Apple-like spotlight)
    let mouseX = -9999
    let mouseY = -9999
    let targetMouseX = -9999
    let targetMouseY = -9999

    function updateSize() {
      if (!canvas) return
      const parent = canvas.parentElement
      const rect = parent ? parent.getBoundingClientRect() : { width: window.innerWidth, height: 450 }
      width = Math.max(rect.width, 320)
      height = Math.max(rect.height, 280)
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    updateSize()

    const resizeObserver = new ResizeObserver(() => {
      updateSize()
    })

    if (canvas.parentElement) {
      resizeObserver.observe(canvas.parentElement)
    }

    const intersectionObserver = new IntersectionObserver(
      entries => {
        isVisible = entries[0]?.isIntersecting ?? true
      },
      { threshold: 0.05 }
    )
    intersectionObserver.observe(canvas)

    function handlePointerMove(e: PointerEvent) {
      if (!interactive || !canvas) return
      const rect = canvas.getBoundingClientRect()
      targetMouseX = e.clientX - rect.left
      targetMouseY = e.clientY - rect.top
    }

    function handlePointerLeave() {
      targetMouseX = -9999
      targetMouseY = -9999
    }

    const parentEl = canvas.parentElement || window
    parentEl.addEventListener('pointermove', handlePointerMove as EventListener, { passive: true })
    parentEl.addEventListener('pointerleave', handlePointerLeave as EventListener, { passive: true })

    // Минималистичные пропорции сот (крупные, спокойные плитки)
    const radius = 34
    const hexWidth = Math.sqrt(3) * radius
    const xStep = hexWidth
    const yStep = radius * 1.5

    // Мягкая световая волна
    let waveRadius = -80
    let waveCenterX = width * 0.3
    let waveCenterY = height * 0.4
    const waveSpeed = 190 // px/sec — неторопливая, плавная
    let waveActive = true
    let lastWaveTime = performance.now()
    let lastFrameTime = performance.now()

    function launchWave(now: number) {
      waveCenterX = width * (0.2 + Math.random() * 0.6)
      waveCenterY = height * (0.25 + Math.random() * 0.5)
      waveRadius = 0
      waveActive = true
      lastWaveTime = now
    }

    // Расчёт вершин регулярного шестиугольника (pointy-topped)
    function getHexVertices(cx: number, cy: number, r: number): [number, number][] {
      const pts: [number, number][] = []
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6
        pts.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)])
      }
      return pts
    }

    function render(now: number) {
      if (!ctx || !canvas) return

      const dt = Math.min((now - lastFrameTime) / 1000, 0.1)
      lastFrameTime = now

      if (!isVisible) {
        animationFrameId = requestAnimationFrame(render)
        return
      }

      // Плавная интерполяция курсора
      if (targetMouseX > -5000) {
        mouseX += (targetMouseX - mouseX) * Math.min(1, dt * 6)
        mouseY += (targetMouseY - mouseY) * Math.min(1, dt * 6)
      } else {
        mouseX = -9999
        mouseY = -9999
      }

      // Движение мягкой световой волны
      if (!prefersReducedMotion) {
        if (waveActive) {
          waveRadius += waveSpeed * dt
          const maxDist = Math.hypot(width, height) + 140
          if (waveRadius > maxDist) {
            waveActive = false
            lastWaveTime = now
          }
        } else if (now - lastWaveTime > 3800) {
          launchWave(now)
        }
      }

      ctx.clearRect(0, 0, width, height)

      const cols = Math.ceil(width / xStep) + 2
      const rows = Math.ceil(height / yStep) + 2
      const timeSec = now * 0.0012

      // Направленный свет сверху-слева (мягкий угол 45°)
      const lx = -0.5
      const ly = -0.866

      const waveBandWidth = 220

      for (let row = -1; row < rows; row++) {
        const cy = row * yStep
        const xOffset = row % 2 === 0 ? 0 : xStep * 0.5

        for (let col = -1; col < cols; col++) {
          const cx = col * xStep + xOffset

          // 1. Спокойное фоновое дыхание
          const ambient = prefersReducedMotion
            ? 0.15
            : (Math.sin(cx * 0.009 - cy * 0.008 + timeSec * 1.2) * 0.5 + 0.5) * 0.25

          // 2. Световая волна (silky light wave)
          let waveFactor = 0
          if (waveActive && !prefersReducedMotion) {
            const distFromWave = Math.hypot(cx - waveCenterX, cy - waveCenterY)
            const diff = Math.abs(distFromWave - waveRadius)
            if (diff < waveBandWidth) {
              waveFactor = Math.cos((diff / waveBandWidth) * (Math.PI / 2))
            }
          }

          // 3. Apple Spotlight под курсором
          let mouseFactor = 0
          if (mouseX > -5000) {
            const distToMouse = Math.hypot(cx - mouseX, cy - mouseY)
            const spotlightRadius = 170
            if (distToMouse < spotlightRadius) {
              mouseFactor = Math.cos((distToMouse / spotlightRadius) * (Math.PI / 2))
            }
          }

          // Итоговая освещённость ячейки [0..1]
          const lightScore = Math.min(1, ambient + waveFactor * 0.65 + mouseFactor * 0.8)

          // Тонкий микро-параллакс (сдвиг всего 0.5 - 2px, как полированное стекло)
          const lift = lightScore * 2.0
          const tileCx = cx + lx * lift * 0.5
          const tileCy = cy + ly * lift * 0.5

          // Чистый зазор между плитками (1.8px)
          const tileRadius = radius * 0.94
          const pts = getHexVertices(tileCx, tileCy, tileRadius)

          // --- А. Тело плитки (матовое сатиновое стекло в стиле Apple) ---
          ctx.beginPath()
          ctx.moveTo(pts[0][0], pts[0][1])
          for (let i = 1; i < 6; i++) {
            ctx.lineTo(pts[i][0], pts[i][1])
          }
          ctx.closePath()

          // Градиент света по поверхности плитки
          const grad = ctx.createLinearGradient(
            tileCx - tileRadius * 0.6,
            tileCy - tileRadius * 0.6,
            tileCx + tileRadius * 0.6,
            tileCy + tileRadius * 0.6
          )
          // Освещённая сторона
          grad.addColorStop(0, `rgba(255, 255, 255, ${0.12 + lightScore * 0.38})`)
          // Теневая сторона (чистый тёплый оттенок, без грязи)
          grad.addColorStop(1, `rgba(255, 255, 255, ${0.03 + lightScore * 0.12})`)
          ctx.fillStyle = grad
          ctx.fill()

          // --- Б. Минималистичные рёбра (Apple Specular Hairline) ---
          // Освещённые грани ловят тонкий белый блик, противоположные — едва заметную границу
          for (let i = 0; i < 6; i++) {
            const next = (i + 1) % 6
            const p1 = pts[i]
            const p2 = pts[next]

            // Вектор нормали ребра
            const edgeDx = p2[0] - p1[0]
            const edgeDy = p2[1] - p1[1]
            const nx = -edgeDy
            const ny = edgeDx
            const len = Math.hypot(nx, ny) || 1
            const dot = (nx / len) * lx + (ny / len) * ly

            ctx.beginPath()
            ctx.moveTo(p1[0], p1[1])
            ctx.lineTo(p2[0], p2[1])

            if (dot > 0.1) {
              // Верхне-левые рёбра: чистый белый блик
              const specularAlpha = 0.25 + dot * 0.35 + lightScore * 0.35
              ctx.strokeStyle = `rgba(255, 255, 255, ${Math.min(0.85, specularAlpha)})`
              ctx.lineWidth = 1.0
            } else {
              // Нижне-правые рёбра: деликатная полупрозрачная граница
              const edgeAlpha = 0.04 + Math.abs(dot) * 0.06
              ctx.strokeStyle = `rgba(23, 23, 25, ${edgeAlpha})`
              ctx.lineWidth = 0.75
            }
            ctx.stroke()
          }
        }
      }

      animationFrameId = requestAnimationFrame(render)
    }

    animationFrameId = requestAnimationFrame(render)

    return () => {
      cancelAnimationFrame(animationFrameId)
      resizeObserver.disconnect()
      intersectionObserver.disconnect()
      parentEl.removeEventListener('pointermove', handlePointerMove as EventListener)
      parentEl.removeEventListener('pointerleave', handlePointerLeave as EventListener)
    }
  }, [interactive])

  return (
    <canvas
      ref={canvasRef}
      className={`honeycomb-canvas ${className}`}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        opacity,
        zIndex: 1,
      }}
      aria-hidden="true"
    />
  )
}
