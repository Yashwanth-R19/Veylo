import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import GlassCard from '@/components/shared/GlassCard'
import StatusBadge from '@/components/shared/StatusBadge'
import AmountDisplay from '@/components/shared/AmountDisplay'
import DeadlineCountdown from '@/components/shared/DeadlineCountdown'
import EmptyState from '@/components/shared/EmptyState'
import LoadingSkeleton from '@/components/shared/LoadingSkeleton'
import AnimatedList from '@/components/ui/AnimatedList'
import { useContract } from '@/hooks/useContract'
import type { AgreementRecord } from '@/types'
import { FileText, AlertTriangle } from 'lucide-react'

/**
 * Lists every agreement, same as the client view — see client/Dashboard.tsx
 * for why there's no "mine only" filter (identity here is a wallet
 * signature, not the app login).
 */
export default function FreelancerDashboard() {
    const [agreements, setAgreements] = useState<AgreementRecord[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    const navigate = useNavigate()
    const { listAgreements } = useContract()

    useEffect(() => {
        listAgreements().then(setAgreements).catch((err) => setError(err instanceof Error ? err.message : 'Failed to load agreements'))
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div>
            <div className="mb-8">
                <h1 className="font-display font-bold text-2xl text-text-primary">Agreements</h1>
                <p className="text-sm text-text-muted font-body mt-1">Every agreement on this instance. Open a Draft one to accept its criteria.</p>
            </div>

            {error && (
                <div className="flex items-start gap-2 text-sm text-red-400 font-body mb-4">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
                </div>
            )}

            {agreements === null && !error && <LoadingSkeleton variant="card" count={4} />}

            {agreements !== null && agreements.length === 0 && (
                <EmptyState icon={FileText} title="No agreements yet" description="Ask a client to author criteria naming your wallet address as the worker." />
            )}

            {agreements !== null && agreements.length > 0 && (
                <GlassCard className="divide-y divide-white/[0.06]">
                    <AnimatedList stagger={0.05}>
                        {agreements.map((a) => (
                            <button
                                key={a.id}
                                onClick={() => navigate(`/freelancer/agreement/${a.id}`)}
                                className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/[0.02] transition-colors text-left"
                            >
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium text-text-primary">Agreement #{a.id}</p>
                                    <p className="text-xs text-text-muted font-body mt-0.5">{a.criteriaJson.criteria.length} criteria</p>
                                </div>
                                <div className="flex items-center gap-4 ml-4">
                                    <AmountDisplay amount={Number(a.amountMinor) / 100} currency={a.currency} size="sm" />
                                    <DeadlineCountdown deadline={a.deadline} />
                                    <StatusBadge status={a.status} />
                                </div>
                            </button>
                        ))}
                    </AnimatedList>
                </GlassCard>
            )}
        </div>
    )
}
