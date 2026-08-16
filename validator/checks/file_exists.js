/**
 * validator/checks/file_exists.js
 * check kind: file_exists { path }
 *
 * Pure filesystem check against the already-cloned repo — no sandbox needed.
 */

const fs = require("fs");
const path = require("path");

/**
 * @param {{ path: string }} params
 * @param {{ repoPath: string }} ctx
 * @returns {Promise<{status: string, evidenceRefs: string[], detail: string}>}
 */
async function check(params, ctx) {
  if (!params || typeof params.path !== "string" || !params.path) {
    return { status: "INCONCLUSIVE", evidenceRefs: [], detail: "file_exists: missing required \"path\" parameter" };
  }

  const target = path.join(ctx.repoPath, params.path);

  // Refuse to check outside the repo (defense in depth against "../../etc/passwd").
  const relative = path.relative(ctx.repoPath, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return { status: "INCONCLUSIVE", evidenceRefs: [], detail: `file_exists: path "${params.path}" escapes the repository root` };
  }

  const exists = fs.existsSync(target) && fs.statSync(target).isFile();

  if (exists) {
    return { status: "PASS", evidenceRefs: [params.path], detail: `File "${params.path}" exists.` };
  }
  return { status: "FAIL", evidenceRefs: [], detail: `File "${params.path}" does not exist.` };
}

module.exports = { check };
