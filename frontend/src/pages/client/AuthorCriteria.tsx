import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import GlassCard from '@/components/shared/GlassCard'
import HashDisplay from '@/components/shared/HashDisplay'
import SignPanel from '@/components/shared/SignPanel'
import { draftCriteria, createAgreement, getChainInfo } from '@/lib/api'
import { hashCanonical } from '@/lib/canonical'
import { toCriteriaDocument, isCriterionValid } from '@/lib/criteria'
import { buildDomain, CRITERIA_COMMITMENT_TYPES } from '@/lib/eip712'
import { randomNonce, cn } from '@/lib/utils'
import type { CriterionDraft, CriterionMethod, CheckKind, ChainInfo } from '@/types'
import { Sparkles, Plus, Trash2, AlertTriangle, Loader2, Lock } from 'lucide-react'

const CHECK_KINDS: { value: CheckKind; label: string }[] = [
    { value: 'file_exists', label: 'File exists' },
    { value: 'test_passes', label: 'Specific test passes' },
    { value: 'test_suite_passes', label: 'Full test suite passes' },
    { value: 'http_route', label: 'HTTP route returns status' },
    { value: 'lint_clean', label: 'Lint clean' },
]

function defaultCheckFor(kind: CheckKind): CriterionDraft['check'] {
    switch (kind) {
        case 'file_exists': return { kind, path: '' }
        case 'test_passes': return { kind, testId: '' }
        case 'test_suite_passes': return { kind }
        case 'http_route': return { kind, method: 'GET', route: '', expectStatus: 200 }
        case 'lint_clean': return { kind, maxErrors: 0 }
    }
}

