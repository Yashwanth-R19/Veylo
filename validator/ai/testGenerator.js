/**
 * validator/ai/testGenerator.js
 * ────────────────────────────────
 * Converts a plain-language delivery description into a structured criteria
 * list in the VEYLO_BUILD_PLAN_REVISED.md §6 format, for the criteria-drafting
 * assistant (Phase 3, Part D — POST /criteria/draft).
 *
 * Adapted from the Phase 0/1 version of this file (which generated an
 * old Job-shaped test suite for the now-deleted scoring pipeline) rather than
 * rewritten from scratch, per this session's explicit instruction. The LLM
 * call and JSON-parsing shape are the same idea; the output shape and the
 * failure behavior are not:
 *   - Output is now a §6 criteria array (index/method/text/check), not the
 *     old test_cases/testCommand/testFile shape — the old shape belonged to
 *     the weighted-scoring system Phase 1 deleted.
 *   - The old getDefaultTestSuite() fallback fabricated a plausible-looking
 *     "success" suite whenever the LLM failed. That is exactly the kind of
 *     fabricated response rule 5 forbids for something a client is about to
 *     sign, so it is NOT carried forward: a provider failure here throws,
 *     and the caller (backend/routes/criteria.js) reports it as a real
 *     failure, never a silently-degraded draft.
 *
 * This module drafts only. It never writes to the database and never calls
 * the chain — the client always edits and approves before anything is
 * signed (see backend/routes/criteria.js).
 */

const modelClient = require("./modelClient");
const { CHECKS } = require("../checks");

const CHECK_KINDS = Object.keys(CHECKS); // file_exists, test_passes, test_suite_passes, http_route, lint_clean

const CHECK_FIELDS = {
  file_exists: ["path"],
  test_passes: ["testId"],
  test_suite_passes: [],
  http_route: ["method", "route", "expectStatus"],
  lint_clean: ["maxErrors"],
};

function buildPrompt(description) {
  return `You are helping a client draft machine-checkable acceptance criteria for a software delivery contract. You propose a draft only — you have no authority over the outcome, and the client reviews and edits every criterion before anything is signed.

## Job description
"""
${description}
"""

## Output format
Respond ONLY with valid JSON (no markdown fences, no extra text):
{
  "criteria": [
    {
      "index": 0,
      "method": "DETERMINISTIC" | "SEMANTIC",
      "text": "a single, testable acceptance criterion, in plain English",
      "check": { "kind": "file_exists" | "test_passes" | "test_suite_passes" | "http_route" | "lint_clean", "...kind-specific fields..." }
    }
  ]
}

Rules:
- "check" is present ONLY when method is "DETERMINISTIC", and its "kind" must be exactly one of these five, with exactly these fields:
    file_exists       { "kind": "file_exists", "path": string }
    test_passes       { "kind": "test_passes", "testId": string }
    test_suite_passes { "kind": "test_suite_passes" }
    http_route        { "kind": "http_route", "method": string, "route": string, "expectStatus": number }
    lint_clean        { "kind": "lint_clean", "maxErrors": number }
- Use "DETERMINISTIC" only when the requirement genuinely reduces to one of those five checks. If it does not, use "SEMANTIC" and omit "check" entirely — never force a fit.
- "index" starts at 0 and increases by 1 per criterion, in the array's own order.
- Propose between 3 and 8 criteria. Each one specific and single-purpose, not a restatement of the whole description.`;
}

/**
 * @param {string} raw
 * @returns {{criteria: Array}}
 */
function parseDraft(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Could not find a JSON object in the model's response");
    parsed = JSON.parse(match[0]);
  }
  if (!Array.isArray(parsed.criteria)) {
    throw new Error('Model response is missing a "criteria" array');
  }
  return parsed;
}

/**
 * Validates and normalizes one drafted criterion. A DETERMINISTIC criterion
 * whose check doesn't match a real kind/field set is downgraded to SEMANTIC
 * (flagged, not dropped) rather than shipped with an invalid check spec that
 * would fail every time the engine tried to run it.
 *
 * @returns {{ criterion: object, downgraded: boolean }}
 */
function normalizeCriterion(raw, index) {
  const text = typeof raw.text === "string" && raw.text.trim() ? raw.text.trim() : `(criterion ${index} — model gave no text)`;

  if (raw.method !== "DETERMINISTIC") {
    return { criterion: { index, method: "SEMANTIC", text }, downgraded: false };
  }

  const kind = raw.check && raw.check.kind;
  const expectedFields = CHECK_FIELDS[kind];
  if (!CHECK_KINDS.includes(kind) || !expectedFields) {
    return { criterion: { index, method: "SEMANTIC", text }, downgraded: true };
  }

  const missing = expectedFields.filter((f) => raw.check[f] === undefined || raw.check[f] === null || raw.check[f] === "");
  if (missing.length > 0) {
    return { criterion: { index, method: "SEMANTIC", text }, downgraded: true };
  }

  const check = { kind };
  for (const f of expectedFields) check[f] = raw.check[f];
  return { criterion: { index, method: "DETERMINISTIC", text, check }, downgraded: false };
}

/**
 * Draft a §6 criteria list from a plain-language description.
 *
 * @param {string} description
 * @returns {Promise<{ criteria: object[], downgradedIndices: number[], tokens: object, provider: string }>}
 */
async function draftCriteria(description) {
  const { text, tokens, provider } = await modelClient.generate(buildPrompt(description), { json: true });
  const { criteria: rawCriteria } = parseDraft(text);

  const downgradedIndices = [];
  const criteria = rawCriteria.map((raw, i) => {
    const { criterion, downgraded } = normalizeCriterion(raw, i);
    if (downgraded) downgradedIndices.push(i);
    return criterion;
  });

  return { criteria, downgradedIndices, tokens, provider };
}

module.exports = { draftCriteria };
