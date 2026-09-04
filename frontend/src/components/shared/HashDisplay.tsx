import { useState } from 'react'
import { cn, formatHash, copyToClipboard } from '@/lib/utils'
import { Copy, Check, ExternalLink } from 'lucide-react'

interface HashDisplayProps {
    hash: string
    label?: string
    /** Amoy explorer base (from GET /api/chain-info) plus the tx/address path segment to link to, e.g. `${blockExplorerBase}/tx` or `${blockExplorerBase}/address`. Omit to render without a link. */
    explorerUrl?: string
    className?: string
}

export default function HashDisplay({ hash, label, explorerUrl, className }: HashDisplayProps) {
    const [copied, setCopied] = useState(false)

    const handleCopy = async () => {
        await copyToClipboard(hash)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
    }

    return (
        <div className={cn('flex items-center gap-2', className)}>
            {label && <span className="text-xs text-text-muted">{label}</span>}
            <span className="font-mono text-xs text-text-secondary">{formatHash(hash)}</span>
            <button onClick={handleCopy} className="text-text-muted hover:text-text-secondary transition-colors">
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            </button>
            {explorerUrl && (
                <a
                    href={`${explorerUrl}/${hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-text-muted hover:text-violet-400 transition-colors"
                >
                    <ExternalLink className="w-3 h-3" />
                </a>
            )}
        </div>
    )
}
