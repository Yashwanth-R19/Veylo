/**
 * scripts/settlementStepRunner.js
 * ──────────────────────────────────
 * The CHILD-PROCESS half of the fault-injection suite
 * (scripts/settlementFaultInjection.js). Runs exactly one settlement engine
 * step for one agreement, then exits.
 *
 * A fault configured via VEYLO_FAULT_KIND/VEYLO_FAULT_MODE (see
 * SimulatedProvider.js) that fires CRASH_BEFORE_ACT/CRASH_AFTER_ACT calls
 * process.exit(1) from INSIDE the provider call, mid-step — this process
 * genuinely terminates right there, never reaching the try/catch below or
 * printing anything. That silence (no RESULT: line, non-zero exit with no
 * output) is how the parent tells "the process really crashed mid-operation"
 * apart from "the step ran and failed normally" (ERROR_* faults, which ARE
 * caught by engine.js, recorded as an attempt failure, and reported below).
 *
 * Usage: node scripts/settlementStepRunner.js <dbAgreementId> <hold|action|confirm|full>
 */
const engine = require("../backend/services/settlement/engine");

const [, , agreementIdArg, step] = process.argv;
const dbAgreementId = parseInt(agreementIdArg, 10);

const STEPS = {
  hold: () => engine.ensureHold(dbAgreementId),
  action: () => engine.ensureAction(dbAgreementId),
  confirm: () => engine.ensureConfirmSettlement(dbAgreementId),
  full: () => engine.processOne(dbAgreementId),
};

async function main() {
  if (!Number.isInteger(dbAgreementId) || !STEPS[step]) {
    console.log(`RESULT:${JSON.stringify({ ok: false, error: `usage: node settlementStepRunner.js <dbAgreementId> <${Object.keys(STEPS).join("|")}>` })}`);
    process.exit(2);
  }
  try {
    await STEPS[step]();
    // Simulates the WHOLE PROCESS dying right after this step landed, before
    // it ever gets to move on to the next one — a real process.exit, not a
    // caught error, so the parent sees no RESULT: line, exactly like the
    // provider-internal CRASH_* faults.
    if (process.env.VEYLO_CRASH_AFTER_STEP) process.exit(1);
    console.log(`RESULT:${JSON.stringify({ ok: true })}`);
    process.exit(0);
  } catch (err) {
    console.log(`RESULT:${JSON.stringify({ ok: false, error: err.message })}`);
    process.exit(0); // a caught, recorded failure is a NORMAL outcome for this harness, not a crash
  }
}

main();
