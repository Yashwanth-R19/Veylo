// ── API ────────────────────────────────────────────
export const API_BASE_URL = '/api'

// ── Chain (Polygon Amoy) ─────────────────────────────
// The deployed contract address is NOT here — it comes from GET
// /api/chain-info at runtime (see lib/api.ts's getChainInfo), so the
// frontend never signs against a stale, hardcoded address after a
// redeploy. AMOY_CHAIN_ID is a fallback expectation for wallet network
// switching, not the source of truth for signing.
export const AMOY_CHAIN_ID = 80002

export const REVIEW_WINDOW_SECONDS = 3 * 24 * 60 * 60 // §5: 3 days, public constant
