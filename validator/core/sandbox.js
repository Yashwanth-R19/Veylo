/**
 * validator/core/sandbox.js
 * ──────────────────────────
 * Three sandbox backends, exactly:
 *
 *   e2b     Default when E2B_API_KEY is set. THIS IS THE DEPLOYED PATH.
 *           Two-phase: INSTALL with network access, then EXECUTE with
 *           allowInternetAccess revoked via sandbox.updateNetwork(). See
 *           docs/THREAT_MODEL.md for the reasoning and residual risk.
 *   docker  Local development only. Hardening flags below are the same ones
 *           from validator/agents/executionAgent.js's runInDocker, verbatim.
 *   none    Structured refusal, status INCONCLUSIVE. Never executes anything.
 *
 * The e2b API surface used here (Sandbox.create, sandbox.commands.run,
 * sandbox.files.write, sandbox.updateNetwork, sandbox.kill, TimeoutError,
 * CommandExitError) was verified against the actual shipped type
 * definitions in node_modules/e2b/dist/index.d.ts (package "e2b"), not
 * guessed from documentation summaries.
 */

const { execSync, exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const MAX_OUTPUT_BYTES = 1024 * 1024;
const E2B_CREATE_MAX_ATTEMPTS = 3; // initial attempt + 2 retries

function isDockerAvailable() {
  try {
    execSync("docker info", { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Which backend will be used, based on environment. e2b takes priority
 * whenever configured, since it is the deployed path.
 */
function selectBackend() {
  if (process.env.E2B_API_KEY) return "e2b";
  if (isDockerAvailable()) return "docker";
  return "none";
}

/**
 * Recursively and deterministically collect all files under repoPath.
 * Sorted at every directory level so upload order never varies between runs.
 */
function collectFiles(repoPath) {
  const EXCLUDE_DIRS = new Set([".git", "node_modules", "__pycache__", "venv", ".venv"]);
  const files = [];

  function walk(dir) {
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (const entry of entries) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const relPath = path.relative(repoPath, full).split(path.sep).join("/");
        files.push({ relPath, data: fs.readFileSync(full, "utf8") });
      }
    }
  }

  walk(repoPath);
  return files;
}

function truncate(s) {
  if (!s) return "";
  const buf = Buffer.from(s, "utf8");
  return buf.length > MAX_OUTPUT_BYTES
    ? buf.slice(0, MAX_OUTPUT_BYTES).toString("utf8") + "\n...[truncated]"
    : s;
}

// ─── e2b backend — THE DEPLOYED PATH ─────────────────────────────────

async function runCommandE2B(sandbox, cmd, timeoutMs, logger, phase) {
  const { TimeoutError, CommandExitError } = require("e2b");
  try {
    const res = await sandbox.commands.run(cmd, { cwd: "/workspace", timeoutMs: timeoutMs || 120_000 });
    return { exitCode: res.exitCode, stdout: truncate(res.stdout), stderr: truncate(res.stderr), timedOut: false };
  } catch (err) {
    if (err instanceof CommandExitError) {
      // Non-zero exit is a normal, expected result (e.g. failing tests) — not a sandbox failure.
      return { exitCode: err.exitCode, stdout: truncate(err.stdout), stderr: truncate(err.stderr), timedOut: false };
    }
    if (err instanceof TimeoutError) {
      logger.warn(`[sandbox:e2b] ${phase} phase timed out: ${err.message}`);
      return { exitCode: null, stdout: "", stderr: err.message, timedOut: true };
    }
    throw err;
  }
}

async function runE2B({ repoPath, installCmd, execCmd, timeoutMs, logger }) {
  const { Sandbox } = require("e2b");
  const files = collectFiles(repoPath).map((f) => ({ path: `/workspace/${f.relPath}`, data: f.data }));

  let sandbox = null;
  let lastError = null;
  for (let attempt = 1; attempt <= E2B_CREATE_MAX_ATTEMPTS && !sandbox; attempt++) {
    try {
      sandbox = await Sandbox.create({
        apiKey: process.env.E2B_API_KEY,
        timeoutMs: timeoutMs || 300_000,
        allowInternetAccess: true, // Phase 1 — INSTALL: network permitted
      });
    } catch (err) {
      lastError = err;
      logger.warn(`[sandbox:e2b] create attempt ${attempt}/${E2B_CREATE_MAX_ATTEMPTS} failed: ${err.message}`);
    }
  }

  if (!sandbox) {
    return {
      backend: "e2b",
      status: "INCONCLUSIVE",
      reason: `E2B sandbox could not be created after ${E2B_CREATE_MAX_ATTEMPTS} attempts: ${lastError ? lastError.message : "unknown error"}`,
    };
  }

  try {
    await sandbox.files.write(files);

    let install;
    if (installCmd) {
      install = await runCommandE2B(sandbox, installCmd, timeoutMs, logger, "install");
    }

    // Phase 2 — EXECUTE: revoke internet access before running submitted/test code.
    await sandbox.updateNetwork({ allowInternetAccess: false });

    const execute = await runCommandE2B(sandbox, execCmd, timeoutMs, logger, "execute");

    return { backend: "e2b", status: "ok", install, execute };
  } finally {
    await sandbox.kill().catch((err) => logger.warn(`[sandbox:e2b] kill failed: ${err.message}`));
  }
}

// ─── docker backend — local development only ─────────────────────────
//
// Hardening flags reused verbatim from validator/agents/executionAgent.js's
// runInDocker: --network=none, --memory=512m, --cpus=1, --read-only,
// --pids-limit=64, --security-opt=no-new-privileges, --cap-drop=ALL,
// ulimit nproc=64, ulimit fsize=10MB, tmpfs /tmp noexec.
//
// Unlike e2b, this backend is single-phase: network is denied for the
// entire run, including any installCmd. This matches executionAgent.js's
// historical behavior (network was always denied there too) and the
// repo mount is read-only, so installCmd will predictably fail unless
// dependencies are already vendored — a known, honest limitation of the
// local-dev-only path, not something silently patched over here.

function runDocker({ repoPath, installCmd, execCmd, timeoutMs, logger, language }) {
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
      images: { default: "ubuntu:22.04" },
      customImage: null,
      maxOutputBytes: 1024 * 1024,
    };
  }

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

  const imageName = customImage || images[language] || images.default || "ubuntu:22.04";
  const safeRepoPath = repoPath.replace(/\\/g, "/");
  const fullCmd = installCmd ? `${installCmd} && ${execCmd}` : execCmd;

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
    "--tmpfs /tmp:rw,noexec,nosuid,size=100m",
    `-v "${safeRepoPath}":/workspace:ro`,
    "-w /workspace",
    imageName,
    `sh -c "${fullCmd.replace(/"/g, '\\"')}"`,
  ].join(" ");

  return new Promise((resolve) => {
    const timeoutMs2 = timeoutMs || timeout * 1000;

    const child = exec(dockerCmd, { timeout: timeoutMs2, maxBuffer: maxOutputBytes }, (error, stdout, stderr) => {
      resolve({
        backend: "docker",
        status: "ok",
        execute: {
          exitCode: error && typeof error.code === "number" ? error.code : error ? 1 : 0,
          stdout: truncate(stdout),
          stderr: truncate(stderr),
          timedOut: !!(error && error.killed),
        },
      });
    });

    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // already exited
      }
    }, timeoutMs2 + 5000);
  }).then((result) => {
    logger.log(`[sandbox:docker] exitCode=${result.execute.exitCode} timedOut=${result.execute.timedOut}`);
    return result;
  });
}

