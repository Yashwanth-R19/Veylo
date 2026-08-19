/**
 * validator/core/repoFetch.js
 * ─────────────────────────────
 * Clones (or copies, for local paths) a repo at a specific commit into a
 * fresh temp directory. Extracted from validator/core/engine.js (Phase 1)
 * unchanged, so both the deterministic engine and the advisory layer
 * (validator/advisory/AdvisoryValidator.js, Phase 3) can fetch a submission
 * without duplicating this logic. No behavior change from the Phase 1
 * version — engine.js's own clone/cleanup contract per run is untouched.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { exec } = require("child_process");

function execPromise(cmd, opts) {
  return new Promise((resolve, reject) => {
    exec(cmd, opts, (error, stdout, stderr) => {
      if (error) reject(new Error(`${error.message}\n${stderr || ""}`));
      else resolve({ stdout, stderr });
    });
  });
}

/**
 * @param {string} repoUrl
 * @param {string} commitHash
 * @param {{log: Function}} logger
 * @returns {Promise<string>} absolute path to the fetched repo
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

  logger.log(`[repoFetch] repo prepared at commit ${commitHash || "(HEAD)"}`);
  return dest;
}

function cleanupRepo(repoPath, logger) {
  try {
    fs.rmSync(repoPath, { recursive: true, force: true });
  } catch (err) {
    logger.warn(`[repoFetch] cleanup failed: ${err.message}`);
  }
}

module.exports = { cloneRepo, cleanupRepo };
