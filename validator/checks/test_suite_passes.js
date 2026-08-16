/**
 * validator/checks/test_suite_passes.js
 * check kind: test_suite_passes {}
 *
 * Runs the full test suite in the sandbox. PASS only if every test passed
 * and the output was parseable; unparseable output is INCONCLUSIVE, never PASS.
 */

const { checkLockfileStatus, testSuiteCommand, parseTestOutput } = require("./_shared");

/**
 * @param {{}} _params
 * @param {{ repoPath: string, language: string, sandbox: Function, logger: Object }} ctx
 */
async function check(_params, ctx) {
  const { repoPath, language, sandbox, logger } = ctx;

  const lock = checkLockfileStatus(repoPath, language);
  if (!lock.pinned) {
    return { status: "INCONCLUSIVE", evidenceRefs: [], detail: `Dependency resolution is unpinned: ${lock.reason}` };
  }

  const execCmd = testSuiteCommand(language);
  if (!execCmd) {
    return { status: "INCONCLUSIVE", evidenceRefs: [], detail: `No deterministic test runner known for language "${language}"` };
  }

  const result = await sandbox({ repoPath, installCmd: lock.installCmd, execCmd, language, logger });

  if (result.status === "INCONCLUSIVE") {
    return { status: "INCONCLUSIVE", evidenceRefs: [], detail: `Sandbox unavailable (${result.backend}): ${result.reason}` };
  }

  if (result.install && result.install.exitCode !== 0) {
    return {
      status: "INCONCLUSIVE",
      evidenceRefs: [],
      detail: `Dependency installation failed (exit ${result.install.exitCode}): ${result.install.stderr.slice(0, 500)}`,
    };
  }

  const { execute } = result;
  if (execute.timedOut) {
    return { status: "FAIL", evidenceRefs: ["test_suite_passes:timeout"], detail: "Test suite timed out — flagged as FAIL." };
  }

  const parsed = parseTestOutput(execute.stdout + "\n" + execute.stderr, language);
  if (!parsed.parsed) {
    return {
      status: "INCONCLUSIVE",
      evidenceRefs: [],
      detail: "Test suite output was not parseable — cannot determine pass/fail counts.",
    };
  }

  if (parsed.failed === 0 && parsed.total > 0) {
    return {
      status: "PASS",
      evidenceRefs: [`test_suite: ${parsed.passed}/${parsed.total} passed`],
      detail: `All ${parsed.total} tests passed.`,
    };
  }

  return {
    status: "FAIL",
    evidenceRefs: [`test_suite: ${parsed.passed}/${parsed.total} passed, ${parsed.failed} failed`],
    detail: `${parsed.failed} of ${parsed.total} tests failed.`,
  };
}

module.exports = { check };
