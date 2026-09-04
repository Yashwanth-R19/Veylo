import { useRef, useEffect, useState } from 'react'
import { useInView, useReducedMotion } from 'framer-motion'

interface CountUpProps {
    end: number
    duration?: number
    decimals?: number
    prefix?: string
    suffix?: string
    className?: string
    delay?: number
}

export default function CountUp({ end, duration = 1.5, decimals = 0, prefix = '', suffix = '', className = '', delay = 0 }: CountUpProps) {
    const ref = useRef<HTMLSpanElement>(null)
    const isInView = useInView(ref, { once: true })
    const reduceMotion = useReducedMotion()
    const [value, setValue] = useState(reduceMotion ? end : 0)
    const [hasAnimated, setHasAnimated] = useState(false)

    useEffect(() => {
        if (!isInView || hasAnimated || reduceMotion) return

        const timer = setTimeout(() => {
            const startTime = performance.now()

            const animate = (now: number) => {
                const elapsed = now - startTime
                const progress = Math.min(elapsed / (duration * 1000), 1)
                // ease-out cubic
                const eased = 1 - Math.pow(1 - progress, 3)
                setValue(eased * end)

                if (progress < 1) {
                    requestAnimationFrame(animate)
                } else {
                    setValue(end)
                    setHasAnimated(true)
                }
            }

            requestAnimationFrame(animate)
        }, delay)

        return () => clearTimeout(timer)
    }, [isInView, end, duration, delay, hasAnimated, reduceMotion])

    return (
        <span ref={ref} className={className}>
            {prefix}{value.toFixed(decimals)}{suffix}
        </span>
    )
}