function CheckSpecFields({ criterion, onChange }: { criterion: CriterionDraft; onChange: (check: CriterionDraft['check']) => void }) {
    const check = criterion.check
    if (!check) return null
    const kind = check.kind

    if (kind === 'file_exists') {
        return (
            <input
                className="input-field"
                placeholder="path/to/file.ext"
                value={(check.path as string) || ''}
                onChange={(e) => onChange({ ...check, path: e.target.value })}
            />
        )
    }
    if (kind === 'test_passes') {
        return (
            <input
                className="input-field"
                placeholder="tests/test_auth.py::test_reset"
                value={(check.testId as string) || ''}
                onChange={(e) => onChange({ ...check, testId: e.target.value })}
            />
        )
    }
    if (kind === 'http_route') {
        return (
            <div className="flex gap-2">
                <select
                    className="input-field w-24"
                    value={(check.method as string) || 'GET'}
                    onChange={(e) => onChange({ ...check, method: e.target.value })}
                >
                    {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <input
                    className="input-field flex-1"
                    placeholder="/auth/reset"
                    value={(check.route as string) || ''}
                    onChange={(e) => onChange({ ...check, route: e.target.value })}
                />
                <input
                    type="number"
                    className="input-field w-24"
                    placeholder="200"
                    value={(check.expectStatus as number) ?? ''}
                    onChange={(e) => onChange({ ...check, expectStatus: parseInt(e.target.value, 10) })}
                />
            </div>
        )
    }
    if (kind === 'lint_clean') {
        return (
            <input
                type="number"
                className="input-field w-32"
                placeholder="max errors (0)"
                value={(check.maxErrors as number) ?? ''}
                onChange={(e) => onChange({ ...check, maxErrors: parseInt(e.target.value, 10) })}
            />
        )
    }
    return null
}

/**
 * Screen 1 — Author Criteria (VEYLO_BUILD_PLAN_REVISED.md Phase 5, Session 1,
 * Part A). Step "build" authors the criteria list; step "sign" is screen 2 —
 * shows exactly what's being signed and requests the client's EIP-712
 * signature. The two are folded into one page as a wizard rather than
 * separate routes so the drafted-but-unsigned criteria never need to survive
 * a navigation (they exist only in memory until the client signs).
 */
export default function AuthorCriteria() {
    const navigate = useNavigate()
    const [step, setStep] = useState<'build' | 'sign'>('build')

    const [workerAddress, setWorkerAddress] = useState('')
    const [amount, setAmount] = useState('')
    const [currency, setCurrency] = useState('INR')
    const [deadline, setDeadline] = useState('')

    const [criteria, setCriteria] = useState<CriterionDraft[]>([])
    const [draftDescription, setDraftDescription] = useState('')
    const [drafting, setDrafting] = useState(false)
    const [draftError, setDraftError] = useState<string | null>(null)

    const [chainInfo, setChainInfo] = useState<ChainInfo | null>(null)
    const [chainInfoError, setChainInfoError] = useState<string | null>(null)
    const [creating, setCreating] = useState(false)
    const [createError, setCreateError] = useState<string | null>(null)
    const [nonce] = useState(() => randomNonce())

    useEffect(() => {
        getChainInfo().then(setChainInfo).catch((err) =>
            setChainInfoError(err instanceof Error ? err.message : 'Failed to load chain configuration'),
        )
    }, [])

    const criteriaDocument = useMemo(() => toCriteriaDocument(criteria), [criteria])
    const criteriaHash = useMemo(() => {
        if (criteria.length === 0 || !criteria.every(isCriterionValid)) return null
        try {
            return hashCanonical(criteriaDocument)
        } catch {
            return null
        }
    }, [criteriaDocument, criteria])

    const workerValid = /^0x[a-fA-F0-9]{40}$/.test(workerAddress.trim())
    const amountValid = Number(amount) > 0
    const deadlineDate = deadline ? new Date(deadline) : null
    const deadlineValid = !!deadlineDate && deadlineDate.getTime() > Date.now()
    const canContinue = !!criteriaHash && workerValid && amountValid && deadlineValid

    const handleDraft = async () => {
        if (!draftDescription.trim()) return
        setDrafting(true)
        setDraftError(null)
        try {
            const result = await draftCriteria(draftDescription.trim())
            setCriteria((prev) => [...prev, ...result.criteria])
            setDraftDescription('')
        } catch (err) {
            setDraftError(err instanceof Error ? err.message : 'Failed to draft criteria')
        } finally {
            setDrafting(false)
        }
    }

    const addBlankCriterion = () => {
        setCriteria((prev) => [...prev, { index: prev.length, method: 'DETERMINISTIC', text: '', check: defaultCheckFor('file_exists') }])
    }

    const updateCriterion = (i: number, patch: Partial<CriterionDraft>) => {
        setCriteria((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))
    }
    const removeCriterion = (i: number) => setCriteria((prev) => prev.filter((_, idx) => idx !== i))
    const setMethod = (i: number, method: CriterionMethod) => {
        updateCriterion(i, { method, check: method === 'DETERMINISTIC' ? defaultCheckFor('file_exists') : undefined })
    }
    const setCheckKind = (i: number, kind: CheckKind) => updateCriterion(i, { check: defaultCheckFor(kind) })

    const amountMinorStr = () => Math.round(Number(amount) * 100).toString()
    const deadlineUnix = () => Math.floor((deadlineDate as Date).getTime() / 1000)

    const handleSigned = async ({ signature }: { signature: string; signerAddress: string }) => {
        setCreating(true)
        setCreateError(null)
        try {
            const { agreement } = await createAgreement({
                workerAddress: workerAddress.trim(),
                amountMinor: amountMinorStr(),
                currency,
                criteria: criteriaDocument.criteria,
                deadline: deadlineUnix(),
                nonce,
                clientSig: signature,
            })
            navigate(`/client/agreement/${agreement.id}`)
        } catch (err) {
            setCreateError(err instanceof Error ? err.message : 'Failed to create agreement')
        } finally {
            setCreating(false)
        }
    }

    if (step === 'sign') {
        if (chainInfoError) {
            return (
                <GlassCard className="p-6 flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                    <div>
                        <h3 className="font-display font-semibold text-text-primary text-sm mb-1">Could not load chain configuration</h3>
                        <p className="text-xs text-text-muted font-body">{chainInfoError}</p>
                    </div>
                </GlassCard>
            )
        }
        if (!chainInfo) {
            return <GlassCard className="p-6 text-sm text-text-muted font-body">Loading chain configuration…</GlassCard>
        }
        return (
            <div className="max-w-lg mx-auto space-y-4">
                <button onClick={() => setStep('build')} className="text-xs text-text-muted hover:text-text-secondary font-body">&larr; Back to criteria</button>
                <SignPanel
                    heading="Sign to create this agreement"
                    description="This signature is the record that you agreed to these exact criteria and terms. It never touches gas and never moves funds."
                    summaryRows={[
                        { label: 'Worker', value: workerAddress },
                        { label: 'Amount', value: `${amount} ${currency}` },
                        { label: 'Deadline', value: deadlineDate ? deadlineDate.toLocaleString() : '' },
                        { label: 'Criteria', value: `${criteria.length}` },
                        { label: 'criteriaHash', value: criteriaHash || '' },
                    ]}
                    domain={buildDomain(chainInfo)}
                    types={CRITERIA_COMMITMENT_TYPES}
                    value={{ worker: workerAddress.trim(), amountMinor: amountMinorStr(), criteriaHash: criteriaHash!, deadline: deadlineUnix(), nonce }}
                    onSigned={handleSigned}
                    disabled={creating}
                />
                {creating && (
                    <div className="flex items-center gap-2 text-xs text-text-muted font-body">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Creating agreement…
                    </div>
                )}
                {createError && <p className="text-xs text-red-400 font-body">{createError}</p>}
            </div>
        )
    }

    return (
        <div className="max-w-3xl mx-auto space-y-6">
            <div>
                <h1 className="font-display font-bold text-2xl text-text-primary">Author Criteria</h1>
                <p className="text-sm text-text-muted font-body mt-1">Define exactly what acceptance means before any work begins.</p>
            </div>

            {/* Terms */}
            <GlassCard className="p-6 space-y-4">
                <h2 className="font-display font-semibold text-sm text-text-primary">Terms</h2>
                <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                        <label className="text-xs text-text-muted font-body block mb-1">Worker wallet address</label>
                        <input className="input-field w-full" placeholder="0x…" value={workerAddress} onChange={(e) => setWorkerAddress(e.target.value)} />
                        {workerAddress && !workerValid && <p className="text-xs text-red-400 mt-1 font-body">Not a valid address</p>}
                    </div>
                    <div>
                        <label className="text-xs text-text-muted font-body block mb-1">Amount</label>
                        <input type="number" min="0" className="input-field w-full" value={amount} onChange={(e) => setAmount(e.target.value)} />
                    </div>
                    <div>
                        <label className="text-xs text-text-muted font-body block mb-1">Currency</label>
                        <input className="input-field w-full" value={currency} onChange={(e) => setCurrency(e.target.value)} />
                    </div>
                    <div className="col-span-2">
                        <label className="text-xs text-text-muted font-body block mb-1">Submission deadline</label>
                        <input type="datetime-local" className="input-field w-full" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
                        {deadline && !deadlineValid && <p className="text-xs text-red-400 mt-1 font-body">Must be in the future</p>}
                    </div>
                </div>
            </GlassCard>

            {/* AI drafting assistant */}
            <GlassCard className="p-6 space-y-3">
                <h2 className="font-display font-semibold text-sm text-text-primary flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-violet-400" /> AI drafting assistant
                </h2>
                <p className="text-xs text-text-muted font-body">
                    Describe the deliverable in plain language. The assistant proposes criteria and flags ambiguous ones —
                    you edit and approve everything before it's ever signed.
                </p>
                <textarea
                    className="input-field w-full min-h-[80px]"
                    placeholder="e.g. A REST API with a password reset endpoint that hashes passwords before storing them…"
                    value={draftDescription}
                    onChange={(e) => setDraftDescription(e.target.value)}
                />
                <button
                    onClick={handleDraft}
                    disabled={drafting || !draftDescription.trim()}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white text-sm font-medium transition-colors"
                >
                    {drafting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    {drafting ? 'Drafting…' : 'Draft with AI'}
                </button>
                {draftError && <p className="text-xs text-red-400 font-body">{draftError}</p>}
            </GlassCard>

            {/* Criteria list */}
            <GlassCard className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="font-display font-semibold text-sm text-text-primary">Criteria ({criteria.length})</h2>
                    <button onClick={addBlankCriterion} className="flex items-center gap-1.5 text-xs text-violet-400 hover:text-violet-300 font-body">
                        <Plus className="w-3.5 h-3.5" /> Add criterion
                    </button>
                </div>

                {criteria.length === 0 && (
                    <p className="text-xs text-text-muted font-body py-4 text-center">No criteria yet. Draft with AI or add one manually.</p>
                )}

                <div className="space-y-3">
                    {criteria.map((c, i) => (
                        <div key={i} className="rounded-lg border border-white/[0.08] p-4 space-y-3">
                            <div className="flex items-start gap-2">
                                <textarea
                                    className="input-field flex-1 min-h-[44px]"
                                    placeholder="Criterion text"
                                    value={c.text}
                                    onChange={(e) => updateCriterion(i, { text: e.target.value })}
                                />
                                <button onClick={() => removeCriterion(i)} className="text-text-muted hover:text-red-400 transition-colors mt-2">
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>

                            <div className="flex items-center gap-3">
                                <div className="flex rounded-lg border border-white/[0.08] overflow-hidden">
                                    {(['DETERMINISTIC', 'SEMANTIC'] as CriterionMethod[]).map((m) => (
                                        <button
                                            key={m}
                                            onClick={() => setMethod(i, m)}
                                            className={cn(
                                                'px-3 py-1.5 text-[11px] font-medium font-body uppercase tracking-wide transition-colors',
                                                c.method === m ? 'bg-violet-600 text-white' : 'text-text-muted hover:text-text-secondary',
                                            )}
                                        >
                                            {m}
                                        </button>
                                    ))}
                                </div>

                                {c.method === 'DETERMINISTIC' && (
                                    <select
                                        className="input-field"
                                        value={c.check?.kind || 'file_exists'}
                                        onChange={(e) => setCheckKind(i, e.target.value as CheckKind)}
                                    >
                                        {CHECK_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                                    </select>
                                )}
                            </div>

                            {c.method === 'DETERMINISTIC' && (
                                <CheckSpecFields criterion={c} onChange={(check) => updateCriterion(i, { check })} />
                            )}

                            {c.ambiguous && (
                                <div className="flex items-start gap-2 text-xs text-amber-400 font-body bg-amber-500/[0.06] border border-amber-500/20 rounded-md px-3 py-2">
                                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                                    <div>
                                        <p className="font-medium">Ambiguity warning</p>
                                        {(c.ambiguityFlags || []).map((f, fi) => <p key={fi}>{f}</p>)}
                                    </div>
                                </div>
                            )}
                            {c.downgradedFromDeterministic && (
                                <p className="text-[11px] text-text-muted font-body">
                                    Downgraded from DETERMINISTIC by the assistant — not reliably machine-checkable.
                                </p>
                            )}
                            {!isCriterionValid(c) && c.text && (
                                <p className="text-[11px] text-red-400 font-body">Incomplete — fill in all required fields for this check.</p>
                            )}
                        </div>
                    ))}
                </div>
            </GlassCard>

            {/* criteriaHash + sign */}
            <GlassCard className="p-6 space-y-3">
                <div className="flex items-center gap-2">
                    <Lock className="w-4 h-4 text-violet-400" />
                    <h2 className="font-display font-semibold text-sm text-text-primary">Commitment</h2>
                </div>
                <p className="text-xs text-text-muted font-body">Once signed, neither party can change these.</p>
                {criteriaHash ? (
                    <HashDisplay hash={criteriaHash} label="criteriaHash" />
                ) : (
                    <p className="text-xs text-text-muted font-body">Complete all fields and at least one valid criterion to compute criteriaHash.</p>
                )}
                <button
                    onClick={() => setStep('sign')}
                    disabled={!canContinue}
                    className="w-full mt-2 px-4 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
                >
                    Continue to Sign
                </button>
            </GlassCard>
        </div>
    )
}
