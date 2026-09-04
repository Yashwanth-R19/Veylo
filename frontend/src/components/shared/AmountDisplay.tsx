import { cn, formatCurrency } from '@/lib/utils'

interface AmountDisplayProps {
    amount: string | number
    currency?: string
    size?: 'sm' | 'md' | 'lg'
    className?: string
}

export default function AmountDisplay({ amount, currency = 'USD', size = 'md', className }: AmountDisplayProps) {
    const sizeClass = size === 'lg' ? 'text-2xl' : size === 'md' ? 'text-base' : 'text-sm'

    return (
        <span className={cn('font-mono font-semibold text-text-heading', sizeClass, className)}>
            {formatCurrency(amount, currency)}
        </span>
    )
}
