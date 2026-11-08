import { useEffect, useRef } from 'react'

interface HoneycombBackgroundProps {
  className?: string
  opacity?: number
  color?: string
  accentColor?: string
}

export function HoneycombBackground({
  className = '',
  opacity = 0.16,
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
    let height = (canvas.height = canvas.parentElement?.clientHeight || 450)

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

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

    const intersectionObserver = new IntersectionObserver(
      entries => {
        isVisible = entries[0]?.isIntersecting ?? true
      },
      { threshold: 0.05 }
    )
    intersectionObserver.observe(canvas)

    // Honeycomb 3D scale parameters
    const radius = 26
    const hexWidth = Math.sqrt(3) * radius
    const xStep = hexWidth
    const yStep = radius * 1.5

    // Ripple wave state
    let waveCenterX = width * 0.25
    let waveCenterY = height * 0.4
    let waveRadius = -80
    const waveSpeed = 240 // px/sec
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

    // Helper: calculate 6 vertices of a regular pointy-top hexagon
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
        } else if (now - lastWaveTime > 3000) {
          startNewWave()
        }
      }

      const waveWidth = 160
      const cols = Math.ceil(width / xStep) + 2
      const rows = Math.ceil(height / yStep) + 2
      const t = now * 0.0015

      // Light direction vector for 3D bevel shading
      const lx = -0.6
      const ly = -0.8

      for (let row = -1; row < rows; row++) {
        const cy = row * yStep
        const xOffset = row % 2 === 0 ? 0 : xStep * 0.5

        for (let col = -1; col < cols; col++) {
          const cx = col * xStep + xOffset

          // Ambient 3D undulating breathing
          const ambientWave = prefersReducedMotion
            ? 0
            : Math.sin(cx * 0.012 + cy * 0.012 + t) * 0.5 + 0.5

          // Ripple wave influence
          let waveInfluence = 0
          if (waveActive && !prefersReducedMotion) {
            const dist = Math.hypot(cx - waveCenterX, cy - waveCenterY)
            const diff = Math.abs(dist - waveRadius)
            if (diff < waveWidth) {
              waveInfluence = Math.cos((diff / waveWidth) * (Math.PI / 2))
            }
          }

          // 3D elevation height in pixels
          const totalInfluence = waveInfluence * 0.75 + ambientWave * 0.25
          const zDepth = 2 + totalInfluence * 7
          const scaleRadius = radius * (0.86 + totalInfluence * 0.08)

          // Base hexagon (bottom)
          const basePts = getHexVertices(cx, cy, scaleRadius)

          // Elevated top face (shifted slightly up and toward light in 3D)
          const topCx = cx + lx * zDepth * 0.5
          const topCy = cy + ly * zDepth * 0.8
          const topPts = getHexVertices(topCx, topCy, scaleRadius * 0.88)

          // Draw 3D side bevel facets
          for (let i = 0; i < 6; i++) {
            const next = (i + 1) % 6
            const b1 = basePts[i]
            const b2 = basePts[next]
            const t1 = topPts[i]
            const t2 = topPts[next]

            // Calculate facet normal orientation relative to light
            const edgeDx = b2[0] - b1[0]
            const edgeDy = b2[1] - b1[1]
            const normalX = -edgeDy
            const normalY = edgeDx
            const len = Math.hypot(normalX, normalY) || 1
            const dot = (normalX / len) * lx + (normalY / len) * ly

            ctx.beginPath()
            ctx.moveTo(b1[0], b1[1])
            ctx.lineTo(b2[0], b2[1])
            ctx.lineTo(t2[0], t2[1])
            ctx.lineTo(t1[0], t1[1])
            ctx.closePath()

            if (waveInfluence > 0.08) {
              // Radiant golden highlight on wave
              const goldAlpha = Math.max(0.04, (dot * 0.5 + 0.5) * (0.35 + waveInfluence * 0.5))
              ctx.fillStyle = accentColor
              ctx.globalAlpha = goldAlpha
              ctx.fill()
            } else {
              // Subtle dimensional shading
              const shadeAlpha = Math.max(0.03, (dot * 0.5 + 0.5) * 0.16)
              ctx.fillStyle = dot > 0 ? '#ffffff' : color
              ctx.globalAlpha = shadeAlpha
              ctx.fill()
            }
          }

          // Draw top face of 3D scale
          ctx.beginPath()
          ctx.moveTo(topPts[0][0], topPts[0][1])
          for (let i = 1; i < 6; i++) {
            ctx.lineTo(topPts[i][0], topPts[i][1])
          }
          ctx.closePath()

          if (waveInfluence > 0.1) {
            ctx.fillStyle = accentColor
            ctx.globalAlpha = 0.08 + waveInfluence * 0.22
            ctx.fill()
            ctx.strokeStyle = accentColor
            ctx.lineWidth = 1.2
            ctx.globalAlpha = 0.25 + waveInfluence * 0.55
            ctx.stroke()
          } else {
            ctx.fillStyle = color
            ctx.globalAlpha = 0.05 + ambientWave * 0.03
            ctx.fill()
            ctx.strokeStyle = color
            ctx.lineWidth = 0.9
            ctx.globalAlpha = 0.14 + ambientWave * 0.06
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
