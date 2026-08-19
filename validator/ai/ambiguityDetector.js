/**
 * ambiguityDetector.js
 * ─────────────────────
 * Analyzes job descriptions to detect vague or ambiguous requirements.
 * Suggests clarifications before locking the spec on-chain.
 *
 * Examples of ambiguity:
 *   "build a fast API"     → What does "fast" mean? Suggest: response_time < 200ms
 *   "create a nice UI"     → What does "nice" mean? No frontend scope here, but flag it.
 *   "handle errors"        → Which errors? Suggest specific error codes.
 */

const modelClient = require("./modelClient");

// Common vague terms that need quantification
const VAGUE_TERMS = [
  { pattern: /\bfast\b/i, suggestion: "Define performance target (e.g., response_time < 200ms)" },
  { pattern: /\bscalable\b/i, suggestion: "Define scale targets (e.g., handle 1000 concurrent users)" },
  { pattern: /\bsecure\b/i, suggestion: "Specify security requirements (e.g., input validation, auth)" },
  { pattern: /\bgood\b/i, suggestion: "Define quality criteria with measurable outcomes" },
  { pattern: /\bnice\b/i, suggestion: "Specify concrete acceptance criteria" },
  { pattern: /\brobust\b/i, suggestion: "Define error handling expectations" },
  { pattern: /\betc\.?\b/i, suggestion: "List all required items explicitly" },
  { pattern: /\bsimple\b/i, suggestion: "Define minimum viable feature set" },
  { pattern: /\bproperly\b/i, suggestion: "Define what 'proper' means with specific checks" },
  { pattern: /\befficient\b/i, suggestion: "Set performance benchmarks (time/memory complexity)" },
];

/**
 * Detect ambiguities in a job description.
 *
 * @param {string} description - Job description text
 * @returns {{ isAmbiguous: boolean, issues: object[], suggestions: string[] }}
 */
async function detectAmbiguity(description) {
  // Phase 1: Rule-based detection (fast, always available)
  const ruleBasedIssues = runRuleBasedDetection(description);

  // Phase 2: LLM-assisted detection (deeper; Groq primary, Gemini fallback —
  // see validator/ai/modelClient.js)
  let aiIssues = [];
  try {
    aiIssues = await runAIDetection(description);
  } catch (err) {
    console.warn("[AmbiguityDetector] LLM unavailable, using rule-based only:", err.message);
  }

  const allIssues = [...ruleBasedIssues, ...aiIssues];
  const suggestions = allIssues.map((i) => i.suggestion);

  return {
    isAmbiguous: allIssues.length > 0,
    issueCount: allIssues.length,
    issues: allIssues,
    suggestions,
  };
}

function runRuleBasedDetection(description) {
  const issues = [];

  for (const { pattern, suggestion } of VAGUE_TERMS) {
    const match = description.match(pattern);
    if (match) {
      issues.push({
        type: "vague_term",
        term: match[0],
        suggestion,
        source: "rule_based",
      });
    }
  }

  // Check for missing specifics
  if (description.length < 50) {
    issues.push({
      type: "too_short",
      suggestion: "Job description is very short. Add details about expected inputs, outputs, and behavior.",
      source: "rule_based",
    });
  }

  if (!/\d/.test(description)) {
    issues.push({
      type: "no_numbers",
      suggestion: "Consider adding quantifiable requirements (counts, sizes, limits, status codes).",
      source: "rule_based",
    });
  }

  return issues;
}

async function runAIDetection(description) {
  const prompt = `Analyze this job description for a freelance coding task and identify any ambiguous or vague requirements.

Job Description:
"${description}"

Respond ONLY with valid JSON:
{
  "issues": [
    { "type": "ambiguity", "detail": "what is vague", "suggestion": "how to clarify" }
  ]
}

If the description is clear, return: { "issues": [] }`;

  const { text } = await modelClient.generate(prompt, { json: true });
  try {
    const parsed = JSON.parse(text.trim().match(/\{[\s\S]*\}/)?.[0] || "{}");
    return (parsed.issues || []).map((i) => ({ ...i, source: "ai" }));
  } catch {
    return [];
  }
}

module.exports = { detectAmbiguity };
