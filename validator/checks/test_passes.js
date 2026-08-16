/**
 * validator/checks/test_passes.js
 * check kind: test_passes { testId }
 *
 * Runs one specific test node in the sandbox. testId is a pytest node id
 * ("tests/test_auth.py::test_reset") for Python, or for JS/TS either a bare
 * file path or "<file>::<test name>".
 */

const { checkLockfileStatus, testCommand, parseTestOutput } = require("./_shared");

/**
 * @param {{ testId: string }} params
 * @param {{ repoPath: string, language: string, sandbox: Function, logger: Object }} ctx
 */
async function check(params, ctx) {
  const { repoPath, language, sandbox, logger } = ctx;

  if (!params || typeof params.testId !== "string" || !params.testId) {
    return { status: "INCONCLUSIVE", evidenceRefs: [], detail: 'test_passes: missing required "testId" parameter' };
  }

  const lock = checkLockfileStatus(repoPath, language);
  if (!lock.pinned) {
    return { status: "INCONCLUSIVE", evidenceRefs: [], detail: `Dependency resolution is unpinned: ${lock.reason}` };
  }

  const execCmd = testCommand(language, params.testId);
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
    return { status: "FAIL", evidenceRefs: [`${params.testId}:timeout`], detail: `Test "${params.testId}" timed out — flagged as FAIL.` };
  }

  const parsed = parseTestOutput(execute.stdout + "\n" + execute.stderr, language);
  if (!parsed.parsed) {
    return {
      status: "INCONCLUSIVE",
      evidenceRefs: [],
      detail: `Output for test "${params.testId}" was not parseable — cannot determine pass/fail.`,
    };
  }

  if (parsed.total === 0) {
    return { status: "INCONCLUSIVE", evidenceRefs: [], detail: `Test node "${params.testId}" was not found/collected.` };
  }

  if (parsed.failed === 0) {
    return { status: "PASS", evidenceRefs: [params.testId], detail: `Test "${params.testId}" passed.` };
  }

  return { status: "FAIL", evidenceRefs: [params.testId], detail: `Test "${params.testId}" failed.` };
}

module.exports = { check };
