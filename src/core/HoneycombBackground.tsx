import { useEffect, useRef } from 'react'

interface HoneycombBackgroundProps {
  className?: string
  opacity?: number
  color?: string
  accentColor?: string
}

export function HoneycombBackground({
  className = '',
  opacity = 0.1,
  color = '#171719',
  accentColor = '#ffd638',
}: HoneycombBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationFrameId: number
    let isVisible = true
    let width = (canvas.width = canvas.parentElement?.clientWidth || window.innerWidth)
    let height = (canvas.height = canvas.parentElement?.clientHeight || 400)

    // Check reduced motion
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // Resize observer to fit parent container
    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width: newW, height: newH } = entry.contentRect
        if (newW > 0 && newH > 0 && (newW !== width || newH !== height)) {
          width = canvas.width = newW
          height = canvas.height = newH
        }
      }
    })

    if (canvas.parentElement) {
      resizeObserver.observe(canvas.parentElement)
    }

    // Intersection observer to pause rendering when offscreen
    const intersectionObserver = new IntersectionObserver(
      entries => {
        isVisible = entries[0]?.isIntersecting ?? true
      },
      { threshold: 0.05 }
    )
    intersectionObserver.observe(canvas)

    // Honeycomb grid parameters
    const radius = 24
    const hexWidth = Math.sqrt(3) * radius
    const hexHeight = 2 * radius
    const xStep = hexWidth
    const yStep = hexHeight * 0.75

    // Wave state
    let waveCenterX = width * 0.5
    let waveCenterY = height * 0.5
    let waveRadius = -100
    let waveSpeed = 220 // pixels per second
    let waveActive = true
    let lastWaveTime = performance.now()
    let lastFrameTime = performance.now()

    function startNewWave() {
      waveCenterX = Math.random() * width
      waveCenterY = Math.random() * height
      waveRadius = 0
      waveActive = true
      lastWaveTime = performance.now()
    }

    function drawHexagon(x: number, y: number, r: number) {
      if (!ctx) return
      ctx.beginPath()
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6
        const px = x + r * Math.cos(angle)
        const py = y + r * Math.sin(angle)
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.closePath()
    }

    function render(now: number) {
      if (!ctx || !canvas) return

      const dt = Math.min((now - lastFrameTime) / 1000, 0.1)
      lastFrameTime = now

      if (!isVisible) {
        animationFrameId = requestAnimationFrame(render)
        return
      }

      ctx.clearRect(0, 0, width, height)

      // Update wave
      if (!prefersReducedMotion) {
        if (waveActive) {
          waveRadius += waveSpeed * dt
          const maxDist = Math.hypot(width, height) + 120
          if (waveRadius > maxDist) {
            waveActive = false
            lastWaveTime = now
          }
        } else if (now - lastWaveTime > 3200) {
          startNewWave()
        }
      }

      const waveWidth = 140
      const cols = Math.ceil(width / xStep) + 2
      const rows = Math.ceil(height / yStep) + 2

      ctx.lineWidth = 1

      for (let row = -1; row < rows; row++) {
        const y = row * yStep
        const xOffset = (row % 2 === 0 ? 0 : xStep * 0.5)

        for (let col = -1; col < cols; col++) {
          const x = col * xStep + xOffset
          const distToWave = Math.hypot(x - waveCenterX, y - waveCenterY)

          let waveInfluence = 0
          if (waveActive && !prefersReducedMotion) {
            const diff = Math.abs(distToWave - waveRadius)
            if (diff < waveWidth) {
              waveInfluence = Math.cos((diff / waveWidth) * (Math.PI / 2))
            }
          }

          if (waveInfluence > 0.05) {
            ctx.strokeStyle = accentColor
            ctx.globalAlpha = 0.2 + waveInfluence * 0.5
            drawHexagon(x, y, radius * (1 + waveInfluence * 0.08))
            ctx.stroke()
          } else {
            ctx.strokeStyle = color
            ctx.globalAlpha = 0.12
            drawHexagon(x, y, radius)
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
    }
  }, [accentColor, color])

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
        zIndex: 0,
      }}
      aria-hidden="true"
    />
  )
}
