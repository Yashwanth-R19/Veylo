import { useState, useEffect } from 'react'
import Card from '@/components/shared/Card'
import HashDisplay from '@/components/shared/HashDisplay'
import LoadingSkeleton from '@/components/shared/LoadingSkeleton'
import { getOutboxEntries, getChainInfo } from '@/lib/api'
import { formatDateTime } from '@/lib/utils'
import type { OutboxEntry, ChainInfo } from '@/types'
import { Link2, AlertTriangle } from 'lucide-react'

const ACTION_LABELS: Record<string, string> = {
    CREATE_AGREEMENT: 'Create agreement',
    ACCEPT_CRITERIA: 'Accept criteria',
    SUBMIT_EVIDENCE: 'Submit evidence',
    RECORD_VERIFICATION: 'Record verification',
    CLIENT_DECISION: 'Client decision',
    RAISE_DISPUTE: 'Raise dispute',
    GIVE_RULING: 'Give ruling',
    FINALIZE: 'Finalize',
    CONFIRM_SETTLEMENT: 'Confirm settlement',
}

/**
 * Screen 8 — Chain panel (VEYLO_BUILD_PLAN_REVISED.md Phase 5, Session 1,
 * Part A): every on-chain write for this agreement, sourced from the outbox
 * (the actual consistency layer, not a guess) via GET /api/outbox/agreement/:id.
 */
export default function ChainPanel({ agreementId }: { agreementId: number }) {
    const [entries, setEntries] = useState<OutboxEntry[] | null>(null)
    const [chainInfo, setChainInfo] = useState<ChainInfo | null>(null)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        Promise.all([getOutboxEntries(agreementId), getChainInfo()])
            .then(([e, c]) => { setEntries(e); setChainInfo(c) })
            .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load chain transactions'))
    }, [agreementId])

    return (
        <Card className="p-6 space-y-4">
            <h2 className="font-display font-semibold text-sm text-text-heading flex items-center gap-2">
                <Link2 className="w-4 h-4 text-accent" /> Chain Panel
            </h2>

            {error && (
                <div className="flex items-start gap-2 text-xs text-danger font-body">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <span>{error}</span>
                </div>
            )}
            {!error && entries === null && <LoadingSkeleton variant="line" count={3} />}
            {!error && entries !== null && entries.length === 0 && (
                <p className="text-xs text-text-muted font-body">No transactions yet.</p>
            )}
            {!error && entries !== null && entries.length > 0 && (
                <div className="space-y-3">
                    {entries.map((e) => (
                        <div key={e.id} className="rounded-md border border-border p-3 space-y-1.5">
                            <div className="flex items-center justify-between">
                                <span className="text-sm text-text-heading font-body font-medium">{ACTION_LABELS[e.action] || e.action}</span>
                                <span className="text-[10px] uppercase tracking-wide text-text-muted font-body">{e.status}</span>
                            </div>
                            {e.txHash ? (
                                <HashDisplay
                                    hash={e.txHash}
                                    label="tx"
                                    explorerUrl={chainInfo?.blockExplorerBase ? `${chainInfo.blockExplorerBase}/tx` : undefined}
                                />
                            ) : (
                                <p className="text-xs text-text-muted font-body">No transaction submitted yet{e.attempts > 0 ? ` (${e.attempts} attempt${e.attempts === 1 ? '' : 's'})` : ''}.</p>
                            )}
                            <div className="flex items-center gap-4 text-[11px] text-text-muted font-body">
                                {e.blockNumber !== null && <span>Block {e.blockNumber}</span>}
                                <span>{e.confirmations} confirmation{e.confirmations === 1 ? '' : 's'}</span>
                                <span>{formatDateTime(e.createdAt)}</span>
                            </div>
                            {e.lastError && <p className="text-[11px] text-danger font-body">{e.lastError}</p>}
                        </div>
                    ))}
                </div>
            )}
        </Card>
    )
}
