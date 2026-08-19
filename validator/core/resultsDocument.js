/**
 * validator/core/resultsDocument.js
 * ─────────────────────────────────────
 * Assembles the full results document from VEYLO_BUILD_PLAN_REVISED.md §6 —
 * a `deterministic` section and an `advisory` section — and computes both
 * hashes: `resultsHash` covers the whole document; `deterministicHash`
 * covers only the `deterministic` section (already computed by
 * validator/core/engine.js's runEngine(), and NOT recomputed here — the same
 * value is reused so there is exactly one place that ever hashes that
 * section). Only deterministicHash is claimed reproducible.
 *
 * computeFinalOutcome() below is THIS SESSION'S ARCHITECTURAL CORE. It is
 * the one function anywhere in the codebase that decides ACCEPT/REJECT/NONE
 * once both the deterministic engine and the advisory layer have run, and it
 * is written to make one property mechanically true, not just documented:
 * a SEMANTIC/advisory result can only ever push the outcome to NONE
 * (NEEDS_REVIEW) — it has no code path that can produce ACCEPT or REJECT on
 * its own. Read the function body, not just this comment, to verify that.
 */

const { hashCanonical } = require("../../backend/lib/canonical");

/**
 * §5's outcome rule, applied to BOTH sections:
 *   ACCEPT if every DETERMINISTIC criterion PASSes AND no SEMANTIC criterion
 *          is FAIL or INCONCLUSIVE
 *   REJECT if any DETERMINISTIC criterion FAILs
 *   NONE   otherwise (-> NEEDS_REVIEW, a human decides)
 *
 * Note the REJECT check has no "and no INCONCLUSIVE" qualifier, matching the
 * plan's rule exactly: a deterministic FAIL always wins over everything
 * else, including a deterministic INCONCLUSIVE elsewhere or any semantic
 * result. An INCONCLUSIVE deterministic result (with no FAIL present) routes
 * to NONE, same as the old deterministic-only engine.js:computeOutcome
 * behavior it supersedes for the combined document.
 *
 * @param {{status:string}[]} deterministicResults
 * @param {{status:string}[]} semanticResults
 * @returns {"ACCEPT"|"REJECT"|"NONE"}
 */
function computeFinalOutcome(deterministicResults, semanticResults) {
  if (deterministicResults.some((r) => r.status === "FAIL")) return "REJECT";
  if (deterministicResults.some((r) => r.status === "INCONCLUSIVE")) return "NONE";
  if (semanticResults.some((r) => r.status === "FAIL" || r.status === "INCONCLUSIVE")) return "NONE";
  return "ACCEPT";
}

/**
 * @param {object} params
 * @param {number} params.agreementId  the on-chain agreement id
 * @param {string} params.criteriaHash
 * @param {string} params.evidenceHash
 * @param {{engineVersion:string, outcome:string, results:object[]}} params.deterministic
 * @param {string} params.deterministicHash  as computed by engine.js's runEngine()
 * @param {{provider:string|null, results:object[]}} params.advisory
 * @returns {{ document: object, resultsHash: string, outcome: "ACCEPT"|"REJECT"|"NONE" }}
 */
function assembleResults({ agreementId, criteriaHash, evidenceHash, deterministic, deterministicHash, advisory }) {
  const document = {
    version: 1,
    agreementId,
    criteriaHash,
    evidenceHash,
    deterministic,
    advisory,
  };

  const resultsHash = hashCanonical(document);
  const outcome = computeFinalOutcome(deterministic.results, advisory.results);

  return { document, resultsHash, deterministicHash, outcome };
}

module.exports = { assembleResults, computeFinalOutcome };
