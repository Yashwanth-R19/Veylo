import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import Card from '@/components/shared/Card'
import HashDisplay from '@/components/shared/HashDisplay'
import StatusBadge from '@/components/shared/StatusBadge'
import AmountDisplay from '@/components/shared/AmountDisplay'
import WalletAddress from '@/components/shared/WalletAddress'
import DeadlineCountdown from '@/components/shared/DeadlineCountdown'
import LoadingSkeleton from '@/components/shared/LoadingSkeleton'
import PipelineStageRow from '@/components/shared/PipelineStageIndicator'
import ChainPanel from '@/components/agreements/ChainPanel'
import VerificationResult from '@/components/agreements/VerificationResult'
import DisputePanel from '@/components/agreements/DisputePanel'
import SettlementPanel from '@/components/agreements/SettlementPanel'
import { useContract } from '@/hooks/useContract'
import { submitEvidence, runVerification, decideAgreement, finalizeAgreement } from '@/lib/api'
import type { AgreementView, AgreementStatus, PipelineStage } from '@/types'
import { AlertTriangle, Loader2, GitBranch } from 'lucide-react'

const BASE_STAGES: { id: AgreementStatus; name: string; description: string }[] = [
    { id: 'DRAFT', name: 'Draft', description: 'Client authored and signed criteria' },
    { id: 'COMMITTED', name: 'Committed', description: 'Worker accepted criteria — work begins' },
    { id: 'SUBMITTED', name: 'Submitted', description: 'Evidence submitted for verification' },
    { id: 'VERIFIED', name: 'Verified', description: 'Deterministic outcome recorded' },
    { id: 'SETTLEMENT_AUTHORIZED', name: 'Settlement Authorized', description: 'Review window closed, outcome final' },
    { id: 'SETTLED', name: 'Settled', description: 'Payment provider executed' },
]

const RANK: Record<AgreementStatus, number> = {
    DRAFT: 0, COMMITTED: 1, SUBMITTED: 2, VERIFIED: 3, NEEDS_REVIEW: 3,
    DISPUTED: 3, RULED: 3, SETTLEMENT_AUTHORIZED: 4, SETTLED: 5, CANCELLED: -1,
}

function buildStages(status: AgreementStatus): PipelineStage[] {
    if (status === 'CANCELLED') {
        return [{ id: 'CANCELLED', name: 'Cancelled', description: 'The client cancelled this agreement while in Draft.', status: 'failed', details: null }]
    }
    const rank = RANK[status]
    return BASE_STAGES.map((s) => {
        const stageRank = RANK[s.id]
        // A branch state (NEEDS_REVIEW/DISPUTED/RULED) replaces the VERIFIED
        // stage's label with what's actually happening, rather than a fake "Verified".
        const isBranchSubstitute = s.id === 'VERIFIED' && ['NEEDS_REVIEW', 'DISPUTED', 'RULED'].includes(status)
        const label = isBranchSubstitute ? { name: status.replace(/_/g, ' '), description: 'Outcome not automatable — routed for review.' } : s
        let pipelineStatus: PipelineStage['status'] = 'pending'
        if (stageRank < rank) pipelineStatus = 'complete'
        else if (stageRank === rank) pipelineStatus = isBranchSubstitute ? 'running' : (rank === 5 ? 'complete' : 'running')
        return { id: s.id, name: label.name, description: label.description, status: pipelineStatus, details: null }
    })
}