// ─── none backend — structured refusal, never executes ───────────────

async function runNone({ logger }) {
  const reason =
    "No sandbox backend available: E2B_API_KEY is not set and Docker is not reachable " +
    "(`docker info` failed). Refusing to execute submitted code on the host.";
  logger.warn(`[sandbox:none] ${reason}`);
  return { backend: "none", status: "INCONCLUSIVE", reason };
}

// ─── dispatcher ────────────────────────────────────────────────────

/**
 * Run a two-phase (install-with-network, then execute-without-network) job
 * in a sandbox. Deliverable-agnostic: callers supply shell commands and get
 * back raw exit codes / output — check-kind-specific PASS/FAIL/INCONCLUSIVE
 * interpretation happens in validator/checks/, not here.
 *
 * @param {Object} params
 * @param {string} params.repoPath      Local path to the repo to upload/mount
 * @param {string} [params.installCmd]  Dependency install command (network allowed)
 * @param {string} params.execCmd       Test/check command (network denied)
 * @param {string} [params.language]    "python" | "javascript" | "typescript" — selects the
 *                                      docker image from config/dockerConfig.js; ignored by e2b
 * @param {number} [params.timeoutMs]
 * @param {Object} [params.logger]      Defaults to console
 * @returns {Promise<{backend: string, status: 'ok'|'INCONCLUSIVE', reason?: string, install?: object, execute?: object}>}
 */
async function runInSandbox({ repoPath, installCmd, execCmd, language, timeoutMs, logger = console } = {}) {
  if (!execCmd) throw new Error("runInSandbox: execCmd is required");

  const backend = selectBackend();
  logger.log(`[sandbox] selected backend: ${backend}`);

  switch (backend) {
    case "e2b":
      return runE2B({ repoPath, installCmd, execCmd, timeoutMs, logger });
    case "docker":
      return runDocker({ repoPath, installCmd, execCmd, timeoutMs, logger, language });
    default:
      return runNone({ logger });
  }
}

module.exports = { runInSandbox, selectBackend };
