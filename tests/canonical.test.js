/**
 * tests/canonical.test.js
 * ─────────────────────────
 * Proves backend/lib/canonical.js satisfies VEYLO_BUILD_PLAN_REVISED.md §6.
 */

const { canonicalize, hashCanonical } = require("../backend/lib/canonical");

describe("canonicalize — key ordering", () => {
  test("input key order does not change output", () => {
    const a = { b: 1, a: 2, c: 3 };
    const b = { c: 3, a: 2, b: 1 };
    expect(canonicalize(a)).toBe(canonicalize(b));
    expect(canonicalize(a)).toBe('{"a":2,"b":1,"c":3}');
  });

  test("nested reordering does not change it", () => {
    const a = { outer: { z: 1, y: { m: 1, n: 2 }, x: 3 }, top: 1 };
    const b = { top: 1, outer: { x: 3, y: { n: 2, m: 1 }, z: 1 } };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  test("array element order is preserved, not sorted", () => {
    const a = { list: [3, 1, 2] };
    expect(canonicalize(a)).toBe('{"list":[3,1,2]}');
  });

  test("keys sorted by UTF-8 code point, including supplementary-plane characters", () => {
    // '𐀀' (U+10000) has a lower UTF-16 code-unit-order rank issue
    // relative to '' (U+E000, BMP) than its true code point order:
    // U+10000 > U+E000, but naive UTF-16 code-unit comparison would say
    // the high surrogate (0xD800) < 0xE000, misordering them.
    const supplementary = "\u{10000}"; // U+10000
    const bmp = ""; // U+E000, code point 0xE000 < 0x10000
    const obj = { [supplementary]: 1, [bmp]: 2 };
    const out = canonicalize(obj);
    // bmp (U+E000) must sort BEFORE supplementary (U+10000) since 0xE000 < 0x10000
    expect(out.indexOf(JSON.stringify(bmp))).toBeLessThan(out.indexOf(JSON.stringify(supplementary)));
  });
});

describe("canonicalize — null handling (rule 5)", () => {
  test("adding a null field does not change output", () => {
    const withNull = { a: 1, b: null };
    const withoutNull = { a: 1 };
    expect(canonicalize(withNull)).toBe(canonicalize(withoutNull));
    expect(canonicalize(withNull)).toBe('{"a":1}');
  });

  test("adding an undefined field does not change output", () => {
    const withUndefined = { a: 1, b: undefined };
    const withoutUndefined = { a: 1 };
    expect(canonicalize(withUndefined)).toBe(canonicalize(withoutUndefined));
  });

  test("null inside an array is preserved as a positional value, not omitted", () => {
    expect(canonicalize({ list: [1, null, 2] })).toBe('{"list":[1,null,2]}');
  });

  test("top-level null encodes as the literal null", () => {
    expect(canonicalize(null)).toBe("null");
  });
});

describe("canonicalize — changed values change output", () => {
  test("changing a real value changes the output", () => {
    const a = { status: "PASS", index: 0 };
    const b = { status: "FAIL", index: 0 };
    expect(canonicalize(a)).not.toBe(canonicalize(b));
  });

  test("changing a nested real value changes the output", () => {
    const a = { deterministic: { outcome: "ACCEPT" } };
    const b = { deterministic: { outcome: "REJECT" } };
    expect(canonicalize(a)).not.toBe(canonicalize(b));
  });
});

describe("canonicalize — whitespace and encoding (rules 2, 3)", () => {
  test("no insignificant whitespace", () => {
    const out = canonicalize({ a: 1, b: [1, 2], c: { d: 3 } });
    expect(out).toBe('{"a":1,"b":[1,2],"c":{"d":3}}');
    expect(out).not.toMatch(/[\n\t]| ,| :/);
  });

  test("non-ASCII strings survive round-trip and produce valid UTF-8", () => {
    const out = canonicalize({ name: "café éè" });
    expect(Buffer.from(out, "utf8").toString("utf8")).toBe(out);
    expect(JSON.parse(out)).toEqual({ name: "café éè" });
  });
});

describe("canonicalize — number formatting (rule 4)", () => {
  test("negative zero is normalized to 0", () => {
    expect(canonicalize({ n: -0 })).toBe('{"n":0}');
  });

  test("large integers are not emitted in exponent form", () => {
    const out = canonicalize({ n: 1e21 });
    expect(out).not.toMatch(/e/i);
    expect(out).toBe('{"n":1000000000000000000000}');
  });

  test("small fractional numbers are not emitted in exponent form", () => {
    const out = canonicalize({ n: 0.0000001 });
    expect(out).not.toMatch(/e/i);
  });

  test("ordinary integers and decimals round-trip exactly", () => {
    expect(canonicalize({ n: 42 })).toBe('{"n":42}');
    expect(canonicalize({ n: 3.14 })).toBe('{"n":3.14}');
  });

  test("NaN and Infinity are rejected, never silently coerced", () => {
    expect(() => canonicalize({ n: NaN })).toThrow();
    expect(() => canonicalize({ n: Infinity })).toThrow();
  });
});

describe("hashCanonical", () => {
  test("returns a 0x-prefixed 32-byte keccak256 hex string", () => {
    const hash = hashCanonical({ a: 1 });
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  test("is deterministic across key-order-only differences", () => {
    const h1 = hashCanonical({ a: 1, b: 2 });
    const h2 = hashCanonical({ b: 2, a: 1 });
    expect(h1).toBe(h2);
  });

  test("is deterministic across null-field-only differences", () => {
    const h1 = hashCanonical({ a: 1, b: null });
    const h2 = hashCanonical({ a: 1 });
    expect(h1).toBe(h2);
  });

  test("changes when a real value changes", () => {
    const h1 = hashCanonical({ status: "PASS" });
    const h2 = hashCanonical({ status: "FAIL" });
    expect(h1).not.toBe(h2);
  });

  test("matches an independently computed keccak256 of the canonical string", () => {
    const { keccak256, toUtf8Bytes } = require("ethers");
    const obj = { criteria: [{ index: 0, method: "DETERMINISTIC" }], version: 1 };
    const expected = keccak256(toUtf8Bytes(canonicalize(obj)));
    expect(hashCanonical(obj)).toBe(expected);
  });
});
