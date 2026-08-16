/**
 * validator/checks/http_route.js
 * check kind: http_route { method, route, expectStatus }
 *
 * Starts the discovered entry point in the background inside the sandbox,
 * then curls the target route on localhost. This all happens as one shell
 * command within the sandbox's EXECUTE phase (network egress denied) —
 * a request to localhost is loopback traffic, not "internet access", so it
 * is unaffected by allowInternetAccess: false.
 *
 * Requires ctx.entryPoint (from validator/pipeline/entryPointDiscovery.js,
 * reused unchanged) to know how to start the server and which port it uses.
 */

const { checkLockfileStatus } = require("./_shared");

const STATUS_MARKER = "VEYLO_HTTP_STATUS:";

/**
 * @param {{ method: string, route: string, expectStatus: number }} params
 * @param {{ repoPath: string, language: string, entryPoint: Object, sandbox: Function, logger: Object }} ctx
 */
async function check(params, ctx) {
  const { repoPath, language, entryPoint, sandbox, logger } = ctx;

  if (!params || !params.method || !params.route || typeof params.expectStatus !== "number") {
    return { status: "INCONCLUSIVE", evidenceRefs: [], detail: "http_route: missing required method/route/expectStatus parameters" };
  }

  if (!entryPoint || !entryPoint.entryCommand || !entryPoint.detectedPort) {
    return {
      status: "INCONCLUSIVE",
      evidenceRefs: [],
      detail: `No runnable server entry point with a detected port was found (framework: ${entryPoint ? entryPoint.framework : "none"}).`,
    };
  }

  const lock = checkLockfileStatus(repoPath, language);
  if (!lock.pinned) {
    return { status: "INCONCLUSIVE", evidenceRefs: [], detail: `Dependency resolution is unpinned: ${lock.reason}` };
  }

  const port = entryPoint.detectedPort;
  const url = `http://localhost:${port}${params.route}`;
  const execCmd = [
    `(${entryPoint.entryCommand} > /tmp/veylo_server.log 2>&1 &)`,
    "sleep 3",
    `STATUS=$(curl -s -o /tmp/veylo_resp.body -w "%{http_code}" -X ${params.method} "${url}" || echo "000")`,
    `echo "${STATUS_MARKER}$STATUS"`,
  ].join(" ; ");

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
    return {
      status: "FAIL",
      evidenceRefs: [`${params.method} ${params.route}:timeout`],
      detail: `Request to ${params.method} ${params.route} timed out — flagged as FAIL.`,
    };
  }

  const markerIndex = execute.stdout.lastIndexOf(STATUS_MARKER);
  if (markerIndex === -1) {
    return {
      status: "INCONCLUSIVE",
      evidenceRefs: [],
      detail: `Could not determine HTTP status for ${params.method} ${params.route} — output was not parseable.`,
    };
  }

  const statusStr = execute.stdout.slice(markerIndex + STATUS_MARKER.length).trim().split(/\s/)[0];
  const actualStatus = parseInt(statusStr, 10);

  if (!Number.isFinite(actualStatus) || actualStatus === 0) {
    return {
      status: "FAIL",
      evidenceRefs: [`${params.method} ${params.route}: connection failed`],
      detail: `${params.method} ${params.route} — server did not respond (entry point: ${entryPoint.entryCommand}).`,
    };
  }

  if (actualStatus === params.expectStatus) {
    return {
      status: "PASS",
      evidenceRefs: [`${params.method} ${params.route} -> ${actualStatus}`],
      detail: `${params.method} ${params.route} returned ${actualStatus} as expected.`,
    };
  }

  return {
    status: "FAIL",
    evidenceRefs: [`${params.method} ${params.route} -> ${actualStatus}`],
    detail: `${params.method} ${params.route} returned ${actualStatus}, expected ${params.expectStatus}.`,
  };
}

module.exports = { check };
