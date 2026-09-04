import { cn } from '@/lib/utils'

interface StatusBadgeProps {
    status: string
    className?: string
}

export default function StatusBadge({ status, className }: StatusBadgeProps) {
    // Agreement lifecycle states (§5) plus a few terminal/outcome labels
    // reused verbatim as status text (e.g. outbox row status).
    const stateColors: Record<string, string> = {
        DRAFT: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
        COMMITTED: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
        SUBMITTED: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
        VERIFIED: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
        NEEDS_REVIEW: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
        DISPUTED: 'bg-orange-500/15 text-orange-400 border-orange-500/25',
        RULED: 'bg-orange-500/15 text-orange-400 border-orange-500/25',
        SETTLEMENT_AUTHORIZED: 'bg-violet-500/20 text-violet-400 border-violet-500/30',
        SETTLED: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
        CANCELLED: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
        PASS: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
        FAIL: 'bg-red-500/15 text-red-400 border-red-500/25',
        INCONCLUSIVE: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
        ACCEPT: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
        REJECT: 'bg-red-500/15 text-red-400 border-red-500/25',
        PENDING: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
        CONFIRMED: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
        FAILED: 'bg-red-500/15 text-red-400 border-red-500/25',
    }

    const color = stateColors[status] || 'bg-slate-500/20 text-slate-400 border-slate-500/30'
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
