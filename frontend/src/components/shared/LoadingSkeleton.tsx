import { cn } from '@/lib/utils'

interface LoadingSkeletonProps {
    variant?: 'card' | 'line' | 'circle' | 'stat'
    count?: number
    className?: string
}

export default function LoadingSkeleton({ variant = 'line', count = 1, className }: LoadingSkeletonProps) {
    const items = Array.from({ length: count })

    if (variant === 'stat') {
        return (
            <div className={cn('grid grid-cols-4 gap-4', className)}>
                {items.map((_, i) => (
                    <div key={i} className="surface p-5 space-y-3">
                        <div className="h-3 w-20 rounded skeleton-shimmer" />
                        <div className="h-7 w-16 rounded skeleton-shimmer" />
                    </div>
                ))}
            </div>
        )
    }

    if (variant === 'card') {
        return (
            <div className={cn('space-y-3', className)}>
                {items.map((_, i) => (
                    <div key={i} className="surface p-5 space-y-3">
                        <div className="h-4 w-3/5 rounded skeleton-shimmer" />
                        <div className="h-3 w-4/5 rounded skeleton-shimmer" />
                        <div className="h-3 w-2/5 rounded skeleton-shimmer" />
                    </div>
                ))}
            </div>
        )
    }

    if (variant === 'circle') {
        return (
            <div className={cn('flex gap-3', className)}>
                {items.map((_, i) => (
                    <div key={i} className="w-10 h-10 rounded-full skeleton-shimmer" />
                ))}
            </div>
        )
    }

    return (
        <div className={cn('space-y-2', className)}>
            {items.map((_, i) => (
                <div key={i} className="h-3 rounded skeleton-shimmer" style={{ width: `${60 + Math.random() * 30}%` }} />
            ))}
        </div>
    )
}
