import { useRef } from 'react'
import { motion, useInView, useReducedMotion } from 'framer-motion'

interface ScrollRevealProps {
    children: React.ReactNode
    className?: string
    delay?: number
    staggerIndex?: number
    staggerDelay?: number
}

export default function ScrollReveal({ children, className = '', delay = 0, staggerIndex = 0, staggerDelay = 0.07 }: ScrollRevealProps) {
    const ref = useRef(null)
    const isInView = useInView(ref, { once: true, margin: '-60px' })
    const reduceMotion = useReducedMotion()

    if (reduceMotion) {
        return <div className={className}>{children}</div>
    }

    return (
        <motion.div
            ref={ref}
            initial={{ opacity: 0, y: 14 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{
                delay: delay + staggerIndex * staggerDelay,
                duration: 0.45,
                ease: [0.22, 0.61, 0.36, 1],
            }}
            className={className}
        >
            {children}
        </motion.div>
    )
}
