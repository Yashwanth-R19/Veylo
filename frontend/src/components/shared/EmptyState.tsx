import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
    icon: LucideIcon
    title: string
    description?: string
    action?: { label: string; onClick: () => void }
    className?: string
}

export default function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
    return (
        <div className={cn('surface flex flex-col items-center justify-center py-16 px-8 text-center', className)}>
            <Icon className="w-10 h-10 text-text-muted mb-4" strokeWidth={1.5} />
            <h3 className="font-display font-semibold text-text-heading text-base mb-1">{title}</h3>
            {description && <p className="text-text-muted text-sm font-body max-w-sm">{description}</p>}
            {action && (
                <button
                    onClick={action.onClick}
                    className="mt-5 px-5 py-2 rounded-md bg-accent hover:bg-accent-strong text-accent-contrast text-sm font-medium transition-colors"
                >
                    {action.label}
                </button>
            )}
        </div>
    )
}
