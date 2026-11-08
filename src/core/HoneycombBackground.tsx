import { useEffect, useRef } from 'react'

interface HoneycombBackgroundProps {
  className?: string
  opacity?: number
  interactive?: boolean
}

export function HoneycombBackground({
  className = '',
  opacity = 0.88,
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

    // Pointer coordinates with smooth easing
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

    // Tactile cap dimensions (refined proportions)
    const radius = 28 // cap outer radius
    const hexWidth = Math.sqrt(3) * radius
    const xStep = hexWidth
    const yStep = radius * 1.5

    // Periodic gentle travelling sheen waves
    let waveRadius = -60
    let waveCenterX = width * 0.25
    let waveCenterY = height * 0.4
    const waveSpeed = 220 // px/sec
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

    // Helper: calculate 6 vertices of a regular pointy-top hexagon
    function getHexVertices(cx: number, cy: number, r: number): [number, number][] {
      const pts: [number, number][] = []
      for (let i = 0; i < 6; i++) {
        // Pointy-topped hexagon angles: 30°, 90°, 150°, 210°, 270°, 330°
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

      // Smooth pointer interpolation
      if (targetMouseX > -5000) {
        mouseX += (targetMouseX - mouseX) * Math.min(1, dt * 8)
        mouseY += (targetMouseY - mouseY) * Math.min(1, dt * 8)
      } else {
        mouseX = -9999
        mouseY = -9999
      }

      // Progress radial sheen wave
      if (!prefersReducedMotion) {
        if (waveActive) {
          waveRadius += waveSpeed * dt
          const maxDist = Math.hypot(width, height) + 120
          if (waveRadius > maxDist) {
            waveActive = false
            lastWaveTime = now
          }
        } else if (now - lastWaveTime > 3200) {
          launchWave(now)
        }
      }

      ctx.clearRect(0, 0, width, height)

      const cols = Math.ceil(width / xStep) + 2
      const rows = Math.ceil(height / yStep) + 2
      const timeSec = now * 0.0014

      // Directional light vector from top-left (elegant satin angle)
      const lx = -0.55
      const ly = -0.83

      const waveBandWidth = 180

      for (let row = -1; row < rows; row++) {
        const cy = row * yStep
        const xOffset = row % 2 === 0 ? 0 : xStep * 0.5

        for (let col = -1; col < cols; col++) {
          const cx = col * xStep + xOffset

          // 1. Gentle ambient breathing undulation
          const ambient = prefersReducedMotion
            ? 0.2
            : (Math.sin(cx * 0.013 - cy * 0.01 + timeSec * 1.5) * 0.5 + 0.5) * 0.35

          // 2. Traveling sheen wave
          let waveFactor = 0
          if (waveActive && !prefersReducedMotion) {
            const distFromWave = Math.hypot(cx - waveCenterX, cy - waveCenterY)
            const diff = Math.abs(distFromWave - waveRadius)
            if (diff < waveBandWidth) {
              waveFactor = Math.cos((diff / waveBandWidth) * (Math.PI / 2))
            }
          }

          // 3. Pointer proximity
          let mouseFactor = 0
          if (mouseX > -5000) {
            const distToMouse = Math.hypot(cx - mouseX, cy - mouseY)
            const mouseRadius = 140
            if (distToMouse < mouseRadius) {
              mouseFactor = Math.cos((distToMouse / mouseRadius) * (Math.PI / 2))
            }
          }

          // Combined tactile Z-lift (subtle, 0 to 1)
          const zNorm = Math.min(1, ambient + waveFactor * 0.65 + mouseFactor * 0.75)

          // Proportions of the "cap"
          // Outer seam base
          const capRadius = radius * 0.89 // Leaves an elegant 2.5px seam gap
          // Subtle micro-shift towards light when elevated (max 2.8px)
          const liftPx = 0.5 + zNorm * 2.8
          const capCx = cx + lx * liftPx * 0.7
          const capCy = cy + ly * liftPx * 0.7

          const capPts = getHexVertices(capCx, capCy, capRadius)

          // --- 1. Soft Micro-Drop Shadow underneath cap plate ---
          const shadowOffsetX = -lx * liftPx * 0.75
          const shadowOffsetY = -ly * liftPx * 0.75
          const shadowPts = getHexVertices(cx + shadowOffsetX, cy + shadowOffsetY, capRadius * 0.96)

          ctx.beginPath()
          ctx.moveTo(shadowPts[0][0], shadowPts[0][1])
          for (let i = 1; i < 6; i++) {
            ctx.lineTo(shadowPts[i][0], shadowPts[i][1])
          }
          ctx.closePath()
          ctx.fillStyle = `rgba(23, 23, 25, ${0.04 + zNorm * 0.08})`
          ctx.fill()

          // --- 2. Cap Surface Fill (Satin Tone-on-Tone) ---
          ctx.beginPath()
          ctx.moveTo(capPts[0][0], capPts[0][1])
          for (let i = 1; i < 6; i++) {
            ctx.lineTo(capPts[i][0], capPts[i][1])
          }
          ctx.closePath()

          // Satin gradient across cap face
          const grad = ctx.createLinearGradient(
            capCx - capRadius * 0.7,
            capCy - capRadius * 0.7,
            capCx + capRadius * 0.7,
            capCy + capRadius * 0.7
          )
          grad.addColorStop(0, `rgba(255, 255, 255, ${0.16 + zNorm * 0.28})`)
          grad.addColorStop(1, `rgba(225, 175, 20, ${0.06 + zNorm * 0.12})`)
          ctx.fillStyle = grad
          ctx.fill()

          // --- 3. Micro-Bevel Hairline Edges ---
          // Each edge catches light differently: top-left edges glint, bottom-right softly shadow
          for (let i = 0; i < 6; i++) {
            const next = (i + 1) % 6
            const p1 = capPts[i]
            const p2 = capPts[next]

            // Normal pointing outwards
            const edgeDx = p2[0] - p1[0]
            const edgeDy = p2[1] - p1[1]
            const nx = -edgeDy
            const ny = edgeDx
            const len = Math.hypot(nx, ny) || 1
            const dot = (nx / len) * lx + (ny / len) * ly

            ctx.beginPath()
            ctx.moveTo(p1[0], p1[1])
            ctx.lineTo(p2[0], p2[1])

            if (dot > 0.05) {
              // Highlight edge
              const alpha = 0.35 + dot * 0.35 + zNorm * 0.30
              ctx.strokeStyle = `rgba(255, 255, 255, ${Math.min(0.9, alpha)})`
              ctx.lineWidth = 1.1
            } else {
              // Shadow edge
              const alpha = 0.08 + Math.abs(dot) * 0.12 + zNorm * 0.08
              ctx.strokeStyle = `rgba(23, 23, 25, ${alpha})`
              ctx.lineWidth = 0.8
            }
            ctx.stroke()
          }

          // --- 4. Designer Touch: Minimal Inner Micro-Ring ---
          // Subtle concentric inner hexagon for refined hardware/ceramic look
          const innerPts = getHexVertices(capCx, capCy, capRadius * 0.52)
          ctx.beginPath()
          ctx.moveTo(innerPts[0][0], innerPts[0][1])
          for (let i = 1; i < 6; i++) {
            ctx.lineTo(innerPts[i][0], innerPts[i][1])
          }
          ctx.closePath()
          ctx.strokeStyle = `rgba(255, 255, 255, ${0.10 + zNorm * 0.20})`
          ctx.lineWidth = 0.7
          ctx.stroke()

          // Tiny minimal center pip
          ctx.beginPath()
          ctx.arc(capCx, capCy, 1.2, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(23, 23, 25, ${0.12 + zNorm * 0.16})`
          ctx.fill()
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
