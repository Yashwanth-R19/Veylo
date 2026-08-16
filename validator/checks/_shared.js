/**
 * validator/checks/_shared.js
 * ─────────────────────────────
 * Helpers shared by the five check kinds: dependency-pinning verification,
 * deterministic test-runner commands, and test-output parsing.
 *
 * Determinism sources handled here (see engine.js header for the full list):
 *   - unpinned dependency resolution → INCONCLUSIVE (never PASS on a moving target)
 *   - test runner ordering pinned: `pytest -p no:randomly`, `jest --runInBand`
 *   - unparseable test output → INCONCLUSIVE, never PASS
 */

const fs = require("fs");
const path = require("path");

/**
 * A repo's dependencies must resolve to a pinned, reproducible set before any
 * check that installs and runs them. Presence of a lockfile is treated as
 * proof of pinning (lockfiles are inherently pinned); a bare requirements.txt
 * is only accepted if every entry is version-pinned with `==`.
 *
 * @returns {{ pinned: boolean, installCmd: string|null, reason?: string }}
 */
function checkLockfileStatus(repoPath, language) {
  if (language === "python") {
    if (fs.existsSync(path.join(repoPath, "poetry.lock"))) {
      return { pinned: true, installCmd: "pip install poetry --quiet && poetry install --no-interaction" };
    }
    if (fs.existsSync(path.join(repoPath, "Pipfile.lock"))) {
      return { pinned: true, installCmd: "pip install pipenv --quiet && pipenv install --deploy --ignore-pipfile" };
    }
    const reqPath = path.join(repoPath, "requirements.txt");
    if (fs.existsSync(reqPath)) {
      const lines = fs
        .readFileSync(reqPath, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"));
      const unpinned = lines.filter((l) => !/==/.test(l));
      if (unpinned.length > 0) {
        return {
          pinned: false,
          installCmd: null,
          reason: `requirements.txt has ${unpinned.length} unpinned entr${unpinned.length === 1 ? "y" : "ies"} (no "=="): ${unpinned.slice(0, 5).join(", ")}`,
        };
      }
      return { pinned: true, installCmd: "pip install -r requirements.txt --quiet" };
    }
    // No manifest at all — nothing to pin.
    return { pinned: true, installCmd: null };
  }

  if (language === "javascript" || language === "typescript") {
    const hasManifest = fs.existsSync(path.join(repoPath, "package.json"));
    const lockfiles = ["package-lock.json", "yarn.lock", "pnpm-lock.yaml"];
    const lockfile = lockfiles.find((f) => fs.existsSync(path.join(repoPath, f)));
    if (!hasManifest) {
      return { pinned: true, installCmd: null };
    }
    if (!lockfile) {
      return {
        pinned: false,
        installCmd: null,
        reason: "package.json present but no lockfile (package-lock.json / yarn.lock / pnpm-lock.yaml) — dependency resolution is unpinned",
      };
    }
    const installCmd =
      lockfile === "package-lock.json"
        ? "npm ci --silent"
        : lockfile === "yarn.lock"
        ? "yarn install --frozen-lockfile --silent"
        : "pnpm install --frozen-lockfile --silent";
    return { pinned: true, installCmd };
  }

  return { pinned: false, installCmd: null, reason: `Unsupported language "${language}" — cannot verify pinning` };
}

/**
 * Deterministic test-suite command: pins test order so re-runs are
 * bit-identical (pytest's random-order plugin, jest's parallel worker
 * scheduling).
 */
function testSuiteCommand(language) {
  if (language === "python") return "python -m pytest -p no:randomly -v";
  if (language === "javascript" || language === "typescript") return "npx jest --runInBand --verbose";
  return null;
}

/**
 * Deterministic single-test command for a given node id.
 * Python: pytest node id, e.g. "tests/test_auth.py::test_reset".
 * JS/TS: either a file path, or "<file>::<test name>" (our own convention,
 * split into a jest `-t` name filter since jest has no single node-id syntax).
 */
function testCommand(language, testId) {
  if (language === "python") {
    return `python -m pytest -p no:randomly -v "${testId}"`;
  }
  if (language === "javascript" || language === "typescript") {
    const sepIndex = testId.indexOf("::");
    if (sepIndex === -1) {
      return `npx jest --runInBand --verbose "${testId}"`;
    }
    const file = testId.slice(0, sepIndex);
    const name = testId.slice(sepIndex + 2);
    return `npx jest --runInBand --verbose "${file}" -t "${name}"`;
  }
  return null;
}

/**
 * Parse pytest/jest/mocha output for pass/fail counts.
 * Returns parsed: false when nothing recognizable was found — callers must
 * treat that as INCONCLUSIVE, never PASS.
 */
function parseTestOutput(output, language) {
  const text = output || "";

  if (language === "python") {
    const passedMatch = text.match(/(\d+) passed/);
    const failedMatch = text.match(/(\d+) failed/);
    const errorMatch = text.match(/(\d+) error/);
    if (!passedMatch && !failedMatch && !errorMatch) {
      return { parsed: false, passed: 0, failed: 0, total: 0 };
    }
    const passed = passedMatch ? parseInt(passedMatch[1], 10) : 0;
    const failed = (failedMatch ? parseInt(failedMatch[1], 10) : 0) + (errorMatch ? parseInt(errorMatch[1], 10) : 0);
    return { parsed: true, passed, failed, total: passed + failed };
  }

  if (language === "javascript" || language === "typescript") {
    const jestMatch = text.match(/Tests:\s+(?:(\d+) failed, )?(?:(\d+) skipped, )?(\d+) passed, (\d+) total/);
    if (jestMatch) {
      const failed = jestMatch[1] ? parseInt(jestMatch[1], 10) : 0;
      const passed = parseInt(jestMatch[3], 10);
      const total = parseInt(jestMatch[4], 10);
      return { parsed: true, passed, failed, total };
    }
    const passMatch = text.match(/(\d+) passing/);
    const failMatch = text.match(/(\d+) failing/);
    if (passMatch || failMatch) {
      const passed = passMatch ? parseInt(passMatch[1], 10) : 0;
      const failed = failMatch ? parseInt(failMatch[1], 10) : 0;
      return { parsed: true, passed, failed, total: passed + failed };
    }
    return { parsed: false, passed: 0, failed: 0, total: 0 };
  }

  return { parsed: false, passed: 0, failed: 0, total: 0 };
}

module.exports = { checkLockfileStatus, testSuiteCommand, testCommand, parseTestOutput };
