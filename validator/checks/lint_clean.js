/**
 * validator/checks/lint_clean.js
 * check kind: lint_clean { maxErrors }
 *
 * Wraps the reused validator/agents/lintAgent.js (flake8 / eslint), which
 * runs directly on the host against the already-cloned repo — static
 * analysis, not execution of submitted code, so no sandbox is used.
 *
 * lintAgent.js is reused unchanged per the Phase 1 plan. It has two internal
 * fallback paths that fabricate a passing-looking score rather than failing
 * loudly (a linter crash returns lintScore: 70; an unsupported language
 * returns lintScore: 100, both with errorCount/warningCount: 0). Since we
 * cannot change that file this session, this wrapper detects those specific
 * fallback signatures by their rawOutput text and reports INCONCLUSIVE
 * instead of trusting the fabricated score as a real PASS/FAIL signal.
 */

const path = require("path");
const { runLintAnalysis } = require("../agents/lintAgent");

/**
 * lintAgent.js invokes flake8/eslint with the repo's absolute path, so the
 * file paths it reports back are absolute — a determinism hazard, since a
 * fresh clone gets a new temp directory on every run and that path would
 * otherwise leak into evidenceRefs and vary the deterministicHash between
 * runs. Normalize to repo-relative, forward-slashed paths before use.
 */
function toRepoRelative(absoluteOrRelative, repoPath) {
  const rel = path.isAbsolute(absoluteOrRelative)
    ? path.relative(repoPath, absoluteOrRelative)
    : absoluteOrRelative;
  return rel.split(path.sep).join("/");
}

/**
 * @param {{ maxErrors: number }} params
 * @param {{ repoPath: string, language: string }} ctx
 */
async function check(params, ctx) {
  const { repoPath, language } = ctx;

  if (!params || typeof params.maxErrors !== "number") {
    return { status: "INCONCLUSIVE", evidenceRefs: [], detail: 'lint_clean: missing required numeric "maxErrors" parameter' };
  }

  const result = await runLintAnalysis(repoPath, language);

  if (typeof result.rawOutput === "string" && result.rawOutput.startsWith("Linter error:")) {
    return { status: "INCONCLUSIVE", evidenceRefs: [], detail: `Linter crashed: ${result.rawOutput}` };
  }
  if (typeof result.rawOutput === "string" && result.rawOutput.startsWith("No linter for language")) {
    return { status: "INCONCLUSIVE", evidenceRefs: [], detail: `No linter available for language "${language}"` };
  }

  const issues = (result.issues || []).filter((i) => i.code || i.ruleId);
  const evidenceRefs = issues.slice(0, params.maxErrors + 1 || issues.length).map((i) => {
    const loc = i.file && i.line ? `${toRepoRelative(i.file, repoPath)}:${i.line}` : "unknown location";
    return `${loc}: ${i.code}`;
  });

  if (result.errorCount <= params.maxErrors) {
    return {
      status: "PASS",
      evidenceRefs: evidenceRefs.length > 0 ? evidenceRefs : [`lint: 0 errors found (maxErrors=${params.maxErrors})`],
      detail: `Lint found ${result.errorCount} error(s), within the allowed ${params.maxErrors}.`,
    };
  }

  return {
    status: "FAIL",
    evidenceRefs: evidenceRefs.length > 0 ? evidenceRefs : [`lint: ${result.errorCount} errors found (maxErrors=${params.maxErrors})`],
    detail: `Lint found ${result.errorCount} error(s), exceeding the allowed ${params.maxErrors}.`,
  };
}

module.exports = { check };
