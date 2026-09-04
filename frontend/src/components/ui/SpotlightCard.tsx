import { useRef } from 'react'
import { cn } from '@/lib/utils'
import { useTheme } from '@/theme/useTheme'

interface SpotlightCardProps {
    children: React.ReactNode
    className?: string
}

/**
 * A mouse-tracked radial spotlight hover — one of the few permitted
 * "extra" motion effects (Aporia's design spec allows it explicitly),
 * gated to the dark theme only, matching that same rule.
 */
export default function SpotlightCard({ children, className }: SpotlightCardProps) {
    const cardRef = useRef<HTMLDivElement>(null)
    const { theme } = useTheme()

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!cardRef.current) return
        const rect = cardRef.current.getBoundingClientRect()
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top
        cardRef.current.style.setProperty('--spotlight-x', `${x}px`)
        cardRef.current.style.setProperty('--spotlight-y', `${y}px`)
    }

    return (
        <div
            ref={cardRef}
            onMouseMove={theme === 'dark' ? handleMouseMove : undefined}
            className={cn(
                'relative surface overflow-hidden group card-hover',
                className
            )}
        >
            {theme === 'dark' && (
                <div
                    className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                    style={{
                        background: 'radial-gradient(350px circle at var(--spotlight-x, 50%) var(--spotlight-y, 50%), rgba(181, 96, 46, 0.10), transparent 60%)',
                    }}
                />
            )}
            <div className="relative z-10">
                {children}
            </div>
        </div>
    )
}
