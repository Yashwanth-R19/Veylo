// ── API ────────────────────────────────────────────
export const API_BASE_URL = '/api'

// ── Google sign-in ───────────────────────────────────
// Public client identifier, not a secret — safe in the bundle. Empty until
// frontend/.env sets VITE_GOOGLE_CLIENT_ID (see frontend/.env.example);
// components must check this rather than assume it's configured.
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

// ── Chain (Polygon Amoy) ─────────────────────────────
// The deployed contract address is NOT here — it comes from GET
// /api/chain-info at runtime (see lib/api.ts's getChainInfo), so the
// frontend never signs against a stale, hardcoded address after a
// redeploy. AMOY_CHAIN_ID is a fallback expectation for wallet network
// switching, not the source of truth for signing.
export const AMOY_CHAIN_ID = 80002

export const REVIEW_WINDOW_SECONDS = 3 * 24 * 60 * 60 // §5: 3 days, public constant
