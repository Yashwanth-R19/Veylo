import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Card from '@/components/shared/Card'
import StatusBadge from '@/components/shared/StatusBadge'
import AmountDisplay from '@/components/shared/AmountDisplay'
import DeadlineCountdown from '@/components/shared/DeadlineCountdown'
import EmptyState from '@/components/shared/EmptyState'
import LoadingSkeleton from '@/components/shared/LoadingSkeleton'
import AnimatedList from '@/components/ui/AnimatedList'
import { useContract } from '@/hooks/useContract'
import type { AgreementRecord } from '@/types'
import { PlusCircle, FileText, AlertTriangle } from 'lucide-react'

/**
 * Lists every agreement (GET /agreements has no per-user filter — client and
 * worker identity is a wallet signature, not the app login, so there is no
 * reliable "mine" filter without a second wallet-linking step this session
 * doesn't add). A stranger with the URL can browse the same list — that's
 * consistent with Phase 5's acceptance criterion that a stranger can view
 * and independently verify an agreement.
 */
export default function ClientDashboard() {
    const [agreements, setAgreements] = useState<AgreementRecord[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    const navigate = useNavigate()
    const { listAgreements } = useContract()

    useEffect(() => {
        listAgreements().then(setAgreements).catch((err) => setError(err instanceof Error ? err.message : 'Failed to load agreements'))
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div>
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="font-display font-semibold text-2xl text-text-heading">Agreements</h1>
                    <p className="text-sm text-text-muted font-body mt-1">Every agreement on this instance.</p>
                </div>
                <button
                    onClick={() => navigate('/client/create')}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-md bg-accent hover:bg-accent-strong text-accent-contrast text-sm font-medium transition-colors"
                >
                    <PlusCircle className="w-4 h-4" /> Author Criteria
                </button>
            </div>

            {error && (
                <div className="flex items-start gap-2 text-sm text-danger font-body mb-4">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
                </div>
            )}

            {agreements === null && !error && <LoadingSkeleton variant="card" count={4} />}

            {agreements !== null && agreements.length === 0 && (
                <EmptyState icon={FileText} title="No agreements yet" description="Author criteria for the first agreement to get started." action={{ label: 'Author Criteria', onClick: () => navigate('/client/create') }} />
            )}

            {agreements !== null && agreements.length > 0 && (
                <Card className="divide-y divide-border">
                    <AnimatedList stagger={0.05}>
                        {agreements.map((a) => (
                            <button
                                key={a.id}
                                onClick={() => navigate(`/client/agreement/${a.id}`)}
                                className="w-full flex items-center justify-between px-5 py-4 hover:bg-bg-subtle transition-colors text-left"
                            >
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium text-text-heading">Agreement #{a.id}</p>
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
                </Card>
            )}
        </div>
    )
}
