// ── Agreement lifecycle (§5, §7) ──────────────────────
export type AgreementStatus =
    | 'DRAFT'
    | 'COMMITTED'
    | 'SUBMITTED'
    | 'VERIFIED'
    | 'NEEDS_REVIEW'
    | 'DISPUTED'
    | 'RULED'
    | 'SETTLEMENT_AUTHORIZED'
    | 'SETTLED'
    | 'CANCELLED'

export type Outcome = 'NONE' | 'ACCEPT' | 'REJECT'

export type CriterionMethod = 'DETERMINISTIC' | 'SEMANTIC'

export type CheckKind = 'file_exists' | 'test_passes' | 'test_suite_passes' | 'http_route' | 'lint_clean'

export interface CriterionCheckSpec {
    kind: CheckKind
    [key: string]: unknown
}

/** A criterion as it exists in the §6 criteria document (before or after signing). */
export interface CriterionDraft {
    index: number
    method: CriterionMethod
    text: string
    check?: CriterionCheckSpec
    // Present only on drafts returned by POST /criteria/draft.
    downgradedFromDeterministic?: boolean
    ambiguous?: boolean
    ambiguityFlags?: string[]
}

export interface CriteriaDocument {
    version: number
    criteria: CriterionDraft[]
}

/** GET /agreements and GET /agreements/:id's `database` field. */
export interface AgreementRecord {
    id: number
    onChainId: number | null
    clientId: number
    workerId: number
    title?: string | null
    description?: string | null
    amountMinor: string // BigInt serialized as a decimal string
    currency: string
    criteriaHash: string
    criteriaJson: CriteriaDocument
    clientSignature: string | null
    workerSignature: string | null
    deadline: string
    reviewWindowEnds: string | null
    status: AgreementStatus
    outcome: Outcome
    createdAt: string
}

/** The on-chain Agreement struct, as read directly from VeyloAgreements. */
export interface OnChainAgreement {
    client: string
    worker: string
    amountMinor: string
    criteriaHash: string
    evidenceHash: string
    resultsHash: string
    rulingHash: string
    settlementRef: string
    deadline: number
    reviewWindowEnds: number
    status: string
    outcome: string
    disputeId: string
}

export interface AgreementView {
    database: AgreementRecord
    onChain: OnChainAgreement | null
    inSync: boolean
    chainError: string | null
}

// ── Results document (§6) ──────────────────────────────
export type CriterionResultStatus = 'PASS' | 'FAIL' | 'INCONCLUSIVE'

export interface DeterministicCriterionResult {
    index: number
    status: CriterionResultStatus
    evidenceRefs: string[]
    detail: string
}

export interface AdvisoryCriterionResult {
    index: number
    status: CriterionResultStatus
    confidence: number
    evidenceRefs: string[]
    explanation: string
}

export interface ResultsDocument {
    version: number
    agreementId: number
    criteriaHash: string
    evidenceHash: string
    deterministic: {
        engineVersion: string
        outcome: Outcome
        results: DeterministicCriterionResult[]
    }
    advisory: {
        provider: string | null
        results: AdvisoryCriterionResult[]
    }
}

// ── Verification bundle (GET /verify/:id) ──────────────
export interface VerificationParty {
    address: string | null
    signature: string | null
    /** The nonce used at signing time — decimal string, from the outbox payload that carried it. */
    nonce: string | null
}

export interface VerificationBundle {
    agreementId: number
    onChainId: number | null
    criteriaDocument: CriteriaDocument
    criteriaHash: string
    amountMinor: string
    deadline: number
    client: VerificationParty
    worker: VerificationParty
    evidence: { repoUrl: string; commitHash: string; evidenceHash: string } | null
    resultsDocument: ResultsDocument | null
    resultsHash: string | null
    deterministicHash: string | null
}

// ── Dispute (screen 6) ──────────────────────────────────
export interface DisputeRecord {
    id: number
    reason: string | null
    reasonHash: string | null
    status: string
    externalDisputeId: number | null
    ruling: number | null
    createdAt: string
}

export interface DisputeView {
    dispute: DisputeRecord | null
    arbitratorAddress: string
    onChain: { ruling: number; disputeStatus: string } | null
    chainError: string | null
}

// ── Settlement (screen 7) ────────────────────────────────
export interface SettlementRecord {
    decision: Outcome
    status: string
    attempts: number
    lastError: string | null
    holdRef: string | null
    providerRef: string | null
    settlementRefHash: string | null
    intentRecordedAt: string
    executedAt: string | null
}

export interface SettlementView {
    simulated: true
    provider: string
    settlement: SettlementRecord | null
    onChain?: { status: string; outcome: Outcome; settlementRef: string } | null
    providerStatus?: string | null
    reconciliationStatus?: string
    chainError?: string | null
}

// ── Outbox / chain panel ────────────────────────────────
export interface OutboxEntry {
    id: number
    action: string
    status: string
    attempts: number
    txHash: string | null
    blockNumber: number | null
    confirmations: number
    lastError: string | null
    createdAt: string
}

// ── Chain config ─────────────────────────────────────────
export interface ChainInfo {
    chainId: number
    network: string
    contractAddress: string
    arbitratorAddress: string
    arbitrationCost: string
    blockExplorerBase: string | null
    deployedAt: string
}

// ── Progress trail (reused, generic — no score) ─────────
export type PipelineStageStatus = 'pending' | 'running' | 'complete' | 'failed'

export interface PipelineStage {
    id: string
    name: string
    description: string
    status: PipelineStageStatus
    details: string | null
}

// ── Auth ───────────────────────────────────────────────
export type UserRole = 'client' | 'freelancer' | null

export interface User {
    id: number
    email: string
    name: string | null
    role: UserRole
    walletAddress?: string | null
    oauthProvider: string | null
    createdAt?: string
}

// ── App State ──────────────────────────────────────────
export interface AppState {
    role: UserRole
    user: User | null
}
