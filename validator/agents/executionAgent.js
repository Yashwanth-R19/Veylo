/**
 * executionAgent.js
 * ─────────────────
 * Layer 2 — Sandboxed Test Execution
 *
 * Runs the AI-generated test suite against the submitted repo.
 * Tries Docker first, falls back to local execution if Docker is unavailable.
 *
 * Security hardening:
 *   --network=none, --memory=512m, --cpus=1, --read-only,
 *   --pids-limit=64, --security-opt=no-new-privileges, --cap-drop=ALL,
 *   ulimit nproc=64, ulimit fsize=10MB
 *
 * Returns test pass/fail counts and runtime output.
 */

const { exec, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

let dockerConfig;
try {
  dockerConfig = require("../../config/dockerConfig");
} catch {
  dockerConfig = {
    memoryLimit: "512m",
    cpuLimit: "1",
    timeout: 30,
    networkMode: "none",
    pidsLimit: 64,
    securityOpt: "no-new-privileges",
    capDrop: "ALL",
    images: {
      python: "python:3.11-slim",
      javascript: "node:18-slim",
      typescript: "node:18-slim",
      default: "ubuntu:22.04",
    },
    customImage: null,
    maxOutputBytes: 1024 * 1024,
  };
}

/**
 * Check if Docker is available on this system.
 */
function isDockerAvailable() {
  try {
    execSync("docker info", { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Execute test suite — Docker if available, otherwise local.
 *
 * @param {string} repoPath      - Absolute path to cloned repo on host
 * @param {object} testSuite     - { language, testCommand, testFile?, testCode?, entryPoint? }
 * @returns {{ executionScore: number, testsPassed: number, testsTotal: number, runtimeOutput: string }}
 */
function writeGeneratedTest(repoPath, testSuite) {
  if (!testSuite.testFile || !testSuite.testCode) return;

  const fullPath = path.join(repoPath, testSuite.testFile);
  const dir = path.dirname(fullPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(fullPath, testSuite.testCode);
}

async function executeTests(repoPath, testSuite) {
  writeGeneratedTest(repoPath, testSuite);
  const language = testSuite.language || "python";
  const testCommand = testSuite.testCommand || getDefaultTestCommand(language);

  if (isDockerAvailable()) {
    console.log("[ExecutionAgent] Running tests in Docker sandbox (hardened)...");
    return runInDocker(repoPath, testCommand, language);
  } else {
    throw new Error(
      "[ExecutionAgent] Docker unavailable. Host execution of submitted code has been permanently removed for security (see docs/CURRENT_STATE.md §3). " +
      "This pipeline is deprecated — use validator/core/sandbox.js, which never falls back to host execution."
    );
  }
}

/**
 * Run tests inside a hardened Docker container.
 *
 * Security flags:
 *   --network=none         No internet access
 *   --memory=512m          RAM limit
 *   --cpus=1               CPU limit
 *   --read-only            Immutable root filesystem
 *   --pids-limit=64        Prevent fork bombs
 *   --security-opt=...     Prevent privilege escalation
 *   --cap-drop=ALL         Drop all Linux capabilities
 *   --ulimit nproc=64      Process limit
 *   --ulimit fsize=10M     Max file size
 */
function runInDocker(repoPath, testCommand, language) {
  const {
    memoryLimit = "512m",
    cpuLimit = "1",
    timeout = 30,
    networkMode = "none",
    pidsLimit = 64,
    securityOpt = "no-new-privileges",
    capDrop = "ALL",
    images = {},
    customImage,
    maxOutputBytes = 1024 * 1024,
  } = dockerConfig;

  // Prefer custom sandbox image, fall back to language-specific image
  const imageName = customImage || images[language] || images.default || getDockerImage(language);

  // Sanitize repoPath for volume mount (escape spaces)
  const safeRepoPath = repoPath.replace(/\\/g, "/");

  const dockerCmd = [
    "docker run --rm",
    `--network=${networkMode}`,
    `--memory=${memoryLimit}`,
    `--cpus=${cpuLimit}`,
    "--read-only",
    `--pids-limit=${pidsLimit}`,
    `--security-opt=${securityOpt}`,
    `--cap-drop=${capDrop}`,
    "--ulimit nproc=64:64",
    "--ulimit fsize=10485760:10485760",
    '--tmpfs /tmp:rw,noexec,nosuid,size=100m',
    `-v "${safeRepoPath}":/workspace:ro`,
    `-w /workspace`,
    imageName,
    `sh -c "${testCommand}"`,
  ].join(" ");

  return new Promise((resolve) => {
    const timeoutMs = timeout * 1000;

    const child = exec(dockerCmd, { timeout: timeoutMs, maxBuffer: maxOutputBytes }, (error, stdout, stderr) => {
      // Atomic output capture — combine after both streams complete
      const output = (stdout || "") + "\n" + (stderr || "");
      const { passed, total } = parseTestOutput(output, language);
      const executionScore = total > 0 ? Math.round((passed / total) * 100) : 0;

      resolve({
        executionScore,
        testsPassed: passed,
        testsTotal: Math.max(total, 1),
        runtimeOutput: output.slice(0, 5000),
        timedOut: error?.killed || false,
        exitCode: error?.code || 0,
      });
    });

    // Safety: force-kill if child hangs past timeout
    setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { }
    }, timeoutMs + 5000);
  });
}

/**
 * Parse test runner output to extract pass/fail counts.
 * Supports pytest, jest, mocha, and tap style output.
 */
function parseTestOutput(output, language) {
  let passed = 0;
  let total = 0;

  if (language === "python") {
    // pytest: "5 passed, 2 failed"
    const pytestMatch = output.match(/(\d+) passed/);
    const failedMatch = output.match(/(\d+) failed/);
    const errorMatch = output.match(/(\d+) error/);
    passed = pytestMatch ? parseInt(pytestMatch[1]) : 0;
    const failed = failedMatch ? parseInt(failedMatch[1]) : 0;
    const errors = errorMatch ? parseInt(errorMatch[1]) : 0;
    total = passed + failed + errors;
  } else if (language === "javascript" || language === "typescript") {
    // Jest: "Tests: 3 passed, 5 total"
    const jestMatch = output.match(/Tests:\s+(\d+) passed.*?(\d+) total/);
    if (jestMatch) {
      passed = parseInt(jestMatch[1]);
      total = parseInt(jestMatch[2]);
    } else {
      // Mocha: "5 passing" / "2 failing"
      const passMatch = output.match(/(\d+) passing/);
      const failMatch = output.match(/(\d+) failing/);
      passed = passMatch ? parseInt(passMatch[1]) : 0;
      const failed = failMatch ? parseInt(failMatch[1]) : 0;
      total = passed + failed;
    }
  }

  return { passed, total };
}

function getDefaultTestCommand(language) {
  switch (language) {
    case "python":
      return "python -m pytest -v 2>&1";
    case "javascript":
    case "typescript":
      return "npm test 2>&1";
    default:
      return "echo 'Unsupported language'";
  }
}

function getDockerImage(language) {
  switch (language) {
    case "python": return "python:3.11-slim";
    case "javascript": return "node:18-slim";
    case "typescript": return "node:18-slim";
    default: return "ubuntu:22.04";
  }
}

module.exports = { executeTests };
