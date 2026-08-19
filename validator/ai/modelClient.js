/**
 * validator/ai/modelClient.js
 * ─────────────────────────────
 * Provider-agnostic LLM client. Replaces the Phase 0/1 Ollama-only
 * modelClient.js (deleted in Phase 1 — targeted http://localhost:11434,
 * which cannot be deployed).
 *
 * Provider selection (VEYLO_BUILD_PLAN_REVISED.md Phase 3, Part A):
 *   - Groq is primary whenever GROQ_API_KEY is set — model is
 *     openai/gpt-oss-120b, NOT the plan's literal "llama-3.3-70b-versatile"
 *     (retired by Groq; see GROQ_MODEL below for the full story).
 *   - Gemini Flash is the fallback whenever GEMINI_API_KEY is set.
 *   - If only one key is present, that provider is used with no fallback.
 *   - If neither is present, generate() throws immediately — callers must
 *     treat that as an unavailable provider (INCONCLUSIVE upstream), never
 *     substitute a fabricated response.
 *   - Failover from Groq to Gemini happens on any HTTP error response
 *     (rate limit, 5xx, etc.) or network failure — never on a successful
 *     response the caller merely dislikes.
 *
 * Raw REST calls, not the official SDKs (project decision: avoid two new
 * npm dependencies when Node's built-in fetch already covers this). Request/
 * response shapes below were verified against live provider docs on
 * 2026-08-19 (Groq's OpenAI-compatible /chat/completions; Gemini's
 * generateContent), not guessed:
 *   - Groq:   POST https://api.groq.com/openai/v1/chat/completions
 *   - Gemini: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 *
 * GROQ_MODEL is NOT the plan's literal "llama-3.3-70b-versatile" — that
 * model has been fully retired from Groq's catalog (confirmed live against
 * this account's key on 2026-08-19: HTTP 404 model_not_found, and it's
 * absent from GET /openai/v1/models entirely). Per rule 9 ("do not change a
 * locked decision — stop and report"), this was not silently swapped: the
 * live model list was fetched, the user was shown exactly what's available
 * on this account (openai/gpt-oss-120b, openai/gpt-oss-20b, qwen/qwen3.6-27b,
 * groq/compound, groq/compound-mini, plus audio/Arabic-specific models that
 * don't apply here), and openai/gpt-oss-120b was chosen as the closest
 * capability match to what the 70B Llama model was standing in for.
 *
 * GEMINI_MODEL defaults to "gemini-2.5-flash" — the plan names "Gemini
 * Flash" without a version. This default is a flagged engineering choice,
 * not a plan value: it is the most recent Flash model this session could
 * independently verify. No GEMINI_API_KEY was present in .env this session,
 * so the Gemini path is implemented per spec but has NOT been exercised
 * against a live response — reported honestly, not glossed over.
 *
 * Budget: Groq's free tier for llama-3.3-70b-versatile is 30 RPM / 1,000
 * requests/day / 100,000 tokens/day. This module does not itself enforce a
 * quota — validator/advisory/AdvisoryValidator.js's caching (keyed on
 * commitHash+criterionIndex) and one-request-per-criterion design are what
 * keep usage inside that budget. Every call returns real measured token
 * counts so callers can report actual usage rather than an estimate.
 */

const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GEMINI_URL = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

class ProviderError extends Error {
  constructor(message, { provider, status, retryable }) {
    super(message);
    this.name = "ProviderError";
    this.provider = provider;
    this.status = status;
    this.retryable = retryable;
  }
}

function isRetryableStatus(status) {
  // 429 (rate limit) and any 5xx are treated as failover triggers; 4xx other
  // than 429 (bad request, bad key, etc.) is not retried against a different
  // provider — it would fail there too or mask a real bug.
  return status === 429 || status >= 500;
}

