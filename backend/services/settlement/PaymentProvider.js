/**
 * backend/services/settlement/PaymentProvider.js
 * ─────────────────────────────────────────────────
 * The payment provider port, per VEYLO_BUILD_PLAN_REVISED.md Phase 4 Session
 * 2, Part A. CONDITIONAL SETTLEMENT, never "escrow" (see the plan's own
 * terminology note — Razorpay Route and Stripe both state they do not
 * provide escrow either).
 *
 * backend/services/settlement/SimulatedProvider.js is the one concrete
 * implementation this session builds. Razorpay is Phase 6 and optional — no
 * second implementation exists here.
 *
 * THE IDEMPOTENCY CONTRACT every implementation MUST uphold: calling any
 * method twice with the same idempotencyKey must return the exact same ref
 * and must never perform the underlying side effect (hold/payout/refund)
 * more than once. This is what makes crash-safe retry possible — the caller
 * (backend/services/settlement/engine.js) always replays with the same
 * deterministic key rather than branching on "did this already happen?".
 */

/**
 * @typedef {"HOLD"|"RELEASED"|"REVERSED"|"NOT_FOUND"} HoldStatus
 */

class PaymentProvider {
  /**
   * Places a hold for amountMinor against agreementId. Idempotent on
   * idempotencyKey: a repeated call with the same key returns the same
   * holdRef without creating a second hold.
   * @param {number} agreementId
   * @param {string|bigint} amountMinor
   * @param {string} idempotencyKey
   * @returns {Promise<string>} holdRef
   */
  // eslint-disable-next-line no-unused-vars
  async createHold(agreementId, amountMinor, idempotencyKey) {
    throw new Error("PaymentProvider.createHold() is abstract. Use a concrete implementation, e.g. SimulatedProvider.");
  }

  /**
   * Releases a held amount to the worker (outcome ACCEPT). Idempotent on
   * idempotencyKey.
   * @param {string} holdRef
   * @param {string} idempotencyKey
   * @returns {Promise<string>} payoutRef
   */
  // eslint-disable-next-line no-unused-vars
  async release(holdRef, idempotencyKey) {
    throw new Error("PaymentProvider.release() is abstract. Use a concrete implementation, e.g. SimulatedProvider.");
  }

  /**
   * Reverses a held amount back to the client (outcome REJECT). Idempotent
   * on idempotencyKey.
   * @param {string} holdRef
   * @param {string} idempotencyKey
   * @returns {Promise<string>} refundRef
   */
  // eslint-disable-next-line no-unused-vars
  async reverse(holdRef, idempotencyKey) {
    throw new Error("PaymentProvider.reverse() is abstract. Use a concrete implementation, e.g. SimulatedProvider.");
  }

  /**
   * @param {string} ref  A holdRef, payoutRef or refundRef previously returned.
   * @returns {Promise<HoldStatus>}
   */
  // eslint-disable-next-line no-unused-vars
  async getStatus(ref) {
    throw new Error("PaymentProvider.getStatus() is abstract. Use a concrete implementation, e.g. SimulatedProvider.");
  }
}

module.exports = { PaymentProvider };
