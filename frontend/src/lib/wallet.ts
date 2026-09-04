/**
 * wallet.ts
 * ──────────
 * MetaMask (or any EIP-1193 injected provider) connection and EIP-712
 * signing. The app account (email/password, via useAuth) and the wallet are
 * deliberately separate: only the wallet ever signs, and only the client's
 * or worker's own signature is ever produced here — the platform never
 * holds or touches these keys. There is no fallback signer; if no injected
 * wallet is present, connection fails visibly rather than simulating one.
 */

import { BrowserProvider, type TypedDataField } from 'ethers'
import type { Eip712Domain } from '@/lib/eip712'

declare global {
    interface Window {
        ethereum?: import('ethers').Eip1193Provider & {
            on?: (event: string, handler: (...args: unknown[]) => void) => void
            removeListener?: (event: string, handler: (...args: unknown[]) => void) => void
        }
    }
}

export function isWalletAvailable(): boolean {
    return typeof window !== 'undefined' && !!window.ethereum
}

/** Requests account access and returns the connected address. Throws if no wallet is installed or the user rejects. */
export async function connectWallet(): Promise<string> {
    if (!isWalletAvailable()) {
        throw new Error('No wallet found. Install MetaMask (or another injected wallet) to sign.')
    }
    const provider = new BrowserProvider(window.ethereum!)
    const accounts = await provider.send('eth_requestAccounts', [])
    if (!accounts || accounts.length === 0) {
        throw new Error('Wallet connection was rejected or returned no accounts.')
    }
    return accounts[0]
}

/** Returns the currently connected address, if any, without prompting. */
export async function getConnectedAddress(): Promise<string | null> {
    if (!isWalletAvailable()) return null
    const provider = new BrowserProvider(window.ethereum!)
    const accounts = await provider.listAccounts()
    return accounts.length > 0 ? accounts[0].address : null
}

/** Switches the connected wallet to the given chain id, if it isn't already there. */
export async function ensureChain(chainId: number): Promise<void> {
    if (!isWalletAvailable()) throw new Error('No wallet found.')
    const provider = new BrowserProvider(window.ethereum!)
    const network = await provider.getNetwork()
    if (Number(network.chainId) === chainId) return
    const hexChainId = '0x' + chainId.toString(16)
    await provider.send('wallet_switchEthereumChain', [{ chainId: hexChainId }])
}

/**
 * Signs EIP-712 typed data with the connected wallet and returns the
 * signature. Throws (does not fall back to anything) if the user rejects
 * or no wallet is connected — the caller must surface this as a real error.
 */
export async function signTypedData<T extends Record<string, unknown>>(
    domain: Eip712Domain,
    types: Record<string, readonly { name: string; type: string }[]>,
    value: T,
): Promise<{ signature: string; signerAddress: string }> {
    if (!isWalletAvailable()) {
        throw new Error('No wallet found. Install MetaMask (or another injected wallet) to sign.')
    }
    const provider = new BrowserProvider(window.ethereum!)
    const signer = await provider.getSigner()
    // ethers' own type wants mutable TypedDataField[]; our callers pass
    // `as const` literals (readonly) so ethers' TypedDataEncoder can't
    // accidentally mutate them elsewhere — safe to widen back here.
    const signature = await signer.signTypedData(domain, types as Record<string, TypedDataField[]>, value)
    return { signature, signerAddress: await signer.getAddress() }
}
