/**
 * canonical.js
 * ────────────
 * Canonical JSON encoding and keccak256 hashing, per VEYLO_BUILD_PLAN_REVISED.md §6.
 *
 * Rules (verbatim from the plan):
 *   1. Object keys sorted lexicographically by UTF-8 code point, at every level
 *   2. No insignificant whitespace
 *   3. UTF-8, no BOM
 *   4. Numbers in shortest round-trip form; no -0, no exponent form for integers
 *   5. null fields omitted entirely, never emitted as null
 *   6. Non-deterministic fields excluded before hashing, never zeroed
 *      (rule 6 is a caller responsibility — canonicalize() encodes whatever
 *      object it is given; callers must strip timestamps/durations/etc. first)
 *
 * This is the ONE shared module — backend, tests, and the standalone verifier
 * must all use it. Get this wrong and every commitment is worthless.
 */

const { keccak256, toUtf8Bytes } = require("ethers");

/**
 * Compare two strings by Unicode code point (not UTF-16 code unit).
 * Plain JS string comparison compares UTF-16 code units, which gives the
 * wrong order for supplementary-plane characters (surrogate pairs) relative
 * to UTF-8 byte / code point order. Array.from(str) iterates by code point.
 */
function compareByCodePoint(a, b) {
  const ca = Array.from(a);
  const cb = Array.from(b);
  const len = Math.min(ca.length, cb.length);
  for (let i = 0; i < len; i++) {
    const pa = ca[i].codePointAt(0);
    const pb = cb[i].codePointAt(0);
    if (pa !== pb) return pa - pb;
  }
  return ca.length - cb.length;
}

/**
 * Expand exponential notation ("1e+21", "1.5e-7") into plain decimal digits,
 * preserving the exact same digits (no rounding — just moving the point).
 */
function expandExponential(s) {
  const match = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(s);
  if (!match) return s;
  const [, sign, intPart, fracPart = "", expStr] = match;
  const exp = parseInt(expStr, 10);
  let digits = intPart + fracPart;
  let pointPos = intPart.length + exp;

  if (pointPos <= 0) {
    digits = "0".repeat(-pointPos) + digits;
    pointPos = 0;
  } else if (pointPos >= digits.length) {
    digits = digits + "0".repeat(pointPos - digits.length);
    pointPos = digits.length;
  }

  let result;
  if (pointPos === 0) {
    result = "0." + digits;
  } else if (pointPos === digits.length) {
    result = digits;
  } else {
    result = digits.slice(0, pointPos) + "." + digits.slice(pointPos);
  }

  if (result.includes(".")) {
    result = result.replace(/0+$/, "").replace(/\.$/, "");
  }
  return sign + result;
}

/**
 * Encode a number per rule 4: shortest round-trip form, no -0, no exponent.
 */
function numberToCanonical(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new Error(`canonicalize: non-finite or non-numeric value: ${n}`);
  }
  if (Object.is(n, -0)) n = 0;

  if (Number.isInteger(n)) {
    return BigInt(n).toString();
  }

  let s = n.toString();
  if (s.includes("e") || s.includes("E")) {
    s = expandExponential(s);
  }
  return s;
}

/**
 * Recursively encode a value to its canonical JSON string form.
 * Returns `undefined` for `undefined` input, so the caller (object-field
 * encoding) can detect and omit it per rule 5.
 */
function encode(value) {
  if (value === undefined) return undefined;
  if (value === null) return "null";

  const t = typeof value;

  if (t === "boolean") return value ? "true" : "false";
  if (t === "number") return numberToCanonical(value);
  if (t === "string") return JSON.stringify(value);

  if (Array.isArray(value)) {
    const items = value.map((v) => {
      const enc = encode(v);
      return enc === undefined ? "null" : enc;
    });
    return "[" + items.join(",") + "]";
  }

  if (t === "object") {
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined && value[k] !== null)
      .sort(compareByCodePoint);
    const parts = keys.map((k) => JSON.stringify(k) + ":" + encode(value[k]));
    return "{" + parts.join(",") + "}";
  }

  throw new Error(`canonicalize: unsupported value type "${t}"`);
}

/**
 * @param {*} obj  Any JSON-shaped value (object, array, string, number, boolean, null)
 * @returns {string} Canonical JSON encoding
 */
function canonicalize(obj) {
  const result = encode(obj);
  if (result === undefined) {
    throw new Error("canonicalize: top-level value is undefined");
  }
  return result;
}

/**
 * @param {*} obj  Any JSON-shaped value
 * @returns {string} 0x-prefixed keccak256 hash of the canonical encoding
 */
function hashCanonical(obj) {
  const json = canonicalize(obj);
  return keccak256(toUtf8Bytes(json));
}

module.exports = { canonicalize, hashCanonical };
