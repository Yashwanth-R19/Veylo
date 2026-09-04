import { useState, useEffect } from 'react'
import Card from '@/components/shared/Card'
import HashDisplay from '@/components/shared/HashDisplay'
import StatusBadge from '@/components/shared/StatusBadge'
import LoadingSkeleton from '@/components/shared/LoadingSkeleton'
import { getVerificationBundle } from '@/lib/api'
import { copyToClipboard } from '@/lib/utils'
import type { VerificationBundle } from '@/types'
import { CheckCircle2, Sparkles, Terminal, Copy, Check, AlertTriangle } from 'lucide-react'

/**
 * Screens 4 (Verification Result) and 5 (Reproducibility panel).
 * DETERMINISTIC and ADVISORY are rendered as visually separate sections —
 * the divider and the copy under ADVISORY exist specifically so a reader
 * cannot mistake an AI verdict for something that decided the outcome.
 */
export default function VerificationResult({ agreementId }: { agreementId: number }) {
    const [bundle, setBundle] = useState<VerificationBundle | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [copied, setCopied] = useState(false)

    useEffect(() => {
        getVerificationBundle(agreementId)
            .then(setBundle)
            .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load verification results'))
    }, [agreementId])

    if (error) {
        return (
            <Card className="p-6 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-danger flex-shrink-0 mt-0.5" />
                <p className="text-sm text-danger font-body">{error}</p>
            </Card>
        )
    }
    if (!bundle) return <LoadingSkeleton variant="card" count={2} />

    const criteriaByIndex = new Map(bundle.criteriaDocument.criteria.map((c) => [c.index, c]))
    const doc = bundle.resultsDocument

    if (!doc) {
        return (
            <Card className="p-6">
                <p className="text-sm text-text-muted font-body">Verification has not run yet for this agreement.</p>
            </Card>
        )
    }

    // API_BASE_URL ('/api', see lib/constants.ts) is same-origin-relative, so
    // the backend this page is actually talking to is reachable at this
    // page's own origin — that's the correct --base-url for tools/verify.js,
    // not a guessed separate API subdomain.
    const verifyCommand = `node tools/verify.js --base-url ${window.location.origin} --agreement ${agreementId}`

    const handleCopy = async () => {
        await copyToClipboard(verifyCommand)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
    }

    return (
        <div className="space-y-6">
            {/* Deterministic */}
            <Card className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="font-display font-semibold text-sm text-text-heading flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-success" /> Deterministic
                    </h2>
                    <span className="text-[10px] text-text-muted font-body uppercase tracking-wide">Decides the outcome</span>
                </div>
                <p className="text-xs text-text-muted font-body">
                    Engine {doc.deterministic.engineVersion} · outcome {doc.deterministic.outcome}
                </p>
                <div className="space-y-2">
                    {doc.deterministic.results.map((r) => (
                        <div key={r.index} className="rounded-md border border-border p-3 space-y-1.5">
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-xs text-text font-body">{criteriaByIndex.get(r.index)?.text || `Criterion ${r.index}`}</span>
                                <StatusBadge status={r.status} />
                            </div>
                            <p className="text-xs text-text-muted font-body">{r.detail}</p>
                            {r.evidenceRefs.length > 0 && (
                                <p className="text-[11px] font-mono text-text-muted">{r.evidenceRefs.join(', ')}</p>
                            )}
                        </div>
                    ))}
                </div>
            </Card>

            <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-border" />
                <span className="text-[10px] uppercase tracking-widest text-text-muted font-body">Advisory below — does not affect the outcome</span>
                <div className="flex-1 h-px bg-border" />
            </div>

            {/* Advisory */}
            <Card className="p-6 space-y-4 border-dashed">
                <div className="flex items-center justify-between">
                    <h2 className="font-display font-semibold text-sm text-text-heading flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-accent" /> Advisory (AI)
                    </h2>
                    <span className="text-[10px] text-text-muted font-body uppercase tracking-wide">Evidence only, no vote</span>
                </div>
                <p className="text-xs text-warning font-body bg-warning-bg border border-warning/30 rounded-md px-3 py-2">
                    These results are advisory. They can inform a human reviewer during NEEDS_REVIEW, but they never
                    determine ACCEPT or REJECT on their own.
                </p>
                {doc.advisory.provider && <p className="text-xs text-text-muted font-body">Provider: {doc.advisory.provider}</p>}
                {doc.advisory.results.length === 0 ? (
                    <p className="text-xs text-text-muted font-body">No semantic criteria required advisory evaluation.</p>
                ) : (
                    <div className="space-y-2">
                        {doc.advisory.results.map((r) => (
                            <div key={r.index} className="rounded-md border border-border p-3 space-y-1.5">
                                <div className="flex items-center justify-between gap-3">
                                    <span className="text-xs text-text font-body">{criteriaByIndex.get(r.index)?.text || `Criterion ${r.index}`}</span>
                                    <div className="flex items-center gap-2">
                                        <span className="text-[11px] font-mono text-text-muted">{(r.confidence * 100).toFixed(0)}%</span>
                                        <StatusBadge status={r.status} />
                                    </div>
                                </div>
                                <p className="text-xs text-text-muted font-body">{r.explanation}</p>
                                {r.evidenceRefs.length > 0 && (
                                    <p className="text-[11px] font-mono text-text-muted">{r.evidenceRefs.join(', ')}</p>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </Card>

            {/* Reproducibility panel */}
            <Card className="p-6 space-y-3">
                <h2 className="font-display font-semibold text-sm text-text-heading flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-accent" /> Reproducibility
                </h2>
                <p className="text-xs text-text-muted font-body">
                    deterministicHash covers only the deterministic section above and is the value claimed reproducible —
                    the same commit, evaluated against the same criteria, always produces this exact hash.
                </p>
                {bundle.deterministicHash && <HashDisplay hash={bundle.deterministicHash} label="deterministicHash" />}
                <div className="relative">
                    <pre className="text-[11px] font-mono text-text bg-bg-subtle border border-border rounded-md p-3 overflow-x-auto pr-10">{verifyCommand}</pre>
                    <button onClick={handleCopy} className="absolute top-2 right-2 text-text-muted hover:text-text transition-colors">
                        {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                </div>
                <p className="text-[11px] text-text-muted font-body">
                    tools/verify.js is standalone — it reimplements the hashing and signature verification itself
                    rather than importing this codebase, so a passing run proves something independent.
                </p>
            </Card>
        </div>
    )
}
