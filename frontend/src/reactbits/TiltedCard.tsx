import { useRef, type ReactNode } from 'react'
import { motion, useMotionValue, useSpring } from 'framer-motion'

// Adapted from react-bits (github.com/DavidHDev/react-bits, Components/TiltedCard).
// Upstream tilts a single <img>; this wraps arbitrary children (stat/differentiator
// cards) instead, and drops the image-specific caption/tooltip/mobile-warning bits.

const springValues = { damping: 30, stiffness: 100, mass: 2 }

interface TiltedCardProps {
    children: ReactNode
    className?: string
    rotateAmplitude?: number
    scaleOnHover?: number
}

export default function TiltedCard({ children, className = '', rotateAmplitude = 8, scaleOnHover = 1.02 }: TiltedCardProps) {
    const ref = useRef<HTMLDivElement>(null)
    const rotateX = useSpring(useMotionValue(0), springValues)
    const rotateY = useSpring(useMotionValue(0), springValues)
    const scale = useSpring(1, springValues)

    function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
        if (!ref.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
        const rect = ref.current.getBoundingClientRect()
        const offsetX = e.clientX - rect.left - rect.width / 2
        const offsetY = e.clientY - rect.top - rect.height / 2
        rotateX.set((offsetY / (rect.height / 2)) * -rotateAmplitude)
        rotateY.set((offsetX / (rect.width / 2)) * rotateAmplitude)
    }

    function handleMouseEnter() {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
        scale.set(scaleOnHover)
    }

    function handleMouseLeave() {
        scale.set(1)
        rotateX.set(0)
        rotateY.set(0)
    }

    return (
        <div
            ref={ref}
            className={className}
            style={{ perspective: '900px' }}
            onMouseMove={handleMouseMove}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            <motion.div style={{ rotateX, rotateY, scale, transformStyle: 'preserve-3d' }} className="h-full">
                {children}
            </motion.div>
        </div>
    )
}
