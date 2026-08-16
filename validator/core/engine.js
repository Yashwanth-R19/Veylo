/**
 * validator/core/engine.js
 * ──────────────────────────
 * Replaces validator/pipeline/orchestrator.js. Runs the DETERMINISTIC checks
 * for a code-repo WorkSpec, assembles the `deterministic` section of the
 * results document (VEYLO_BUILD_PLAN_REVISED.md §6), and computes its hash.
 *
 * Does NOT evaluate SEMANTIC criteria — the AI layer is not built this
 * session (Phase 3). See computeOutcome() below for how their presence is
 * handled without fabricating a result for them.
 *
 * ── Determinism sources found this session, and how they were handled ──
 *
 *   1. Unsorted filesystem iteration (orchestrator.js:198-213's listRepoFiles,
 *      now orphaned/unused) → validator/core/sandbox.js's collectFiles()
 *      sorts entries at every directory level before upload.
 *   2. Test runner ordering → validator/checks/_shared.js pins it:
 *      `pytest -p no:randomly`, `jest --runInBand`.
 *   3. Unpinned dependency resolution → validator/checks/_shared.js's
 *      checkLockfileStatus() requires a lockfile (or a fully `==`-pinned
 *      requirements.txt); checks return INCONCLUSIVE, never PASS, otherwise.
 *   4. Absolute paths / temp directory names — cloneRepo() below uses a
 *      fresh temp dir per run, and lintAgent.js (reused unchanged) reports
 *      absolute paths back from flake8/eslint since it's invoked with the
 *      repo's absolute path. Handled in validator/checks/lint_clean.js by
 *      normalizing every reported path to repo-relative before it reaches
 *      evidenceRefs. Sandboxed test/http commands don't have this problem:
 *      both e2b (fresh upload) and docker (bind mount) present the repo at
 *      the fixed path /workspace inside the sandbox, so tool output never
 *      contains the host's temp path to begin with.
 *   5. Sandbox ids — never included in any CriterionResult field; verified
 *      by inspection of every check module and this file.
 *   6. Timestamps / durations — never captured into any CriterionResult
 *      field, following the same exclude-before-hashing approach already
 *      used correctly at orchestrator.js:144-147 (now orphaned, but the
 *      pattern is carried forward: nothing in `deterministic` is populated
 *      from Date.now() or a duration anywhere in this file or validator/checks/).
 *   7. RESIDUAL, NOT FULLY ELIMINATED: INCONCLUSIVE/error-path `detail`
 *      strings in validator/checks/*.js embed raw stderr/stdout snippets
 *      (install failures, unparseable output, linter crashes) for human
 *      debuggability. Those snippets are not guaranteed deterministic
 *      (e.g. a crash message could include a PID or a timestamp from the
 *      tool itself). PASS and FAIL `detail` strings are NOT affected — they
 *      are synthesized from parsed counts/status codes only, never raw
 *      output — so the common, hash-relevant path is clean. This is a
 *      documented gap, not a silent one: it can only affect the hash of an
 *      already-INCONCLUSIVE result, never turn a real PASS/FAIL non-reproducible.
 *   8. NOT FIXED, OUT OF SCOPE: validator/pipeline/entryPointDiscovery.js
 *      (reused unchanged per the plan) walks the filesystem with unsorted
 *      readdirSync() when picking among tied-confidence framework matches.
 *      Flagged here rather than silently patched, since "unchanged" is this
 *      session's explicit instruction for that file.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { exec } = require("child_process");

const { Validator } = require("./Validator");
const { runInSandbox } = require("./sandbox");
const { hashCanonical } = require("../../backend/lib/canonical");
const { CHECKS } = require("../checks");
const { discoverEntryPoint } = require("../pipeline/entryPointDiscovery");
const { detectJobType } = require("../pipeline/jobTypeDetector");

const ENGINE_VERSION = "veylo-verify@1.0.0";

function execPromise(cmd, opts) {
  return new Promise((resolve, reject) => {
    exec(cmd, opts, (error, stdout, stderr) => {
      if (error) reject(new Error(`${error.message}\n${stderr || ""}`));
      else resolve({ stdout, stderr });
    });
  });
}

/**
 * Clone (or copy, for local paths) the repo at a specific commit into a
 * fresh temp directory. No placeholder fallback: an inaccessible repo is a
 * real failure, reported as such, never silently substituted.
 */
