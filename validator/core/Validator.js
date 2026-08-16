/**
 * validator/core/Validator.js
 * ─────────────────────────────
 * The validator interface, per VEYLO_BUILD_PLAN_REVISED.md Phase 1, Part D.
 *
 * validator/core/engine.js is the one concrete implementation this session
 * builds (deterministic checks against a code-repo WorkSpec). This module
 * exists so a second deliverable type could implement the same interface
 * later without callers changing — it is NOT itself a second implementation
 * and none is built here.
 */

/**
 * @typedef {Object} WorkSpec
 * @property {string} repoUrl
 * @property {string} commitHash
 * @property {Array<Object>} criteria
 */

/**
 * @typedef {Object} Context
 * @property {Object} sandbox    Reference to validator/core/sandbox.js's runInSandbox
 * @property {Object} logger
 * @property {string|number} agreementId
 */

/**
 * @typedef {Object} CriterionResult
 * @property {number} index
 * @property {'PASS'|'FAIL'|'INCONCLUSIVE'} status
 * @property {string[]} evidenceRefs  Non-empty when status is PASS
 * @property {string} detail
 */

const STATUS = Object.freeze({
  PASS: "PASS",
  FAIL: "FAIL",
  INCONCLUSIVE: "INCONCLUSIVE",
});

/**
 * Abstract base. Concrete validators (e.g. engine.js) implement `validate`.
 * This class is never instantiated directly — calling validate() on it
 * throws rather than returning a fabricated result.
 */
class Validator {
  /**
   * @param {WorkSpec} spec
   * @param {Context} ctx
   * @returns {Promise<CriterionResult[]>}
   */
  // eslint-disable-next-line no-unused-vars
  async validate(spec, ctx) {
    throw new Error(
      "Validator.validate() is abstract. Use a concrete implementation, e.g. validator/core/engine.js."
    );
  }
}

module.exports = { Validator, STATUS };
