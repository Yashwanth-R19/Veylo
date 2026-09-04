import { useState, useEffect } from 'react'
import { Wallet, AlertTriangle, Loader2, ShieldCheck } from 'lucide-react'
import Card from '@/components/shared/Card'
import { cn } from '@/lib/utils'
import { connectWallet, getConnectedAddress, signTypedData, isWalletAvailable } from '@/lib/wallet'
import type { Eip712Domain } from '@/lib/eip712'

interface SummaryRow {
    label: string
    value: string
}

interface SignPanelProps {
    heading: string
    description: string
    summaryRows: SummaryRow[]
    domain: Eip712Domain
    types: Record<string, readonly { name: string; type: string }[]>
    value: Record<string, unknown>
    onSigned: (result: { signature: string; signerAddress: string }) => void | Promise<void>
    disabled?: boolean
}

/**
 * Screen 2 — Sign (VEYLO_BUILD_PLAN_REVISED.md Phase 5, Session 1, Part A).
 * Shows exactly what is being signed (both a human summary and the raw
 * EIP-712 payload), connects the wallet, and requests the signature. Never
 * touches gas and never holds funds — the copy says so explicitly, because
 * that's the whole point of client/worker-held keys per §4.
 */
export default function SignPanel({ heading, description, summaryRows, domain, types, value, onSigned, disabled }: SignPanelProps) {
    const [address, setAddress] = useState<string | null>(null)
    const [connecting, setConnecting] = useState(false)
    const [signing, setSigning] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [showRaw, setShowRaw] = useState(false)

    useEffect(() => {
        getConnectedAddress().then(setAddress).catch(() => setAddress(null))
    }, [])

    const handleConnect = async () => {
        setError(null)
        setConnecting(true)
        try {
            const addr = await connectWallet()
            setAddress(addr)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to connect wallet')
        } finally {
            setConnecting(false)
        }
    }

    const handleSign = async () => {
        setError(null)
        setSigning(true)
        try {
            const result = await signTypedData(domain, types, value)
            await onSigned(result)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Signature failed or was rejected')
        } finally {
            setSigning(false)
        }
    }

    if (!isWalletAvailable()) {
        return (
            <Card className="p-6">
                <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
                    <div>
                        <h3 className="font-display font-semibold text-text-heading text-sm mb-1">No wallet detected</h3>
                        <p className="text-xs text-text-muted font-body">
                            Install MetaMask (or another injected wallet) to sign. Signing never costs gas and never
                            moves funds from this wallet — it only proves who agreed to what.
                        </p>
                    </div>
                </div>
            </Card>
        )
    }

    return (
        <Card className="p-6 space-y-5">
            <div>
                <h3 className="font-display font-semibold text-text-heading text-base mb-1">{heading}</h3>
                <p className="text-xs text-text-muted font-body">{description}</p>
            </div>

            <div className="rounded-md border border-accent-border bg-accent-bg px-4 py-3">
                <p className="text-xs text-accent font-body">
                    You pay no gas and hold no funds here. Your wallet only produces a signature; the platform relays
                    it and pays the transaction fee.
                </p>
            </div>

            <div className="space-y-2">
                {summaryRows.map((row) => (
                    <div key={row.label} className="flex items-center justify-between text-sm">
                        <span className="text-text-muted font-body">{row.label}</span>
                        <span className="font-mono text-xs text-text text-right break-all max-w-[60%]">{row.value}</span>
                    </div>
                ))}
            </div>

            <button
                onClick={() => setShowRaw((s) => !s)}
                className="text-xs text-text-muted hover:text-text transition-colors font-body underline decoration-dotted"
            >
                {showRaw ? 'Hide' : 'Show'} exact EIP-712 payload
            </button>
            {showRaw && (
                <pre className="text-[11px] font-mono text-text bg-bg-subtle border border-border rounded-md p-3 overflow-x-auto">
                    {JSON.stringify({ domain, types, value }, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2)}
                </pre>
            )}

            {error && (
                <div className="flex items-start gap-2 text-xs text-danger font-body">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <span>{error}</span>
                </div>
            )}

            {!address ? (
                <button
                    onClick={handleConnect}
                    disabled={connecting}
                    className={cn(
                        'w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-colors',
                        'bg-accent hover:bg-accent-strong text-accent-contrast disabled:opacity-60',
                    )}
                >
                    {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}
                    {connecting ? 'Connecting…' : 'Connect Wallet'}
                </button>
            ) : (
                <div className="space-y-3">
                    <div className="flex items-center gap-2 text-xs text-text-muted font-body">
                        <Wallet className="w-3.5 h-3.5" />
                        Connected: <span className="font-mono text-text">{address}</span>
                    </div>
                    <button
                        onClick={handleSign}
                        disabled={signing || disabled}
                        className={cn(
                            'w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-colors',
                            'bg-accent hover:bg-accent-strong text-accent-contrast disabled:opacity-60',
                        )}
                    >
                        {signing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                        {signing ? 'Awaiting signature…' : 'Sign'}
                    </button>
                </div>
            )}
        </Card>
    )
}
