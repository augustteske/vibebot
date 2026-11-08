import { useEffect, useRef } from 'react'

interface HoneycombBackgroundProps {
  className?: string
  opacity?: number
  interactive?: boolean
}

export function HoneycombBackground({
  className = '',
  opacity = 0.95,
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

    // Pointer tracking for interactive 3D wave
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

    // Honeycomb 3D scale dimensions
    const radius = 32 // scale outer radius
    const hexWidth = Math.sqrt(3) * radius
    const xStep = hexWidth
    const yStep = radius * 1.5

    // Periodic travelling pulse waves
    let waveRadius = -80
    let waveCenterX = width * 0.2
    let waveCenterY = height * 0.35
    const waveSpeed = 280 // px/sec
    let waveActive = true
    let lastWaveTime = performance.now()
    let lastFrameTime = performance.now()

    function launchWave(now: number) {
      waveCenterX = width * (0.15 + Math.random() * 0.7)
      waveCenterY = height * (0.2 + Math.random() * 0.6)
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
        mouseX += (targetMouseX - mouseX) * Math.min(1, dt * 10)
        mouseY += (targetMouseY - mouseY) * Math.min(1, dt * 10)
      } else {
        mouseX = -9999
        mouseY = -9999
      }

      // Progress radial travelling wave
      if (!prefersReducedMotion) {
        if (waveActive) {
          waveRadius += waveSpeed * dt
          const maxDist = Math.hypot(width, height) + 160
          if (waveRadius > maxDist) {
            waveActive = false
            lastWaveTime = now
          }
        } else if (now - lastWaveTime > 2600) {
          launchWave(now)
        }
      }

      ctx.clearRect(0, 0, width, height)

      const cols = Math.ceil(width / xStep) + 2
      const rows = Math.ceil(height / yStep) + 2
      const timeSec = now * 0.0016

      // Light vector from upper-left (angled down and right)
      const lx = -0.58
      const ly = -0.81

      const waveBandWidth = 200

      for (let row = -1; row < rows; row++) {
        const cy = row * yStep
        const xOffset = row % 2 === 0 ? 0 : xStep * 0.5

        for (let col = -1; col < cols; col++) {
          const cx = col * xStep + xOffset

          // 1. Organic continuous 3D breathing wave
          const ambientWave = prefersReducedMotion
            ? 0.3
            : (Math.sin(cx * 0.014 - cy * 0.011 + timeSec * 1.6) * 0.5 + 0.5) *
              (Math.cos(cx * 0.009 + cy * 0.015 - timeSec * 1.1) * 0.4 + 0.6)

          // 2. Travelling impulse wave
          let waveFactor = 0
          if (waveActive && !prefersReducedMotion) {
            const distFromWave = Math.hypot(cx - waveCenterX, cy - waveCenterY)
            const diff = Math.abs(distFromWave - waveRadius)
            if (diff < waveBandWidth) {
              waveFactor = Math.cos((diff / waveBandWidth) * (Math.PI / 2))
            }
          }

          // 3. Interactive pointer proximity wave
          let mouseFactor = 0
          if (mouseX > -5000) {
            const distToMouse = Math.hypot(cx - mouseX, cy - mouseY)
            const mouseRadius = 180
            if (distToMouse < mouseRadius) {
              mouseFactor = Math.cos((distToMouse / mouseRadius) * (Math.PI / 2))
            }
          }

          // Combined 3D elevation Z in range [0, 1]
          const zNorm = Math.min(1, ambientWave * 0.32 + waveFactor * 0.68 + mouseFactor * 0.85)

          // 3D parameters for scale
          // Tile outer size (leaves visible gap between neighbouring scales)
          const baseRadius = radius * 0.88
          // Top plateau face shrinks slightly as scale rises in 3D perspective
          const topRadius = baseRadius * (0.74 - zNorm * 0.06)

          // Elevation offset: higher scales shift up and toward the light source
          const zPixels = 3 + zNorm * 9 // 3px to 12px height
          const topCx = cx + lx * zPixels * 0.6
          const topCy = cy + ly * zPixels * 0.6

          const basePts = getHexVertices(cx, cy, baseRadius)
          const topPts = getHexVertices(topCx, topCy, topRadius)

          // --- Cast Shadow underneath elevated scale ---
          if (zNorm > 0.05) {
            const shadowOffsetX = -lx * zPixels * 0.8
            const shadowOffsetY = -ly * zPixels * 0.8
            const shadowPts = getHexVertices(cx + shadowOffsetX, cy + shadowOffsetY, baseRadius * 0.98)

            ctx.beginPath()
            ctx.moveTo(shadowPts[0][0], shadowPts[0][1])
            for (let i = 1; i < 6; i++) {
              ctx.lineTo(shadowPts[i][0], shadowPts[i][1])
            }
            ctx.closePath()
            ctx.fillStyle = `rgba(23, 23, 25, ${0.08 + zNorm * 0.16})`
            ctx.fill()
          }

          // --- 3D Bevel Facets (6 side slopes) ---
          for (let i = 0; i < 6; i++) {
            const next = (i + 1) % 6
            const b1 = basePts[i]
            const b2 = basePts[next]
            const t1 = topPts[i]
            const t2 = topPts[next]

            // Calculate facet surface normal pointing outwards
            const edgeDx = b2[0] - b1[0]
            const edgeDy = b2[1] - b1[1]
            const nx = -edgeDy
            const ny = edgeDx
            const len = Math.hypot(nx, ny) || 1
            const dot = (nx / len) * lx + (ny / len) * ly

            ctx.beginPath()
            ctx.moveTo(b1[0], b1[1])
            ctx.lineTo(b2[0], b2[1])
            ctx.lineTo(t2[0], t2[1])
            ctx.lineTo(t1[0], t1[1])
            ctx.closePath()

            if (dot > 0.08) {
              // Facet facing light: glossy specular highlight
              // Bright pearlescent highlight on golden background
              const highlightIntensity = Math.min(1, dot * (0.45 + zNorm * 0.5))
              ctx.fillStyle = `rgba(255, 255, 255, ${0.28 + highlightIntensity * 0.52})`
              ctx.fill()
            } else {
              // Facet facing away from light: deep sculpted shadow
              const shadowIntensity = Math.min(1, Math.abs(dot) * (0.35 + zNorm * 0.45))
              ctx.fillStyle = `rgba(23, 23, 25, ${0.12 + shadowIntensity * 0.28})`
              ctx.fill()
            }

            // Facet edge line for crisp polygonal definition
            ctx.strokeStyle = dot > 0 ? 'rgba(255, 255, 255, 0.4)' : 'rgba(23, 23, 25, 0.16)'
            ctx.lineWidth = 0.8
            ctx.stroke()
          }

          // --- 3D Top Face Plateau ---
          ctx.beginPath()
          ctx.moveTo(topPts[0][0], topPts[0][1])
          for (let i = 1; i < 6; i++) {
            ctx.lineTo(topPts[i][0], topPts[i][1])
          }
          ctx.closePath()

          // Plateau fill with subtle 3D lighting sheen
          const plateauAlpha = 0.18 + zNorm * 0.48
          ctx.fillStyle = `rgba(255, 255, 255, ${plateauAlpha})`
          ctx.fill()

          // Plateau perimeter ridge
          ctx.strokeStyle = `rgba(23, 23, 25, ${0.16 + zNorm * 0.32})`
          ctx.lineWidth = 1.2
          ctx.stroke()

          // Base tile outline for crisp depth layering
          ctx.beginPath()
          ctx.moveTo(basePts[0][0], basePts[0][1])
          for (let i = 1; i < 6; i++) {
            ctx.lineTo(basePts[i][0], basePts[i][1])
          }
          ctx.closePath()
          ctx.strokeStyle = 'rgba(23, 23, 25, 0.09)'
          ctx.lineWidth = 0.9
          ctx.stroke()
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
