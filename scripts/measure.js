/**
 * scripts/measure.js
 * ─────────────────────
 * Phase 1, Session 2, Part B — the determinism and accuracy harness.
 *
 * For every corpus/<name>/ repo (spec.json + expected.json + repo/):
 *   - Runs validator/core/engine.js's runEngine() 5 times.
 *   - DETERMINISM: compares deterministicHash across the 5 runs. Any
 *     variance is reported with the exact diff between the two result
 *     documents (which criterion, expected vs. actual status/detail).
 *   - ACCURACY: the first of the 5 runs is compared, per criterion, against
 *     corpus/<name>/expected.json. One real run, not a second one spent
 *     solely on accuracy — the plan requires "run every corpus repo once"
 *     for accuracy, and reusing run #1 of the determinism set satisfies
 *     that without discarding a real result.
 *   - SANDBOX FAILURES: ctx.sandbox is wrapped so every call into
 *     validator/core/sandbox.js's runInSandbox is observed. A "failure" is
 *     any invocation where the sandbox layer itself did not reach status
 *     "ok" (backend unavailable, sandbox creation failed) — NOT a normal
 *     FAIL/INCONCLUSIVE verdict produced from real command output.
 *   - LATENCY: wall-clock ms for every runEngine() call (100 total: 20
 *     repos x 5 runs), p50/p95 computed over that full set.
 *
 * Concurrency: repos run concurrently (bounded pool), but the 5 runs of a
 * given repo run sequentially within it — determinism is about repeated
 * runs of the SAME repo, and sequencing them avoids any doubt about
 * cross-run interference.
 *
 * Usage: node scripts/measure.js
 * Requires E2B_API_KEY (or local Docker) — see validator/core/sandbox.js.
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");

const { runEngine } = require("../validator/core/engine");
const { runInSandbox } = require("../validator/core/sandbox");

const CORPUS_DIR = path.join(__dirname, "..", "corpus");
const RUNS_PER_REPO = 5;
const CONCURRENCY = 5;

// ─── corpus discovery ──────────────────────────────────────────────────

function loadCorpus() {
  const names = fs
    .readdirSync(CORPUS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  return names.map((name) => {
    const dir = path.join(CORPUS_DIR, name);
    const spec = JSON.parse(fs.readFileSync(path.join(dir, "spec.json"), "utf8"));
    const expected = JSON.parse(fs.readFileSync(path.join(dir, "expected.json"), "utf8"));
    // spec.json stores repoUrl relative to the repo root ("corpus/<name>/repo") —
    // resolve to an absolute path so engine.js's cloneRepo() (fs.cpSync branch) finds it.
    spec.repoUrl = path.join(__dirname, "..", spec.repoUrl);
    return { name, spec, expected: expected.results };
  });
}

// ─── sandbox instrumentation ───────────────────────────────────────────

function makeInstrumentedSandbox(sandboxLog) {
  return async function instrumentedSandbox(params) {
    const start = Date.now();
    const result = await runInSandbox(params);
    sandboxLog.push({
      backend: result.backend,
      ok: result.status === "ok",
      reason: result.status === "ok" ? null : result.reason,
      durationMs: Date.now() - start,
    });
    return result;
  };
}

// ─── one repo, one run ─────────────────────────────────────────────────

async function runOnce(repo, sandboxLog) {
  const start = Date.now();
  const ctx = { logger: { log: () => {}, warn: () => {}, error: () => {} }, sandbox: makeInstrumentedSandbox(sandboxLog) };
  const { deterministic, deterministicHash } = await runEngine(repo.spec, ctx);
  return { deterministic, deterministicHash, latencyMs: Date.now() - start };
}

// ─── determinism: compare 5 runs, diff on mismatch ─────────────────────

function diffResults(baseline, other) {
  const diffs = [];
  const byIndex = new Map(other.results.map((r) => [r.index, r]));
  for (const baseResult of baseline.results) {
    const otherResult = byIndex.get(baseResult.index);
    const a = JSON.stringify(baseResult);
    const b = JSON.stringify(otherResult);
    if (a !== b) {
      diffs.push({ index: baseResult.index, baseline: baseResult, other: otherResult });
    }
  }
  return diffs;
}

// ─── accuracy: compare run #1 against expected.json ────────────────────

function scoreAccuracy(repo, actualDeterministic, confusion) {
  const actualByIndex = new Map(actualDeterministic.results.map((r) => [r.index, r]));
  const rows = [];
  for (const exp of repo.expected) {
    const criterion = repo.spec.criteria.find((c) => c.index === exp.index);
    const kind = criterion ? criterion.check.kind : "unknown";
    const actual = actualByIndex.get(exp.index);
    const actualStatus = actual ? actual.status : "MISSING";
    const match = actualStatus === exp.status;

    if (!confusion[kind]) confusion[kind] = {};
    if (!confusion[kind][exp.status]) confusion[kind][exp.status] = {};
    confusion[kind][exp.status][actualStatus] = (confusion[kind][exp.status][actualStatus] || 0) + 1;

    rows.push({ index: exp.index, kind, expected: exp.status, actual: actualStatus, match });
  }
  return rows;
}

// ─── concurrency-bounded pool ───────────────────────────────────────────

async function runPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

// ─── stats ───────────────────────────────────────────────────────────

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

// ─── main ────────────────────────────────────────────────────────────

async function main() {
  const corpus = loadCorpus();
  console.log(`Loaded ${corpus.length} corpus repos.\n`);

  const sandboxLog = [];
  const allLatencies = [];
  const confusion = {};
  const determinismFailures = [];
  const accuracyRows = [];
  const perRepoReport = [];

  await runPool(corpus, CONCURRENCY, async (repo) => {
    console.log(`[${repo.name}] starting ${RUNS_PER_REPO} runs...`);
    const runs = [];
    for (let i = 0; i < RUNS_PER_REPO; i++) {
      try {
        const run = await runOnce(repo, sandboxLog);
        runs.push(run);
        allLatencies.push(run.latencyMs);
      } catch (err) {
        runs.push({ error: err.message });
        console.error(`[${repo.name}] run ${i + 1} threw: ${err.message}`);
      }
    }

    const hashes = runs.map((r) => r.deterministicHash);
    const uniqueHashes = new Set(hashes.filter(Boolean));
    const deterministic = uniqueHashes.size <= 1 && !runs.some((r) => r.error);

    if (!deterministic) {
      const baseline = runs[0];
      for (let i = 1; i < runs.length; i++) {
        if (runs[i].error || runs[i].deterministicHash !== baseline.deterministicHash) {
          const diffs = runs[i].error ? [{ error: runs[i].error }] : diffResults(baseline.deterministic, runs[i].deterministic);
          determinismFailures.push({ repo: repo.name, run: i + 1, baselineHash: baseline.deterministicHash, otherHash: runs[i].deterministicHash, diffs });
        }
      }
    }

    // Accuracy from run #1 (or the first successful run, if run #1 threw).
    const firstOk = runs.find((r) => !r.error);
    if (firstOk) {
      const rows = scoreAccuracy(repo, firstOk.deterministic, confusion);
      accuracyRows.push(...rows.map((r) => ({ repo: repo.name, ...r })));
    }

    perRepoReport.push({
      name: repo.name,
      deterministic,
      hashes,
      accuracyMatches: firstOk ? scoreAccuracy(repo, firstOk.deterministic, {}).filter((r) => r.match).length : 0,
      accuracyTotal: repo.expected.length,
    });

    console.log(`[${repo.name}] done. deterministic=${deterministic} hashes=${[...uniqueHashes].map((h) => h.slice(0, 10)).join(",")}`);
  });

  // ─── determinism rate ───────────────────────────────────────────────
  const determinismRate = perRepoReport.filter((r) => r.deterministic).length / perRepoReport.length;

  // ─── accuracy ────────────────────────────────────────────────────────
  const accuracyMatches = accuracyRows.filter((r) => r.match).length;
  const accuracyRate = accuracyRows.length > 0 ? accuracyMatches / accuracyRows.length : null;

  // ─── sandbox failure rate ────────────────────────────────────────────
  const sandboxFailures = sandboxLog.filter((s) => !s.ok);
  const sandboxFailureRate = sandboxLog.length > 0 ? sandboxFailures.length / sandboxLog.length : null;

  // ─── latency ─────────────────────────────────────────────────────────
  const sortedLatencies = [...allLatencies].sort((a, b) => a - b);
  const p50 = percentile(sortedLatencies, 50);
  const p95 = percentile(sortedLatencies, 95);

  const report = {
    generatedAt: new Date().toISOString(),
    corpusSize: corpus.length,
    runsPerRepo: RUNS_PER_REPO,
    determinism: {
      rate: determinismRate,
      failures: determinismFailures,
      perRepo: perRepoReport.map((r) => ({ name: r.name, deterministic: r.deterministic, hashes: r.hashes })),
    },
    accuracy: {
      rate: accuracyRate,
      totalCriteria: accuracyRows.length,
      matches: accuracyMatches,
      misses: accuracyRows.filter((r) => !r.match),
      confusionMatrix: confusion,
    },
    sandbox: {
      totalInvocations: sandboxLog.length,
      failures: sandboxFailures.length,
      failureRate: sandboxFailureRate,
      failureDetails: sandboxFailures,
    },
    latency: {
      unit: "ms",
      count: allLatencies.length,
      p50,
      p95,
      min: sortedLatencies[0] ?? null,
      max: sortedLatencies[sortedLatencies.length - 1] ?? null,
    },
  };

  const outPath = path.join(__dirname, "..", "docs", "measure-results.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");

  console.log("\n" + "=".repeat(70));
  console.log("RESULTS");
  console.log("=".repeat(70));
  console.log(`Determinism rate       : ${(determinismRate * 100).toFixed(1)}% (target 100%)`);
  console.log(`Deterministic accuracy : ${accuracyRate === null ? "n/a" : (accuracyRate * 100).toFixed(1) + "%"} (target >= 90%)`);
  console.log(`Sandbox failure rate   : ${sandboxFailureRate === null ? "n/a" : (sandboxFailureRate * 100).toFixed(1) + "%"} (target < 5%)`);
  console.log(`p50 / p95 latency      : ${p50}ms / ${p95}ms`);
  console.log(`\nFull report written to ${outPath}`);

  if (determinismFailures.length > 0) {
    console.log(`\n${determinismFailures.length} determinism failure(s):`);
    for (const f of determinismFailures) {
      console.log(`  - ${f.repo} run ${f.run}: ${f.baselineHash} vs ${f.otherHash}`);
      for (const d of f.diffs) console.log(`      ${JSON.stringify(d)}`);
    }
  }
}

main().catch((err) => {
  console.error("measure.js failed:", err);
  process.exit(1);
});
