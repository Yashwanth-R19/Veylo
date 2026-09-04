export function cn(...classes: (string | false | null | undefined)[]): string {
    return classes.filter(Boolean).join(' ')
}

export function formatAddress(address: string, chars = 6): string {
    if (!address) return ''
    return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`
}

export function formatHash(hash: string, start = 6, end = 4): string {
    if (!hash) return ''
    return `${hash.slice(0, start + 2)}...${hash.slice(-end)}`
}

export function formatCurrency(amount: string | number, currency = 'USD'): string {
    const num = typeof amount === 'string' ? parseFloat(amount) : amount
    if (isNaN(num)) return currency === 'INR' ? '₹0' : `${currency} 0`
    try {
        return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
            style: 'currency',
            currency,
            maximumFractionDigits: 0,
        }).format(num)
    } catch {
        // Intl throws on an unrecognized ISO 4217 code — fall back rather than crash the page.
        return `${currency} ${num.toLocaleString()}`
    }
}

export function formatDate(dateStr: string | null): string {
    if (!dateStr) return '—'
    return new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    })
}

export function formatDateTime(dateStr: string | null): string {
    if (!dateStr) return '—'
    return new Date(dateStr).toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    })
}

export function formatRelativeTime(dateStr: string): string {
    const now = Date.now()
    const diff = Math.floor((now - new Date(dateStr).getTime()) / 1000)
    if (diff < 60) return 'just now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
    return formatDate(dateStr)
}

export function formatCountdown(deadline: string | null): { text: string; urgency: 'normal' | 'warn' | 'critical' | 'expired' } {
    if (!deadline) return { text: 'No deadline', urgency: 'normal' }
    const now = Date.now()
    const diff = new Date(deadline).getTime() - now
    if (diff <= 0) return { text: 'Expired', urgency: 'expired' }
    const seconds = Math.floor(diff / 1000)
    if (seconds < 3600) return { text: `${Math.floor(seconds / 60)}m remaining`, urgency: 'critical' }
    if (seconds < 86400) return { text: `${Math.floor(seconds / 3600)}h remaining`, urgency: 'warn' }
    const days = Math.floor(seconds / 86400)
    return { text: `${days}d remaining`, urgency: 'normal' }
}

export function formatDuration(ms: number): string {
    const seconds = (ms / 1000).toFixed(1)
    return `${seconds}s`
}

export function copyToClipboard(text: string): Promise<void> {
    return navigator.clipboard.writeText(text)
}

/** A random 128-bit nonce (decimal string) for EIP-712 replay protection — no "next nonce" endpoint exists, and the contract only needs each (signer, nonce) pair used once, so a random value is sufficient. */
export function randomNonce(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
    return BigInt('0x' + hex).toString()
}
