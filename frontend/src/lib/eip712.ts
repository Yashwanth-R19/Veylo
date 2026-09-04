/**
 * eip712.ts
 * ──────────
 * Frontend mirror of backend/lib/eip712.js's domain and typed-data structs.
 * Must match contracts/VeyloAgreements.sol's EIP712("Veylo", "1") domain and
 * the CriteriaCommitment/CriteriaAcceptance struct definitions exactly, or a
 * signature produced here will not recover to the expected address on the
 * backend or on-chain.
 *
 * chainId and verifyingContract are NOT hardcoded — they come from
 * GET /api/chain-info (see lib/api.ts's getChainInfo), which reads the same
 * config/chain.json the backend signs against. This is deliberate: the
 * contract has already been redeployed once during this project, and a
 * hardcoded frontend address would silently sign against a stale contract.
 */

export interface ChainInfo {
    chainId: number
    network: string
    contractAddress: string
    arbitratorAddress: string
    arbitrationCost: string
    blockExplorerBase: string | null
    deployedAt: string
}

export interface Eip712Domain {
    name: string
    version: string
    chainId: number
    verifyingContract: string
}

export function buildDomain(chainInfo: ChainInfo): Eip712Domain {
    return {
        name: 'Veylo',
        version: '1',
        chainId: chainInfo.chainId,
        verifyingContract: chainInfo.contractAddress,
    }
}

export const CRITERIA_COMMITMENT_TYPES = {
    CriteriaCommitment: [
        { name: 'worker', type: 'address' },
        { name: 'amountMinor', type: 'uint256' },
        { name: 'criteriaHash', type: 'bytes32' },
        { name: 'deadline', type: 'uint64' },
        { name: 'nonce', type: 'uint256' },
    ],
} as const

export const CRITERIA_ACCEPTANCE_TYPES = {
    CriteriaAcceptance: [
        { name: 'agreementId', type: 'uint256' },
        { name: 'criteriaHash', type: 'bytes32' },
        { name: 'nonce', type: 'uint256' },
    ],
} as const

export interface CriteriaCommitmentValue {
    worker: string
    amountMinor: string
    criteriaHash: string
    deadline: number
    nonce: string
}

export interface CriteriaAcceptanceValue {
    agreementId: number
    criteriaHash: string
    nonce: string
}
