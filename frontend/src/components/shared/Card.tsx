import { cn } from '@/lib/utils'

interface CardProps {
    children: React.ReactNode
    className?: string
    variant?: 'standard' | 'elevated' | 'subtle'
    hover?: boolean
    onClick?: () => void
}

export default function Card({ children, className, variant = 'standard', hover = false, onClick }: CardProps) {
    const base =
        variant === 'elevated' ? 'surface-elevated' :
            variant === 'subtle' ? 'surface-subtle' :
                'surface'

    return (
        <div
            onClick={onClick}
            className={cn(
                base,
                hover && 'card-hover cursor-pointer',
                className,
            )}
        >
            {children}
        </div>
    )
}
