import { motion, type Variants } from 'framer-motion'

interface AnimatedListProps {
    children: React.ReactNode[]
    className?: string
    stagger?: number
    delay?: number
}

const container: Variants = {
    hidden: {},
    show: (custom: { stagger: number; delay: number }) => ({
        transition: { staggerChildren: custom.stagger, delayChildren: custom.delay },
    }),
}

const item: Variants = {
    hidden: { opacity: 0, y: 14 },
    show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.25, 0.46, 0.45, 0.94] } },
}

export default function AnimatedList({ children, className = '', stagger = 0.07, delay = 0 }: AnimatedListProps) {
    return (
        <motion.div
            variants={container}
            initial="hidden"
            animate="show"
            custom={{ stagger, delay }}
            className={className}
        >
            {children.map((child, i) => (
                <motion.div key={i} variants={item}>
                    {child}
                </motion.div>
            ))}
        </motion.div>
    )
}
