import { API_BASE_URL } from '@/lib/constants'

// Mirrors the shape returned by GET /api/agreements/:id (backend/routes/agreements.js).
// onChain/chainError are null/undefined until the on-chain id is known, or when
// the chain could not be reached — never filled with a fabricated value.
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
    database: Record<string, unknown>
    onChain: OnChainAgreement | null
    inSync: boolean
    chainError: string | null
}

/**
 * Reads real agreement state (DB + on-chain, from the deployed VeyloAgreements
 * contract on Amoy — see config/chain.json) via the backend. There is no
 * fallback value: if the chain is unreachable, chainError is surfaced as-is
 * rather than a zero-hash or otherwise fabricated result.
 */
export function useContract() {
    const getAgreement = async (id: number): Promise<AgreementView> => {
        const res = await fetch(`${API_BASE_URL}/agreements/${id}`, { credentials: 'include' })
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }))
            throw new Error(err.error || `Failed to fetch agreement ${id}: HTTP ${res.status}`)
        }
        return res.json()
    }

    const listAgreements = async (): Promise<Record<string, unknown>[]> => {
        const res = await fetch(`${API_BASE_URL}/agreements`, { credentials: 'include' })
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }))
            throw new Error(err.error || `Failed to list agreements: HTTP ${res.status}`)
        }
        return res.json()
    }

    return { getAgreement, listAgreements }
}