export default function AgreementDetail() {
    const { id } = useParams<{ id: string }>()
    const { getAgreement } = useContract()
    const [agreement, setAgreement] = useState<AgreementView | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [actionBusy, setActionBusy] = useState(false)
    const [actionError, setActionError] = useState<string | null>(null)
    const [repoUrl, setRepoUrl] = useState('')
    const [commitHash, setCommitHash] = useState('')

    const load = useCallback(() => {
        if (!id) return
        getAgreement(Number(id)).then(setAgreement).catch((err) => setError(err instanceof Error ? err.message : 'Failed to load agreement'))
    }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => { load() }, [load])

    if (error) {
        return (
            <Card className="p-6 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-danger flex-shrink-0 mt-0.5" />
                <p className="text-sm text-danger font-body">{error}</p>
            </Card>
        )
    }
    if (!agreement) return <LoadingSkeleton variant="card" count={3} />

    const { database, onChain, inSync, chainError } = agreement
    const stages = buildStages(database.status)

    const runAction = async (fn: () => Promise<unknown>) => {
        setActionBusy(true)
        setActionError(null)
        try {
            await fn()
            load()
        } catch (err) {
            setActionError(err instanceof Error ? err.message : 'Action failed')
        } finally {
            setActionBusy(false)
        }
    }

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            {/* Header */}
            <Card className="p-6 space-y-4">
                <div className="flex items-start justify-between">
                    <div>
                        <h1 className="font-display font-semibold text-2xl text-text-heading">Agreement #{database.id}</h1>
                        <div className="flex items-center gap-3 mt-2">
                            <StatusBadge status={database.status} />
                            {database.outcome !== 'NONE' && <StatusBadge status={database.outcome} />}
                        </div>
                    </div>
                    <AmountDisplay amount={Number(database.amountMinor) / 100} currency={database.currency} size="lg" />
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                        <p className="text-xs text-text-muted font-body mb-1">Client</p>
                        {onChain ? <WalletAddress address={onChain.client} /> : <span className="text-text-muted">—</span>}
                    </div>
                    <div>
                        <p className="text-xs text-text-muted font-body mb-1">Worker</p>
                        {onChain ? <WalletAddress address={onChain.worker} /> : <span className="text-text-muted">—</span>}
                    </div>
                </div>

                <div>
                    <p className="text-xs text-text-muted font-body mb-1">criteriaHash — see Chain Panel below for its transaction</p>
                    <HashDisplay hash={database.criteriaHash} />
                    <p className="text-[11px] text-text-muted font-body mt-1">Once signed, neither party can change these.</p>
                </div>

                {database.reviewWindowEnds && ['VERIFIED', 'NEEDS_REVIEW'].includes(database.status) && (
                    <div>
                        <p className="text-xs text-text-muted font-body mb-1">Review window</p>
                        <DeadlineCountdown deadline={database.reviewWindowEnds} />
                    </div>
                )}

                {chainError && (
                    <div className="flex items-start gap-2 text-xs text-warning font-body bg-warning-bg border border-warning/30 rounded-md px-3 py-2">
                        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                        <span>Chain state unavailable: {chainError}</span>
                    </div>
                )}
                {onChain && !inSync && !chainError && (
                    <div className="flex items-start gap-2 text-xs text-danger font-body bg-danger-bg border border-danger/30 rounded-md px-3 py-2">
                        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                        <span>Database and chain disagree — database says {database.status}/{database.outcome}, chain says {onChain.status}/{onChain.outcome}.</span>
                    </div>
                )}
            </Card>

            {/* Progress trail */}
            <Card className="p-6">
                <h2 className="font-display font-semibold text-sm text-text-heading flex items-center gap-2 mb-4">
                    <GitBranch className="w-4 h-4 text-accent" /> Progress
                </h2>
                {stages.map((s, i) => (
                    <PipelineStageRow key={s.id} stage={s} isActive={s.status === 'running'} isLast={i === stages.length - 1} index={i} />
                ))}
            </Card>

            {/* Actions per current state */}
            <Card className="p-6 space-y-3">
                <h2 className="font-display font-semibold text-sm text-text-heading">Actions</h2>
                {actionError && <p className="text-xs text-danger font-body">{actionError}</p>}

                {database.status === 'DRAFT' && (
                    <div className="space-y-2">
                        <p className="text-xs text-text-muted font-body">Awaiting the worker's signature to accept these criteria.</p>
                        <Link to={`/agreements/${database.id}/accept`} className="inline-block px-4 py-2 rounded-md bg-accent hover:bg-accent-strong text-accent-contrast text-sm font-medium transition-colors">
                            Accept & Sign (worker)
                        </Link>
                    </div>
                )}

                {database.status === 'COMMITTED' && (
                    <div className="space-y-2 max-w-md">
                        <p className="text-xs text-text-muted font-body">Submit the deliverable's repository and commit for verification.</p>
                        <input className="input-field w-full" placeholder="https://github.com/…" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} />
                        <input className="input-field w-full" placeholder="commit hash" value={commitHash} onChange={(e) => setCommitHash(e.target.value)} />
                        <button
                            disabled={actionBusy || !repoUrl.trim() || !commitHash.trim()}
                            onClick={() => runAction(() => submitEvidence(database.id, repoUrl.trim(), commitHash.trim()))}
                            className="flex items-center gap-2 px-4 py-2 rounded-md bg-accent hover:bg-accent-strong disabled:opacity-50 text-accent-contrast text-sm font-medium transition-colors"
                        >
                            {actionBusy && <Loader2 className="w-4 h-4 animate-spin" />} Submit Evidence
                        </button>
                    </div>
                )}

                {database.status === 'SUBMITTED' && (
                    <div className="space-y-2">
                        <p className="text-xs text-text-muted font-body">Run the deterministic engine and the advisory layer against the submitted evidence.</p>
                        <button
                            disabled={actionBusy}
                            onClick={() => runAction(() => runVerification(database.id))}
                            className="flex items-center gap-2 px-4 py-2 rounded-md bg-accent hover:bg-accent-strong disabled:opacity-50 text-accent-contrast text-sm font-medium transition-colors"
                        >
                            {actionBusy && <Loader2 className="w-4 h-4 animate-spin" />} Run Verification
                        </button>
                    </div>
                )}

                {database.status === 'NEEDS_REVIEW' && (
                    <div className="space-y-2">
                        <p className="text-xs text-text-muted font-body">Outcome was not automatable — the client decides, within the review window.</p>
                        <div className="flex gap-2">
                            <button disabled={actionBusy} onClick={() => runAction(() => decideAgreement(database.id, 'ACCEPT'))} className="px-4 py-2 rounded-md bg-success hover:brightness-110 disabled:opacity-50 text-accent-contrast text-sm font-medium transition-colors">Accept</button>
                            <button disabled={actionBusy} onClick={() => runAction(() => decideAgreement(database.id, 'REJECT'))} className="px-4 py-2 rounded-md bg-danger hover:brightness-110 disabled:opacity-50 text-accent-contrast text-sm font-medium transition-colors">Reject</button>
                        </div>
                    </div>
                )}

                {database.status === 'VERIFIED' && (
                    <div className="space-y-2">
                        <p className="text-xs text-text-muted font-body">
                            Either party may dispute within the review window (below). After the window closes,
                            finalize to authorize settlement.
                        </p>
                        <button
                            disabled={actionBusy || (!!database.reviewWindowEnds && new Date(database.reviewWindowEnds).getTime() > Date.now())}
                            onClick={() => runAction(() => finalizeAgreement(database.id))}
                            className="flex items-center gap-2 px-4 py-2 rounded-md bg-accent hover:bg-accent-strong disabled:opacity-50 text-accent-contrast text-sm font-medium transition-colors"
                        >
                            {actionBusy && <Loader2 className="w-4 h-4 animate-spin" />} Finalize
                        </button>
                    </div>
                )}

                {database.status === 'RULED' && (
                    <div className="space-y-2">
                        <p className="text-xs text-text-muted font-body">Ruled — finalize to authorize settlement (no window wait after a ruling).</p>
                        <button
                            disabled={actionBusy}
                            onClick={() => runAction(() => finalizeAgreement(database.id))}
                            className="flex items-center gap-2 px-4 py-2 rounded-md bg-accent hover:bg-accent-strong disabled:opacity-50 text-accent-contrast text-sm font-medium transition-colors"
                        >
                            {actionBusy && <Loader2 className="w-4 h-4 animate-spin" />} Finalize
                        </button>
                    </div>
                )}

                {database.status === 'CANCELLED' && (
                    <p className="text-xs text-text-muted font-body">This agreement was cancelled while in Draft.</p>
                )}
            </Card>

            {/* Dispute — visible once an outcome exists; raising is only enabled from VERIFIED/NEEDS_REVIEW, within the window */}
            {['VERIFIED', 'NEEDS_REVIEW', 'DISPUTED', 'RULED', 'SETTLEMENT_AUTHORIZED', 'SETTLED'].includes(database.status) && (
                <DisputePanel
                    agreementId={database.id}
                    canRaise={
                        ['VERIFIED', 'NEEDS_REVIEW'].includes(database.status) &&
                        (!database.reviewWindowEnds || new Date(database.reviewWindowEnds).getTime() > Date.now())
                    }
                />
            )}

            {/* Settlement — only once finalize has authorized it */}
            {['SETTLEMENT_AUTHORIZED', 'SETTLED'].includes(database.status) && (
                <SettlementPanel agreementId={database.id} />
            )}

            {/* Verification result + reproducibility */}
            <VerificationResult agreementId={database.id} />

            {/* Chain panel */}
            <ChainPanel agreementId={database.id} />
        </div>
    )
}
