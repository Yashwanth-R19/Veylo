import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Card from '@/components/shared/Card'
import HashDisplay from '@/components/shared/HashDisplay'
import StatusBadge from '@/components/shared/StatusBadge'
import SignPanel from '@/components/shared/SignPanel'
import LoadingSkeleton from '@/components/shared/LoadingSkeleton'
import { useContract } from '@/hooks/useContract'
import { acceptCriteria, getChainInfo } from '@/lib/api'
import { buildDomain, CRITERIA_ACCEPTANCE_TYPES } from '@/lib/eip712'
import { randomNonce } from '@/lib/utils'
import type { AgreementView, ChainInfo } from '@/types'
import { AlertTriangle, Loader2 } from 'lucide-react'

/**
 * Screen 2 — Sign, in its "worker accepts criteria" mode. Reached from
 * Agreement Detail's "Accept & Sign" action when an agreement is in DRAFT.
 * Not role-gated by app login — per §4, identity here is whoever holds the
 * worker's wallet key, not whoever is logged into the dashboard.
 */
export default function AcceptAgreement() {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const { getAgreement } = useContract()

    const [agreement, setAgreement] = useState<AgreementView | null>(null)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [chainInfo, setChainInfo] = useState<ChainInfo | null>(null)
    const [chainInfoError, setChainInfoError] = useState<string | null>(null)
    const [nonce] = useState(() => randomNonce())
    const [accepting, setAccepting] = useState(false)
    const [acceptError, setAcceptError] = useState<string | null>(null)

    useEffect(() => {
        if (!id) return
        getAgreement(Number(id)).then(setAgreement).catch((err) => setLoadError(err instanceof Error ? err.message : 'Failed to load agreement'))
        getChainInfo().then(setChainInfo).catch((err) => setChainInfoError(err instanceof Error ? err.message : 'Failed to load chain configuration'))
    }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

    const handleSigned = async ({ signature }: { signature: string; signerAddress: string }) => {
        if (!agreement) return
        setAccepting(true)
        setAcceptError(null)
        try {
            await acceptCriteria(agreement.database.id, nonce, signature)
            navigate(`/freelancer/agreement/${agreement.database.id}`)
        } catch (err) {
            setAcceptError(err instanceof Error ? err.message : 'Failed to accept criteria')
        } finally {
            setAccepting(false)
        }
    }

    if (loadError) {
        return (
            <Card className="p-6 flex items-start gap-3 max-w-lg mx-auto">
                <AlertTriangle className="w-5 h-5 text-danger flex-shrink-0 mt-0.5" />
                <p className="text-sm text-danger font-body">{loadError}</p>
            </Card>
        )
    }
    if (!agreement) {
        return <div className="max-w-lg mx-auto"><LoadingSkeleton variant="card" /></div>
    }

    const { database } = agreement
    if (database.status !== 'DRAFT') {
        return (
            <Card className="p-6 max-w-lg mx-auto space-y-2">
                <p className="text-sm text-text-heading font-body">This agreement is not awaiting acceptance.</p>
                <StatusBadge status={database.status} />
            </Card>
        )
    }
    if (database.onChainId === null) {
        return (
            <Card className="p-6 max-w-lg mx-auto">
                <p className="text-sm text-text-muted font-body">Agreement is not yet confirmed on-chain — refresh in a moment.</p>
            </Card>
        )
    }
    if (chainInfoError) {
        return (
            <Card className="p-6 max-w-lg mx-auto">
                <p className="text-sm text-danger font-body">{chainInfoError}</p>
            </Card>
        )
    }
    if (!chainInfo) {
        return <div className="max-w-lg mx-auto"><LoadingSkeleton variant="card" /></div>
    }

    return (
        <div className="max-w-lg mx-auto space-y-4">
            <div>
                <h1 className="font-display font-semibold text-2xl text-text-heading">Accept Criteria</h1>
                <p className="text-sm text-text-muted font-body mt-1">
                    Review the {database.criteriaJson.criteria.length} criteria below, then sign to accept them.
                </p>
            </div>

            <Card className="p-5 space-y-3">
                {database.criteriaJson.criteria.map((c) => (
                    <div key={c.index} className="text-sm">
                        <span className="text-[10px] uppercase tracking-wide text-text-muted font-body mr-2">{c.method}</span>
                        <span className="text-text font-body">{c.text}</span>
                    </div>
                ))}
                <HashDisplay hash={database.criteriaHash} label="criteriaHash" />
            </Card>

            <SignPanel
                heading="Sign to accept these criteria"
                description="This signature is the record that you agreed to build against exactly these criteria. It never touches gas and never moves funds."
                summaryRows={[
                    { label: 'Agreement', value: `#${database.id}` },
                    { label: 'criteriaHash', value: database.criteriaHash },
                ]}
                domain={buildDomain(chainInfo)}
                types={CRITERIA_ACCEPTANCE_TYPES}
                value={{ agreementId: database.onChainId!, criteriaHash: database.criteriaHash, nonce }}
                onSigned={handleSigned}
                disabled={accepting}
            />
            {accepting && (
                <div className="flex items-center gap-2 text-xs text-text-muted font-body">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Recording acceptance…
                </div>
            )}
            {acceptError && <p className="text-xs text-danger font-body">{acceptError}</p>}
        </div>
    )
}
