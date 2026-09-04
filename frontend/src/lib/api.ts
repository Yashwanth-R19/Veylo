import type {
    User, AgreementRecord, CriterionDraft, VerificationBundle,
    OutboxEntry, ChainInfo, ResultsDocument, Outcome, DisputeView, SettlementView,
} from '@/types'
import { API_BASE_URL } from '@/lib/constants'

// ── Helpers ────────────────────────────────────────
async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${API_BASE_URL}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        ...options,
    })
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error || `API error ${res.status}`)
    }
    return res.json()
}

function normalizeAgreement(raw: Record<string, unknown>): AgreementRecord {
    return raw as unknown as AgreementRecord
}

// ── Chain config ───────────────────────────────────
export async function getChainInfo(): Promise<ChainInfo> {
    return apiFetch<ChainInfo>('/chain-info')
}

// ── Criteria drafting assistant (Phase 3, Part D) ──
export async function draftCriteria(description: string): Promise<{ criteria: CriterionDraft[]; provider: string; tokens: unknown }> {
    return apiFetch('/criteria/draft', {
        method: 'POST',
        body: JSON.stringify({ description }),
    })
}

// ── Agreements ─────────────────────────────────────
export async function createAgreement(data: {
    workerAddress: string
    amountMinor: string
    currency: string
    criteria: CriterionDraft[]
    deadline: number
    nonce: string
    clientSig: string
}): Promise<{ agreement: AgreementRecord; outboxRowId: number }> {
    const raw = await apiFetch<{ agreement: Record<string, unknown>; outboxRowId: number }>('/agreements', {
        method: 'POST',
        body: JSON.stringify(data),
    })
    return { agreement: normalizeAgreement(raw.agreement), outboxRowId: raw.outboxRowId }
}

export async function acceptCriteria(agreementId: number, nonce: string, workerSig: string): Promise<{ outboxRowId: number }> {
    return apiFetch(`/agreements/${agreementId}/accept`, {
        method: 'POST',
        body: JSON.stringify({ nonce, workerSig }),
    })
}

export async function submitEvidence(agreementId: number, repoUrl: string, commitHash: string): Promise<{ outboxRowId: number; evidenceHash: string }> {
    return apiFetch(`/agreements/${agreementId}/evidence`, {
        method: 'POST',
        body: JSON.stringify({ repoUrl, commitHash }),
    })
}

export async function runVerification(agreementId: number): Promise<{
    outboxRowId: number
    resultsHash: string
    deterministicHash: string
    outcome: Outcome
    results: ResultsDocument
    advisoryStats: unknown
}> {
    return apiFetch(`/agreements/${agreementId}/verify`, { method: 'POST' })
}

export async function decideAgreement(agreementId: number, outcome: 'ACCEPT' | 'REJECT'): Promise<{ outboxRowId: number }> {
    return apiFetch(`/agreements/${agreementId}/decide`, {
        method: 'POST',
        body: JSON.stringify({ outcome }),
    })
}

export async function raiseDispute(agreementId: number, party: 'client' | 'worker', reason?: string): Promise<{ outboxRowId: number }> {
    return apiFetch(`/agreements/${agreementId}/dispute`, {
        method: 'POST',
        body: JSON.stringify({ party, reason }),
    })
}

export async function finalizeAgreement(agreementId: number): Promise<{ outboxRowId: number }> {
    return apiFetch(`/agreements/${agreementId}/finalize`, { method: 'POST' })
}

export async function getDispute(agreementId: number): Promise<DisputeView> {
    return apiFetch(`/agreements/${agreementId}/dispute`)
}

export async function getSettlement(agreementId: number): Promise<SettlementView> {
    return apiFetch(`/agreements/${agreementId}/settlement`)
}

// Reading an agreement (DB + on-chain state) goes through the useContract()
// hook (hooks/useContract.ts), not this module — it already fetches
// /agreements and /agreements/:id and returns them typed against the same
// AgreementView shape, and duplicating that here would just be a second
// source of truth for the same two GET calls.

// ── Verification bundle (independent verification) ─
export async function getVerificationBundle(agreementId: number): Promise<VerificationBundle> {
    return apiFetch(`/verify/${agreementId}`)
}

// ── Chain panel (outbox transaction history) ───────
export async function getOutboxEntries(agreementId: number): Promise<OutboxEntry[]> {
    return apiFetch(`/outbox/agreement/${agreementId}`)
}

// ── Auth API ──────────────────────────────────────────
export async function authRegister(email: string, password: string, name: string, role: string): Promise<{ token: string; user: User }> {
    return apiFetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, name, role }),
    })
}

export async function authLogin(email: string, password: string): Promise<{ token: string; user: User }> {
    return apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
    })
}

export async function authLogout(): Promise<void> {
    try {
        await apiFetch('/auth/logout', { method: 'POST' })
    } catch {
        // Ignore logout errors
    }
}

export async function authMe(): Promise<User> {
    return apiFetch('/auth/me')
}

export async function authGoogle(profile: { email: string; name: string; googleId: string }): Promise<{ token: string; user: User }> {
    return apiFetch('/auth/google', {
        method: 'POST',
        body: JSON.stringify(profile),
    })
}