async function callGroq(prompt, { temperature, maxTokens, json }) {
  const apiKey = process.env.GROQ_API_KEY;
  const body = {
    model: GROQ_MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature,
    max_tokens: maxTokens,
  };
  if (json) body.response_format = { type: "json_object" };

  let res;
  try {
    res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new ProviderError(`Groq request failed: ${err.message}`, { provider: "groq", status: null, retryable: true });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ProviderError(`Groq returned HTTP ${res.status}: ${text.slice(0, 300)}`, {
      provider: "groq",
      status: res.status,
      retryable: isRetryableStatus(res.status),
    });
  }

  const data = await res.json();
  const choice = data.choices && data.choices[0];
  if (!choice || typeof choice.message?.content !== "string") {
    throw new ProviderError("Groq response missing choices[0].message.content", { provider: "groq", status: res.status, retryable: false });
  }

  return {
    text: choice.message.content,
    tokens: {
      prompt: data.usage?.prompt_tokens ?? null,
      completion: data.usage?.completion_tokens ?? null,
      total: data.usage?.total_tokens ?? null,
    },
    provider: `groq/${GROQ_MODEL}`,
  };
}

async function callGemini(prompt, { temperature, maxTokens, json }) {
  const apiKey = process.env.GEMINI_API_KEY;
  const generationConfig = { temperature, maxOutputTokens: maxTokens };
  if (json) generationConfig.responseMimeType = "application/json";

  const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig };

  let res;
  try {
    res = await fetch(`${GEMINI_URL(GEMINI_MODEL)}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new ProviderError(`Gemini request failed: ${err.message}`, { provider: "gemini", status: null, retryable: true });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ProviderError(`Gemini returned HTTP ${res.status}: ${text.slice(0, 300)}`, {
      provider: "gemini",
      status: res.status,
      retryable: isRetryableStatus(res.status),
    });
  }

  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts) ? parts.map((p) => p.text || "").join("") : undefined;
  if (typeof text !== "string") {
    throw new ProviderError("Gemini response missing candidates[0].content.parts[].text", { provider: "gemini", status: res.status, retryable: false });
  }

  return {
    text,
    tokens: {
      prompt: data.usageMetadata?.promptTokenCount ?? null,
      completion: data.usageMetadata?.candidatesTokenCount ?? null,
      total: data.usageMetadata?.totalTokenCount ?? null,
    },
    provider: `gemini/${GEMINI_MODEL}`,
  };
}

/**
 * @param {string} prompt
 * @param {{ temperature?: number, maxTokens?: number, json?: boolean }} [opts]
 *   temperature defaults to 0 (Part B requires "temperature 0, or the lowest
 *   the provider allows" for advisory calls; 0 is also a reasonable default
 *   for everything else in this module since nothing here needs creativity).
 * @returns {Promise<{ text: string, tokens: {prompt:number|null, completion:number|null, total:number|null}, provider: string }>}
 */
async function generate(prompt, opts = {}) {
  const callOpts = { temperature: opts.temperature ?? 0, maxTokens: opts.maxTokens ?? 1024, json: opts.json ?? false };

  const hasGroq = !!process.env.GROQ_API_KEY;
  const hasGemini = !!process.env.GEMINI_API_KEY;

  if (!hasGroq && !hasGemini) {
    throw new ProviderError("No LLM provider configured: set GROQ_API_KEY and/or GEMINI_API_KEY.", {
      provider: null,
      status: null,
      retryable: false,
    });
  }

  if (hasGroq) {
    try {
      return await callGroq(prompt, callOpts);
    } catch (err) {
      if (!hasGemini || !(err instanceof ProviderError) || !err.retryable) throw err;
      console.warn(`[modelClient] Groq failed (${err.message}) — failing over to Gemini.`);
    }
  }

  if (hasGemini) {
    return await callGemini(prompt, callOpts);
  }

  // hasGroq was true and its non-retryable error already threw above.
  throw new ProviderError("Groq failed and no Gemini fallback is configured.", { provider: "groq", status: null, retryable: false });
}

module.exports = { generate, ProviderError, GROQ_MODEL, GEMINI_MODEL };
