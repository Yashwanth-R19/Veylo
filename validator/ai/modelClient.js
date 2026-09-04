/**
 * validator/ai/modelClient.js
 * ─────────────────────────────
 * Provider-agnostic LLM client. Replaces the Phase 0/1 Ollama-only
 * modelClient.js (deleted in Phase 1 — targeted http://localhost:11434,
 * which cannot be deployed).
 *
 * Provider selection (VEYLO_BUILD_PLAN_REVISED.md Phase 3, Part A):
 *   - Groq is primary whenever at least one Groq key is configured — model is
 *     openai/gpt-oss-120b, NOT the plan's literal "llama-3.3-70b-versatile"
 *     (retired by Groq; see GROQ_MODEL below for the full story).
 *   - Gemini Flash is the fallback whenever at least one Gemini key is
 *     configured.
 *   - If only one provider has keys, that provider is used with no fallback.
 *   - If neither has any key, generate() throws immediately — callers must
 *     treat that as an unavailable provider (INCONCLUSIVE upstream), never
 *     substitute a fabricated response.
 *   - Failover from Groq to Gemini happens once EVERY Groq key has been
 *     tried and failed with a retryable status (see isRetryableStatus) or a
 *     network error — never on a successful response the caller merely
 *     dislikes.
 *
 * ── Multi-key pools (Phase 3 Session 2 correction) ──────────────────────
 * Originally this module read a single GROQ_API_KEY / GEMINI_API_KEY. The
 * user then provisioned multiple keys per provider (6 Groq, 10 Gemini) to
 * multiply the effective free-tier budget, via GROQ_API_KEYS /
 * GEMINI_API_KEYS — comma-separated lists. Per explicit user decision:
 * rotate to the next key in a provider's pool ONLY on a rate-limit/error
 * response for the current key, not on every call (no round-robin, no
 * random selection). The pool cursor (loadedGroqKeys/groqKeyCursor etc.
 * below) is process-lifetime state, not per-call: once key N is known bad
 * this run, later calls start from key N+1 instead of re-trying key 0 first.
 *
 * A single bad/revoked key now returns 401/403 for THAT KEY specifically,
 * not necessarily for the whole provider — unlike the single-key design,
 * where a 401 meant "this provider is unusable, don't retry it here."
 * isRetryableStatus() below was widened to include 401/403 for exactly this
 * reason: with a pool, "try the next key" is the right response to an auth
 * error, and only once the WHOLE pool has failed with a retryable status is
 * falling over to the other provider's pool appropriate. A genuinely
 * malformed request (400) or a request naming a model that doesn't exist
 * (404) is still not retried against another key — it would fail identically
 * on every key in the pool.
 *
 * The singular GROQ_API_KEY / GEMINI_API_KEY env vars are still honored as a
 * one-key pool if the plural *_KEYS var isn't set, so this is a strict
 * superset of the original single-key behavior, not a breaking change.
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
 * independently verify.
 *
 * Budget: Groq's free tier for this model is 30 RPM / 1,000 requests/day /
 * 100,000 tokens/day PER KEY. This module does not itself enforce a quota —
 * validator/advisory/AdvisoryValidator.js's caching (keyed on a
 * content-hash + criterionIndex, see that file) and one-request-per-criterion
 * design are what keep usage inside budget. Every call returns real measured
 * token counts so callers can report actual usage rather than an estimate.
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
  // 401/403 (this specific key is invalid/revoked/unauthorized), 429 (rate
  // limit), and any 5xx are all reasons to try the NEXT KEY in the pool, and
  // — if every key in the pool is exhausted this way — to fail over to the
  // other provider's pool. Any other 4xx (400 bad request, 404 unknown
  // model, etc.) would fail identically on every key, so it is not retried.
  return status === 401 || status === 403 || status === 429 || status >= 500;
}

/** Parses a provider's key pool: the plural *_KEYS var as a comma-separated
 * list if present, else the singular *_KEY var as a one-element pool, else
 * empty. Whitespace around each key is trimmed; empty entries are dropped. */
function parseKeyPool(pluralVar, singularVar) {
  const plural = process.env[pluralVar];
  if (plural) {
    return plural
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
  }
  const single = process.env[singularVar];
  return single ? [single.trim()] : [];
}

// Process-lifetime cursors: which key index to try FIRST on the next call,
// per provider. Only ever advanced on a retryable per-key failure (see
// header comment) — never reset mid-process, never round-robin.
let groqKeyCursor = 0;
let geminiKeyCursor = 0;

/**
 * Tries each key in `keys` starting at `cursor.value`, calling `attempt(key)`
 * for each. On success, persists the successful key's index as the new
 * cursor (so the next call starts there, skipping keys already known bad
 * this run) and returns its result. On a retryable failure, advances to the
 * next key (wrapping once through the whole pool, never twice) and retries.
 * On a non-retryable failure, throws immediately without trying other keys.
 * Throws the last error if every key in the pool is exhausted.
 */
async function callWithKeyPool(keys, cursor, attempt) {
  let lastErr;
  for (let i = 0; i < keys.length; i++) {
    const idx = (cursor.value + i) % keys.length;
    try {
      const result = await attempt(keys[idx]);
      cursor.value = idx;
      return result;
    } catch (err) {
      lastErr = err;
      if (!(err instanceof ProviderError) || !err.retryable) throw err;
      if (keys.length > 1) {
        console.warn(`[modelClient] key #${idx} failed (${err.message}) — trying next key in pool.`);
      }
    }
  }
  cursor.value = 0; // whole pool exhausted this round; next process-lifetime call starts fresh
  throw lastErr;
}

async function callGroqOnce(apiKey, prompt, { temperature, maxTokens, json }) {
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

async function callGeminiOnce(apiKey, prompt, { temperature, maxTokens, json }) {
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

  const groqKeys = parseKeyPool("GROQ_API_KEYS", "GROQ_API_KEY");
  const geminiKeys = parseKeyPool("GEMINI_API_KEYS", "GEMINI_API_KEY");

  if (groqKeys.length === 0 && geminiKeys.length === 0) {
    throw new ProviderError("No LLM provider configured: set GROQ_API_KEY(S) and/or GEMINI_API_KEY(S).", {
      provider: null,
      status: null,
      retryable: false,
    });
  }

  if (groqKeys.length > 0) {
    try {
      const groqCursor = { value: groqKeyCursor };
      const result = await callWithKeyPool(groqKeys, groqCursor, (key) => callGroqOnce(key, prompt, callOpts));
      groqKeyCursor = groqCursor.value;
      return result;
    } catch (err) {
      if (geminiKeys.length === 0 || !(err instanceof ProviderError) || !err.retryable) throw err;
      console.warn(`[modelClient] entire Groq key pool failed (${err.message}) — failing over to Gemini.`);
    }
  }

  if (geminiKeys.length > 0) {
    const geminiCursor = { value: geminiKeyCursor };
    const result = await callWithKeyPool(geminiKeys, geminiCursor, (key) => callGeminiOnce(key, prompt, callOpts));
    geminiKeyCursor = geminiCursor.value;
    return result;
  }

  // groqKeys was non-empty and its non-retryable/pool-exhausted error already threw above.
  throw new ProviderError("Groq key pool failed and no Gemini fallback is configured.", { provider: "groq", status: null, retryable: false });
}

module.exports = { generate, ProviderError, GROQ_MODEL, GEMINI_MODEL };
