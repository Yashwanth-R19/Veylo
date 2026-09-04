import { cn } from '@/lib/utils'

interface StatusBadgeProps {
    status: string
    className?: string
}

export default function StatusBadge({ status, className }: StatusBadgeProps) {
    // Agreement lifecycle states (§5) plus a few terminal/outcome labels
    // reused verbatim as status text (e.g. outbox row status).
    const stateColors: Record<string, string> = {
        DRAFT: 'bg-bg-subtle text-text-muted border-border',
        COMMITTED: 'bg-info-bg text-info border-info/30',
        SUBMITTED: 'bg-info-bg text-info border-info/30',
        VERIFIED: 'bg-success-bg text-success border-success/30',
        NEEDS_REVIEW: 'bg-warning-bg text-warning border-warning/30',
        DISPUTED: 'bg-danger-bg text-danger border-danger/30',
        RULED: 'bg-info-bg text-info border-info/30',
        SETTLEMENT_AUTHORIZED: 'bg-accent-bg text-accent border-accent-border',
        SETTLED: 'bg-success-bg text-success border-success/30',
        CANCELLED: 'bg-bg-subtle text-text-muted border-border',
        PASS: 'bg-success-bg text-success border-success/30',
        FAIL: 'bg-danger-bg text-danger border-danger/30',
        INCONCLUSIVE: 'bg-warning-bg text-warning border-warning/30',
        ACCEPT: 'bg-success-bg text-success border-success/30',
        REJECT: 'bg-danger-bg text-danger border-danger/30',
        PENDING: 'bg-bg-subtle text-text-muted border-border',
        CONFIRMED: 'bg-success-bg text-success border-success/30',
        FAILED: 'bg-danger-bg text-danger border-danger/30',
    }

    const color = stateColors[status] || 'bg-bg-subtle text-text-muted border-border'
    const label = status.replace(/_/g, ' ')

    return (
        <span className={cn(
            'inline-flex items-center px-2.5 py-0.5 rounded-md text-[11px] font-medium border font-body uppercase tracking-wide',
            color,
            className,
        )}>
            {label}
        </span>
    )
}
