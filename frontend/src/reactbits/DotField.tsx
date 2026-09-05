import { useEffect, useRef, memo } from 'react'

// Ported from react-bits (github.com/DavidHDev/react-bits, Backgrounds/DotField),
// converted to TypeScript, restyled with the app's accent color instead of the
// upstream purple default, and gated behind prefers-reduced-motion (draws one
// static frame, no cursor tracking, no rAF loop).

const TWO_PI = Math.PI * 2

interface Dot {
    ax: number
    ay: number
    sx: number
    sy: number
    vx: number
    vy: number
    x: number
    y: number
}

interface DotFieldProps {
    dotRadius?: number
    dotSpacing?: number
    cursorRadius?: number
    bulgeStrength?: number
    glowRadius?: number
    gradientFrom?: string
    gradientTo?: string
    glowColor?: string
    className?: string
}

const DotField = memo(function DotField({
    dotRadius = 1.5,
    dotSpacing = 20,
    cursorRadius = 220,
    bulgeStrength = 40,
    glowRadius = 160,
    gradientFrom = 'rgba(181, 96, 46, 0.30)',
    gradientTo = 'rgba(181, 96, 46, 0.12)',
    glowColor = '#B5602E',
    className = '',
}: DotFieldProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const glowRef = useRef<SVGCircleElement>(null)
    const dotsRef = useRef<Dot[]>([])
    const mouseRef = useRef({ x: -9999, y: -9999, prevX: -9999, prevY: -9999, speed: 0 })
    const rafRef = useRef<number>(0)
    const sizeRef = useRef({ w: 0, h: 0, offsetX: 0, offsetY: 0 })
    const glowOpacity = useRef(0)
    const engagement = useRef(0)
    const glowIdRef = useRef(`dot-field-glow-${Math.random().toString(36).slice(2, 9)}`)
    const reducedMotionRef = useRef(false)

    useEffect(() => {
        reducedMotionRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches

        const canvas = canvasRef.current
        const glowEl = glowRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d', { alpha: true })
        if (!ctx) return
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        let resizeTimer: ReturnType<typeof setTimeout>

        function resize() {
            clearTimeout(resizeTimer)
            resizeTimer = setTimeout(doResize, 100)
        }

        function buildDots(w: number, h: number) {
            const step = dotRadius + dotSpacing
            const cols = Math.floor(w / step)
            const rows = Math.floor(h / step)
            const padX = (w % step) / 2
            const padY = (h % step) / 2
            const dots: Dot[] = new Array(rows * cols)
            let idx = 0

            for (let row = 0; row < rows; row++) {
                for (let col = 0; col < cols; col++) {
                    const ax = padX + col * step + step / 2
                    const ay = padY + row * step + step / 2
                    dots[idx++] = { ax, ay, sx: ax, sy: ay, vx: 0, vy: 0, x: ax, y: ay }
                }
            }
            dotsRef.current = dots
        }

        function doResize() {
            if (!canvas) return
            const rect = canvas.parentElement!.getBoundingClientRect()
            const w = rect.width
            const h = rect.height

            canvas.width = w * dpr
            canvas.height = h * dpr
            canvas.style.width = `${w}px`
            canvas.style.height = `${h}px`
            ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)

            sizeRef.current = {
                w,
                h,
                offsetX: rect.left + window.scrollX,
                offsetY: rect.top + window.scrollY,
            }

            buildDots(w, h)
            if (reducedMotionRef.current) drawStatic(w, h)
        }

        function drawStatic(w: number, h: number) {
            if (!ctx) return
            ctx.clearRect(0, 0, w, h)
            const grad = ctx.createLinearGradient(0, 0, w, h)
            grad.addColorStop(0, gradientFrom)
            grad.addColorStop(1, gradientTo)
            ctx.fillStyle = grad
            const rad = dotRadius / 2
            ctx.beginPath()
            for (const d of dotsRef.current) {
                ctx.moveTo(d.ax + rad, d.ay)
                ctx.arc(d.ax, d.ay, rad, 0, TWO_PI)
            }
            ctx.fill()
        }

        function onMouseMove(e: MouseEvent) {
            const s = sizeRef.current
            mouseRef.current.x = e.pageX - s.offsetX
            mouseRef.current.y = e.pageY - s.offsetY
        }

        function updateMouseSpeed() {
            const m = mouseRef.current
            const dx = m.prevX - m.x
            const dy = m.prevY - m.y
            const dist = Math.sqrt(dx * dx + dy * dy)
            m.speed += (dist - m.speed) * 0.5
            if (m.speed < 0.001) m.speed = 0
            m.prevX = m.x
            m.prevY = m.y
        }

        const speedInterval = reducedMotionRef.current ? null : setInterval(updateMouseSpeed, 20)

        function tick() {
            const dots = dotsRef.current
            const m = mouseRef.current
            const { w, h } = sizeRef.current
            const len = dots.length

            const targetEngagement = Math.min(m.speed / 5, 1)
            engagement.current += (targetEngagement - engagement.current) * 0.06
            if (engagement.current < 0.001) engagement.current = 0
            const eng = engagement.current

            glowOpacity.current += (eng - glowOpacity.current) * 0.08

            if (glowEl) {
                glowEl.setAttribute('cx', String(m.x))
                glowEl.setAttribute('cy', String(m.y))
                glowEl.style.opacity = String(glowOpacity.current)
            }

            ctx!.clearRect(0, 0, w, h)

            const grad = ctx!.createLinearGradient(0, 0, w, h)
            grad.addColorStop(0, gradientFrom)
            grad.addColorStop(1, gradientTo)
            ctx!.fillStyle = grad

            const crSq = cursorRadius * cursorRadius
            const rad = dotRadius / 2

            ctx!.beginPath()

            for (let i = 0; i < len; i++) {
                const d = dots[i]
                const dx = m.x - d.ax
                const dy = m.y - d.ay
                const distSq = dx * dx + dy * dy

                if (distSq < crSq && eng > 0.01) {
                    const dist = Math.sqrt(distSq)
                    const t = 1 - dist / cursorRadius
                    const push = t * t * bulgeStrength * eng
                    const angle = Math.atan2(dy, dx)
                    d.sx += (d.ax - Math.cos(angle) * push - d.sx) * 0.15
                    d.sy += (d.ay - Math.sin(angle) * push - d.sy) * 0.15
                } else {
                    d.sx += (d.ax - d.sx) * 0.1
                    d.sy += (d.ay - d.sy) * 0.1
                }

                ctx!.moveTo(d.sx + rad, d.sy)
                ctx!.arc(d.sx, d.sy, rad, 0, TWO_PI)
            }

            ctx!.fill()

            rafRef.current = requestAnimationFrame(tick)
        }

        doResize()
        window.addEventListener('resize', resize)

        if (!reducedMotionRef.current) {
            window.addEventListener('mousemove', onMouseMove, { passive: true })
            rafRef.current = requestAnimationFrame(tick)
        }

        return () => {
            cancelAnimationFrame(rafRef.current)
            if (speedInterval) clearInterval(speedInterval)
            clearTimeout(resizeTimer)
            window.removeEventListener('resize', resize)
            window.removeEventListener('mousemove', onMouseMove)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    return (
        <div className={`relative w-full h-full ${className}`}>
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
                <defs>
                    <radialGradient id={glowIdRef.current}>
                        <stop offset="0%" stopColor={glowColor} />
                        <stop offset="100%" stopColor="transparent" />
                    </radialGradient>
                </defs>
                <circle
                    ref={glowRef}
                    cx={-9999}
                    cy={-9999}
                    r={glowRadius}
                    fill={`url(#${glowIdRef.current})`}
                    style={{ opacity: 0, willChange: 'opacity' }}
                />
            </svg>
        </div>
    )
})

export default DotField
