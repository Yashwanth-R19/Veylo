import { useState } from 'react'
import { cn, formatAddress, copyToClipboard } from '@/lib/utils'
import { Copy, Check } from 'lucide-react'

interface WalletAddressProps {
    address: string
    truncate?: boolean
    copyable?: boolean
    className?: string
}

export default function WalletAddress({ address, truncate = true, copyable = true, className }: WalletAddressProps) {
    const [copied, setCopied] = useState(false)

    const handleCopy = async () => {
        await copyToClipboard(address)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
    }

    return (
        <span className={cn('inline-flex items-center gap-1.5 font-mono text-text', className)} title={address}>
            <span className="text-xs">{truncate ? formatAddress(address) : address}</span>
            {copyable && (
                <button onClick={handleCopy} className="text-text-muted hover:text-text transition-colors">
                    {copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
                </button>
            )}
        </span>
    )
}
