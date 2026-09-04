/**
 * backend/services/settlement/SimulatedProvider.js
 * ────────────────────────────────────────────────────
 * VEYLO_BUILD_PLAN_REVISED.md Phase 4 Session 2, Part B/F. Implements
 * PaymentProvider. No real money moves — every ref this returns is prefixed
 * "sim_" and every response the API exposes it through must be labelled
 * simulated (see backend/routes/agreements.js's GET .../settlement).
 *
 * Persists its own ledger (SimulatedProviderRecord) SEPARATELY from
 * Settlement — it represents what an external provider (Razorpay/Stripe,
 * Phase 6) would hold on ITS OWN side, independent of Veylo's database. This
 * is what makes idempotency-key replay after a real process crash a genuine
 * test: a killed process loses all in-memory state, but this ledger survives
 * (SQLite, same as everything else this session), exactly like a real
 * provider's servers would still remember a request Veylo's own process
 * never got to record.
 *
 * FAULT INJECTION (Part B): configured via environment variables rather than
 * an in-memory setter, specifically so a test harness can configure an exact
 * crash point in a FRESH CHILD PROCESS before that process ever runs — an
 * in-memory flag would not survive across the process boundary a real crash
 * test requires. See scripts/settlementFaultInjection.js.
 *
 *   VEYLO_FAULT_KIND  HOLD | RELEASE | REVERSE   (which call to target)
 *   VEYLO_FAULT_MODE  one of FAULT_MODES below
 *
 * A fault fires at most once: it is read from the record's own idempotency
 * check, so a call that would be a no-op replay (idempotencyKey already has
 * a ledger row) never re-triggers a fault — matching how a real provider
 * would never re-run a side effect for a replayed key either.
 */

const crypto = require("crypto");
const prisma = require("../../db/prismaClient");
const { PaymentProvider } = require("./PaymentProvider");

const FAULT_MODES = Object.freeze({
  CRASH_BEFORE_ACT: "CRASH_BEFORE_ACT", // process.exit before any side effect — nothing recorded
  CRASH_AFTER_ACT: "CRASH_AFTER_ACT", // side effect lands, then process.exit before the ref reaches the caller
  ERROR_BEFORE_ACT: "ERROR_BEFORE_ACT", // thrown, process stays alive, no side effect
  ERROR_AFTER_ACT: "ERROR_AFTER_ACT", // side effect lands, then thrown — response lost, process stays alive
  TIMEOUT: "TIMEOUT", // never resolves; the engine's own call timeout must catch this
  DUPLICATE_REFERENCE: "DUPLICATE_REFERENCE", // returns a ref already used by a DIFFERENT idempotencyKey (provider bug simulation)
});

function faultModeFor(kind) {
  if (process.env.VEYLO_FAULT_KIND !== kind) return null;
  const mode = process.env.VEYLO_FAULT_MODE;
  return mode && FAULT_MODES[mode] ? mode : null;
}

function newRef(prefix) {
  return `sim_${prefix}_${crypto.randomBytes(12).toString("hex")}`;
}

class SimulatedProvider extends PaymentProvider {
  /**
   * Shared idempotent-call machinery for all three write methods.
   * @param {"HOLD"|"RELEASE"|"REVERSE"} kind
   * @param {string} idempotencyKey
   * @param {() => Promise<{agreementId: number, amountMinor?: string, holdRef?: string, ref: string}>} build
   */
  async _act(kind, idempotencyKey, build) {
    if (!idempotencyKey) throw new Error(`[SimulatedProvider] ${kind}: idempotencyKey is required`);

    // Idempotency: an existing record for this exact key is returned as-is —
    // the underlying side effect never runs twice, and no fault re-fires.
    const existing = await prisma.simulatedProviderRecord.findUnique({ where: { idempotencyKey } });
    if (existing) return existing.ref;

    const mode = faultModeFor(kind);

    if (mode === FAULT_MODES.CRASH_BEFORE_ACT) process.exit(1);
    if (mode === FAULT_MODES.ERROR_BEFORE_ACT) {
      throw new Error(`[SimulatedProvider] injected ${mode} fault on ${kind}`);
    }
    if (mode === FAULT_MODES.TIMEOUT) {
      await new Promise(() => {}); // deliberately never resolves
    }

    const built = await build();
    const ref = mode === FAULT_MODES.DUPLICATE_REFERENCE ? process.env.VEYLO_FAULT_DUPLICATE_REF : built.ref;
    if (mode === FAULT_MODES.DUPLICATE_REFERENCE && !ref) {
      throw new Error("[SimulatedProvider] DUPLICATE_REFERENCE fault requires VEYLO_FAULT_DUPLICATE_REF");
    }

    await prisma.simulatedProviderRecord.create({
      data: {
        idempotencyKey,
        kind,
        agreementId: built.agreementId,
        amountMinor: built.amountMinor ?? null,
        holdRef: built.holdRef ?? null,
        ref,
      },
    });

    if (mode === FAULT_MODES.CRASH_AFTER_ACT) process.exit(1);
    if (mode === FAULT_MODES.ERROR_AFTER_ACT) {
      throw new Error(`[SimulatedProvider] injected ${mode} fault on ${kind} (side effect already recorded)`);
    }

    return ref;
  }

  async createHold(agreementId, amountMinor, idempotencyKey) {
    return this._act("HOLD", idempotencyKey, async () => ({
      agreementId,
      amountMinor: String(amountMinor),
      ref: newRef("hold"),
    }));
  }

  async release(holdRef, idempotencyKey) {
    return this._act("RELEASE", idempotencyKey, async () => {
      const hold = await prisma.simulatedProviderRecord.findFirst({ where: { ref: holdRef, kind: "HOLD" } });
      if (!hold) throw new Error(`[SimulatedProvider] release: unknown holdRef "${holdRef}"`);
      return { agreementId: hold.agreementId, holdRef, ref: newRef("payout") };
    });
  }

  async reverse(holdRef, idempotencyKey) {
    return this._act("REVERSE", idempotencyKey, async () => {
      const hold = await prisma.simulatedProviderRecord.findFirst({ where: { ref: holdRef, kind: "HOLD" } });
      if (!hold) throw new Error(`[SimulatedProvider] reverse: unknown holdRef "${holdRef}"`);
      return { agreementId: hold.agreementId, holdRef, ref: newRef("refund") };
    });
  }

  async getStatus(ref) {
    const record = await prisma.simulatedProviderRecord.findFirst({ where: { ref } });
    if (!record) return "NOT_FOUND";
    if (record.kind !== "HOLD") return record.kind === "RELEASE" ? "RELEASED" : "REVERSED";

    const released = await prisma.simulatedProviderRecord.findFirst({ where: { holdRef: ref, kind: "RELEASE" } });
    if (released) return "RELEASED";
    const reversed = await prisma.simulatedProviderRecord.findFirst({ where: { holdRef: ref, kind: "REVERSE" } });
    if (reversed) return "REVERSED";
    return "HOLD";
  }
}

module.exports = { SimulatedProvider, FAULT_MODES, faultModeFor };
