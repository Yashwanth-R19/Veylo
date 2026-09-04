import { useCountdown } from '@/hooks/useCountdown'
import { cn } from '@/lib/utils'
import { Clock } from 'lucide-react'

interface DeadlineCountdownProps {
    deadline: string | null
    className?: string
}

export default function DeadlineCountdown({ deadline, className }: DeadlineCountdownProps) {
    const { text, urgency } = useCountdown(deadline)

    const colorMap = {
        normal: 'text-text',
        warn: 'text-warning',
        critical: 'text-danger',
        expired: 'text-danger',
    }

    return (
        <span className={cn('inline-flex items-center gap-1.5 text-xs font-body', colorMap[urgency], className)}>
            <Clock className="w-3 h-3" />
            {text}
        </span>
    )
}
