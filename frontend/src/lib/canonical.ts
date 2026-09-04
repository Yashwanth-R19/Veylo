/**
 * canonical.ts
 * ────────────
 * Frontend port of backend/lib/canonical.js — canonical JSON encoding and
 * keccak256 hashing, per VEYLO_BUILD_PLAN_REVISED.md §6. Algorithm must
 * match the backend module exactly, field for field, or a hash computed
 * here (e.g. the criteriaHash shown before signing) will not match what the
 * backend and the chain compute.
 *
 * Rules (verbatim from the plan):
 *   1. Object keys sorted lexicographically by UTF-8 code point, at every level
 *   2. No insignificant whitespace
 *   3. UTF-8, no BOM
 *   4. Numbers in shortest round-trip form; no -0, no exponent form for integers
 *   5. null fields omitted entirely, never emitted as null
 *   6. Non-deterministic fields excluded before hashing, never zeroed
 */

import { keccak256, toUtf8Bytes } from 'ethers'

type JsonValue = string | number | boolean | null | undefined | JsonValue[] | { [key: string]: JsonValue }

function compareByCodePoint(a: string, b: string): number {
    const ca = Array.from(a)
    const cb = Array.from(b)
    const len = Math.min(ca.length, cb.length)
    for (let i = 0; i < len; i++) {
        const pa = ca[i].codePointAt(0)!
        const pb = cb[i].codePointAt(0)!
        if (pa !== pb) return pa - pb
    }
    return ca.length - cb.length
}

function expandExponential(s: string): string {
    const match = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(s)
    if (!match) return s
    const [, sign, intPart, fracPart = '', expStr] = match
    const exp = parseInt(expStr, 10)
    let digits = intPart + fracPart
    let pointPos = intPart.length + exp

    if (pointPos <= 0) {
        digits = '0'.repeat(-pointPos) + digits
        pointPos = 0
    } else if (pointPos >= digits.length) {
        digits = digits + '0'.repeat(pointPos - digits.length)
        pointPos = digits.length
    }

    let result: string
    if (pointPos === 0) {
        result = '0.' + digits
    } else if (pointPos === digits.length) {
        result = digits
    } else {
        result = digits.slice(0, pointPos) + '.' + digits.slice(pointPos)
    }

    if (result.includes('.')) {
        result = result.replace(/0+$/, '').replace(/\.$/, '')
    }
    return sign + result
}

function numberToCanonical(n: number): string {
    if (typeof n !== 'number' || !Number.isFinite(n)) {
        throw new Error(`canonicalize: non-finite or non-numeric value: ${n}`)
    }
    if (Object.is(n, -0)) n = 0

    if (Number.isInteger(n)) {
        return BigInt(n).toString()
    }

    let s = n.toString()
    if (s.includes('e') || s.includes('E')) {
        s = expandExponential(s)
    }
    return s
}

function encode(value: JsonValue): string | undefined {
    if (value === undefined) return undefined
    if (value === null) return 'null'

    const t = typeof value

    if (t === 'boolean') return value ? 'true' : 'false'
    if (t === 'number') return numberToCanonical(value as number)
    if (t === 'string') return JSON.stringify(value)

    if (Array.isArray(value)) {
        const items = value.map((v) => {
            const enc = encode(v)
            return enc === undefined ? 'null' : enc
        })
        return '[' + items.join(',') + ']'
    }

    if (t === 'object') {
        const obj = value as { [key: string]: JsonValue }
        const keys = Object.keys(obj)
            .filter((k) => obj[k] !== undefined && obj[k] !== null)
            .sort(compareByCodePoint)
        const parts = keys.map((k) => JSON.stringify(k) + ':' + encode(obj[k]))
        return '{' + parts.join(',') + '}'
    }

    throw new Error(`canonicalize: unsupported value type "${t}"`)
}

// Callers pass typed documents (CriteriaDocument, ResultsDocument, …) that
// TS cannot statically prove are JSON-shaped, so the public entry points
// accept `unknown` — encode() still enforces the actual shape at runtime.
export function canonicalize(obj: unknown): string {
    const result = encode(obj as JsonValue)
    if (result === undefined) {
        throw new Error('canonicalize: top-level value is undefined')
    }
    return result
}

export function hashCanonical(obj: unknown): string {
    const json = canonicalize(obj)
    return keccak256(toUtf8Bytes(json))
}
