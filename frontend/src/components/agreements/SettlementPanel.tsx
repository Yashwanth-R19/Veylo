import { useState, useEffect } from 'react'
import GlassCard from '@/components/shared/GlassCard'
import HashDisplay from '@/components/shared/HashDisplay'
import StatusBadge from '@/components/shared/StatusBadge'
import LoadingSkeleton from '@/components/shared/LoadingSkeleton'
import { getSettlement } from '@/lib/api'
import { formatDateTime } from '@/lib/utils'
import type { SettlementView } from '@/types'
import { Wallet, AlertTriangle, ShieldAlert } from 'lucide-react'

/**
 * Screen 7 — Settlement. Chain outcome, provider reference, reconciliation
 * status, and — required by Part F — a clear "simulated provider, no funds
 * move" label on every render, not just when a settlement exists.
 */
export default function SettlementPanel({ agreementId }: { agreementId: number }) {
    const [view, setView] = useState<SettlementView | null>(null)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        getSettlement(agreementId).then(setView).catch((err) => setError(err instanceof Error ? err.message : 'Failed to load settlement status'))
    }, [agreementId])

    if (error) {
        return (
            <GlassCard className="p-6 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-400 font-body">{error}</p>
            </GlassCard>
        )
    }
    if (!view) return <LoadingSkeleton variant="card" />

    return (
        <GlassCard className="p-6 space-y-4">
            <h2 className="font-display font-semibold text-sm text-text-primary flex items-center gap-2">
                <Wallet className="w-4 h-4 text-violet-400" /> Settlement
            </h2>

            <div className="flex items-start gap-2 text-xs text-violet-300 font-body bg-violet-500/[0.06] border border-violet-500/20 rounded-md px-3 py-2">
                <ShieldAlert className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>Simulated provider ({view.provider}) — no real funds move. This demonstrates the settlement mechanism, not a real payment.</span>
            </div>

            {!view.settlement ? (
                <p className="text-xs text-text-muted font-body">Settlement has not been initiated yet.</p>
            ) : (
                <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                            <p className="text-xs text-text-muted font-body mb-1">Decision</p>
                            <StatusBadge status={view.settlement.decision} />
                        </div>
                        <div>
                            <p className="text-xs text-text-muted font-body mb-1">Status</p>
                            <StatusBadge status={view.settlement.status} />
                        </div>
                        {view.reconciliationStatus && (
                            <div>
                                <p className="text-xs text-text-muted font-body mb-1">Reconciliation</p>
                                <StatusBadge status={view.reconciliationStatus} />
                            </div>
                        )}
                        {view.providerStatus && (
                            <div>
                                <p className="text-xs text-text-muted font-body mb-1">Provider status</p>
                                <p className="text-text-primary font-body">{view.providerStatus}</p>
                            </div>
                        )}
                        <div>
                            <p className="text-xs text-text-muted font-body mb-1">Intent recorded</p>
                            <p className="text-text-primary font-body">{formatDateTime(view.settlement.intentRecordedAt)}</p>
                        </div>
                        <div>
                            <p className="text-xs text-text-muted font-body mb-1">Executed</p>
                            <p className="text-text-primary font-body">{view.settlement.executedAt ? formatDateTime(view.settlement.executedAt) : '—'}</p>
                        </div>
                    </div>

                    {view.settlement.providerRef && <HashDisplay hash={view.settlement.providerRef} label="provider reference" />}
                    {view.settlement.settlementRefHash && <HashDisplay hash={view.settlement.settlementRefHash} label="settlementRef (on-chain)" />}

                    {view.onChain && (
                        <p className="text-xs text-text-muted font-body">
                            On-chain: {view.onChain.status} / {view.onChain.outcome}
                        </p>
                    )}
                    {view.settlement.attempts > 0 && (
                        <p className="text-xs text-text-muted font-body">{view.settlement.attempts} attempt{view.settlement.attempts === 1 ? '' : 's'}</p>
                    )}
                    {view.settlement.lastError && <p className="text-xs text-red-400 font-body">{view.settlement.lastError}</p>}
                    {view.chainError && (
                        <div className="flex items-start gap-2 text-xs text-amber-400 font-body bg-amber-500/[0.06] border border-amber-500/20 rounded-md px-3 py-2">
                            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                            <span>On-chain settlement state unavailable: {view.chainError}</span>
                        </div>
                    )}
                </div>
            )}
        </GlassCard>
    )
}
