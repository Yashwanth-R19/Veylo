import { useState, useEffect, useCallback } from 'react'
import Card from '@/components/shared/Card'
import HashDisplay from '@/components/shared/HashDisplay'
import WalletAddress from '@/components/shared/WalletAddress'
import LoadingSkeleton from '@/components/shared/LoadingSkeleton'
import { getDispute, raiseDispute } from '@/lib/api'
import { formatDateTime } from '@/lib/utils'
import type { DisputeView } from '@/types'
import { Scale, AlertTriangle, Loader2 } from 'lucide-react'

const RULING_LABELS: Record<number, string> = {
    0: 'Refused (resolves REJECT)',
    1: 'ACCEPT',
    2: 'REJECT',
}

/**
 * Screen 6 — Dispute. Read-only status (id, arbitrator, ruling) plus raising
 * a dispute. Giving a ruling is deliberately NOT here — Phase 4 built that as
 * a backend-only operator interface (POST /agreements/:id/rule), confirmed
 * out of frontend scope, since the operator acting as arbitrator is not a
 * feature to expose as a public UI action.
 */
export default function DisputePanel({
    agreementId,
    canRaise,
}: {
    agreementId: number
    /** Whether the current agreement status allows raising a dispute right now (VERIFIED or NEEDS_REVIEW, within the review window). */
    canRaise: boolean
}) {
    const [view, setView] = useState<DisputeView | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [party, setParty] = useState<'client' | 'worker'>('client')
    const [reason, setReason] = useState('')
    const [raising, setRaising] = useState(false)
    const [raiseError, setRaiseError] = useState<string | null>(null)

    const load = useCallback(() => {
        getDispute(agreementId).then(setView).catch((err) => setError(err instanceof Error ? err.message : 'Failed to load dispute status'))
    }, [agreementId])

    useEffect(() => { load() }, [load])

    const handleRaise = async () => {
        setRaising(true)
        setRaiseError(null)
        try {
            await raiseDispute(agreementId, party, reason.trim() || undefined)
            load()
        } catch (err) {
            setRaiseError(err instanceof Error ? err.message : 'Failed to raise dispute')
        } finally {
            setRaising(false)
        }
    }

    if (error) {
        return (
            <Card className="p-6 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-danger flex-shrink-0 mt-0.5" />
                <p className="text-sm text-danger font-body">{error}</p>
            </Card>
        )
    }
    if (!view) return <LoadingSkeleton variant="card" />

    return (
        <Card className="p-6 space-y-4">
            <h2 className="font-display font-semibold text-sm text-text-heading flex items-center gap-2">
                <Scale className="w-4 h-4 text-warning" /> Dispute
            </h2>

            <div className="text-xs text-text-muted font-body bg-warning-bg border border-warning/30 rounded-md px-3 py-2">
                The arbitrator is the Veylo operator acting under Kleros's own documented
                <code className="mx-1 font-mono">CentralizedArbitrator</code>
                testing pattern — not an independent or neutral third party. See the README's trust model.
            </div>

            {!view.dispute && (
                <div className="space-y-2">
                    <p className="text-xs text-text-muted font-body">No dispute has been raised for this agreement.</p>
                    {canRaise && (
                        <div className="space-y-2 max-w-md">
                            <div className="flex rounded-md border border-border overflow-hidden w-fit">
                                {(['client', 'worker'] as const).map((p) => (
                                    <button
                                        key={p}
                                        onClick={() => setParty(p)}
                                        className={`px-3 py-1.5 text-[11px] font-medium font-body uppercase tracking-wide transition-colors ${party === p ? 'bg-warning text-accent-contrast' : 'text-text-muted hover:text-text'}`}
                                    >
                                        as {p}
                                    </button>
                                ))}
                            </div>
                            <textarea
                                className="input-field w-full min-h-[60px]"
                                placeholder="Reason (stored off-chain; only its hash is committed on-chain)"
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                            />
                            <button
                                onClick={handleRaise}
                                disabled={raising}
                                className="flex items-center gap-2 px-4 py-2 rounded-md bg-warning hover:brightness-110 disabled:opacity-50 text-accent-contrast text-sm font-medium transition-colors"
                            >
                                {raising && <Loader2 className="w-4 h-4 animate-spin" />} Raise Dispute
                            </button>
                            {raiseError && <p className="text-xs text-danger font-body">{raiseError}</p>}
                        </div>
                    )}
                </div>
            )}

            {view.dispute && (
                <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                            <p className="text-xs text-text-muted font-body mb-1">Dispute status</p>
                            <p className="text-text-heading font-body">{view.dispute.status}</p>
                        </div>
                        <div>
                            <p className="text-xs text-text-muted font-body mb-1">Ruling</p>
                            <p className="text-text-heading font-body">
                                {view.dispute.ruling !== null ? RULING_LABELS[view.dispute.ruling] : 'Not yet ruled'}
                            </p>
                        </div>
                        <div>
                            <p className="text-xs text-text-muted font-body mb-1">Arbitrator</p>
                            <WalletAddress address={view.arbitratorAddress} />
                        </div>
                        <div>
                            <p className="text-xs text-text-muted font-body mb-1">Raised</p>
                            <p className="text-text-heading font-body">{formatDateTime(view.dispute.createdAt)}</p>
                        </div>
                    </div>
                    {view.dispute.reason && (
                        <div>
                            <p className="text-xs text-text-muted font-body mb-1">Reason (off-chain)</p>
                            <p className="text-sm text-text font-body">{view.dispute.reason}</p>
                        </div>
                    )}
                    {view.dispute.reasonHash && <HashDisplay hash={view.dispute.reasonHash} label="reasonHash (on-chain)" />}
                    {view.onChain && (
                        <p className="text-xs text-text-muted font-body">On-chain dispute status: {view.onChain.disputeStatus}</p>
                    )}
                    {view.chainError && (
                        <div className="flex items-start gap-2 text-xs text-warning font-body bg-warning-bg border border-warning/30 rounded-md px-3 py-2">
                            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                            <span>On-chain dispute status unavailable: {view.chainError}</span>
                        </div>
                    )}
                </div>
            )}
        </Card>
    )
}
