import { useRef } from 'react'
import { motion, useInView, useReducedMotion } from 'framer-motion'

interface BlurTextProps {
    text: string
    className?: string
    delay?: number
    stagger?: number
}

export default function BlurText({ text, className = '', delay = 0, stagger = 0.04 }: BlurTextProps) {
    const ref = useRef(null)
    const isInView = useInView(ref, { once: true })
    const reduceMotion = useReducedMotion()
    const words = text.split(' ')

    if (reduceMotion) {
        return <span className={className}>{text}</span>
    }

    return (
        <span ref={ref} className={className} style={{ display: 'inline' }}>
            {words.map((word, i) => (
                <motion.span
                    key={i}
                    initial={{ opacity: 0, filter: 'blur(8px)', y: 6 }}
                    animate={isInView ? { opacity: 1, filter: 'blur(0px)', y: 0 } : {}}
                    transition={{
                        delay: delay + i * stagger,
                        duration: 0.5,
                        ease: [0.22, 0.61, 0.36, 1],
                    }}
                    style={{ display: 'inline-block', marginRight: '0.3em' }}
                >
                    {word}
                </motion.span>
            ))}
        </span>
    )
}