async function cloneRepo(repoUrl, commitHash, logger) {
  const dest = path.join(os.tmpdir(), "veylo-verify", `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  fs.mkdirSync(dest, { recursive: true });

  if (/^https?:\/\//.test(repoUrl)) {
    await execPromise(`git clone --quiet "${repoUrl}" "${dest}"`, { timeout: 60_000 });
    if (commitHash) {
      await execPromise(`git checkout --quiet ${commitHash}`, { cwd: dest, timeout: 30_000 });
    }
  } else if (fs.existsSync(repoUrl)) {
    fs.cpSync(repoUrl, dest, { recursive: true });
  } else {
    throw new Error(`Repository not accessible: "${repoUrl}"`);
  }

  logger.log(`[engine] repo prepared at commit ${commitHash || "(HEAD)"}`);
  return dest;
}

function cleanupRepo(repoPath, logger) {
  try {
    fs.rmSync(repoPath, { recursive: true, force: true });
  } catch (err) {
    logger.warn(`[engine] cleanup failed: ${err.message}`);
  }
}

/**
 * outcome rule, adapted for a deterministic-only engine (§5 of the plan):
 *   REJECT  if any DETERMINISTIC criterion FAILs
 *   NONE    if any DETERMINISTIC criterion is INCONCLUSIVE
 *   NONE    if the spec contains SEMANTIC criteria (they are not evaluated —
 *           this session builds no AI layer — and a semantic criterion can
 *           never alone produce ACCEPT, so "not yet evaluated" routes to
 *           human review rather than being silently treated as passing)
 *   ACCEPT  otherwise (every DETERMINISTIC criterion PASSed, no SEMANTIC criteria present)
 */
function computeOutcome(criteria, results) {
  if (results.some((r) => r.status === "FAIL")) return "REJECT";
  if (results.some((r) => r.status === "INCONCLUSIVE")) return "NONE";
  if (criteria.some((c) => c.method === "SEMANTIC")) return "NONE";
  return "ACCEPT";
}

class Engine extends Validator {
  /**
   * @param {import('./Validator').WorkSpec} spec
   * @param {import('./Validator').Context} ctx
   * @returns {Promise<import('./Validator').CriterionResult[]>}
   */
  async validate(spec, ctx) {
    const logger = ctx.logger || console;
    const sandbox = ctx.sandbox || runInSandbox;

    const deterministicCriteria = spec.criteria.filter((c) => c.method === "DETERMINISTIC");
    if (deterministicCriteria.length === 0) {
      return [];
    }

    const repoPath = await cloneRepo(spec.repoUrl, spec.commitHash, logger);
    try {
      const language = detectJobType(repoPath, {});
      const entryPoint = discoverEntryPoint(repoPath, language);

      const checkCtx = { ...ctx, logger, sandbox, repoPath, language, entryPoint };
      const results = [];

      // Criteria are processed in the fixed order they appear in spec.criteria —
      // never re-ordered, so result array order is itself deterministic.
      for (const criterion of deterministicCriteria) {
        const kind = criterion.check && criterion.check.kind;
        const impl = CHECKS[kind];

        if (!impl) {
          results.push({
            index: criterion.index,
            status: "INCONCLUSIVE",
            evidenceRefs: [],
            detail: `Unknown check kind "${kind}"`,
          });
          continue;
        }

        const outcome = await impl.check(criterion.check, checkCtx);

        if (outcome.status === "PASS" && (!outcome.evidenceRefs || outcome.evidenceRefs.length === 0)) {
          throw new Error(`check "${kind}" (criterion ${criterion.index}) returned PASS with empty evidenceRefs — invalid per spec`);
        }

        results.push({ index: criterion.index, ...outcome });
      }

      return results;
    } finally {
      cleanupRepo(repoPath, logger);
    }
  }
}

/**
 * Run the engine and assemble the `deterministic` section of the results
 * document (§6), including its hash.
 *
 * @param {import('./Validator').WorkSpec} spec
 * @param {import('./Validator').Context} ctx
 * @returns {Promise<{ deterministic: object, deterministicHash: string }>}
 */
async function runEngine(spec, ctx) {
  const engine = new Engine();
  const results = await engine.validate(spec, ctx);
  const outcome = computeOutcome(spec.criteria, results);

  const deterministic = {
    engineVersion: ENGINE_VERSION,
    outcome,
    results,
  };

  const deterministicHash = hashCanonical(deterministic);

  return { deterministic, deterministicHash };
}

module.exports = { Engine, runEngine, computeOutcome, ENGINE_VERSION };
