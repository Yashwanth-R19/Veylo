import { useRef } from 'react'
import { motion, useMotionValue, useAnimationFrame, useTransform, useReducedMotion } from 'framer-motion'

// Ported from react-bits (github.com/DavidHDev/react-bits, TextAnimations/ShinyText),
// converted to TypeScript (motion/react -> framer-motion, already a dependency here).
// Uses framer-motion's own useReducedMotion, matching the rest of this codebase's
// ui/ components, instead of a manually-managed media-query ref.

interface ShinyTextProps {
    text: string
    className?: string
    speed?: number
    color?: string
    shineColor?: string
}

export default function ShinyText({ text, className = '', speed = 2.5, color = 'currentColor', shineColor = '#ffffff' }: ShinyTextProps) {
    const reduceMotion = useReducedMotion()
    const progress = useMotionValue(0)
    const elapsedRef = useRef(0)
    const lastTimeRef = useRef<number | null>(null)

    const animationDuration = speed * 1000

    useAnimationFrame((time) => {
        if (reduceMotion) return
        if (lastTimeRef.current === null) {
            lastTimeRef.current = time
            return
        }
        const deltaTime = time - lastTimeRef.current
        lastTimeRef.current = time
        elapsedRef.current += deltaTime

        const cycleTime = elapsedRef.current % animationDuration
        progress.set((cycleTime / animationDuration) * 100)
    })

    const backgroundPosition = useTransform(progress, (p) => `${150 - p * 2}% center`)

    if (reduceMotion) {
        return <span className={className} style={{ color }}>{text}</span>
    }

    const gradientStyle = {
        backgroundImage: `linear-gradient(120deg, ${color} 0%, ${color} 35%, ${shineColor} 50%, ${color} 65%, ${color} 100%)`,
        backgroundSize: '200% auto',
        WebkitBackgroundClip: 'text' as const,
        backgroundClip: 'text' as const,
        WebkitTextFillColor: 'transparent',
    }

    return (
        <motion.span className={`inline-block ${className}`} style={{ ...gradientStyle, backgroundPosition }}>
            {text}
        </motion.span>
    )
}
