# Architecture

This document describes what the shipped system actually does — the state
machine, why the deterministic/advisory split exists and how it's enforced
in code, the canonical hashing rule, the outbox's consistency design, and
the settlement saga. Every claim here traces to a specific file; if you find
one that doesn't, that's a bug in this document, not a license to trust it
anyway.

---

## 1. The state machine

```
                createAgreement (client, + client EIP-712 sig)
                              │
                              ▼
                           DRAFT ──── cancel (client) ────► CANCELLED
                              │ acceptCriteria (worker, + worker EIP-712 sig)
                              ▼
                         COMMITTED          ← work begins here
                              │ submitEvidence (worker, before deadline)
                              ▼
                         SUBMITTED
                              │ recordVerification (validator)
                    ┌─────────┴─────────┐
       outcome automatable        not automatable
                    ▼                   ▼
               VERIFIED           NEEDS_REVIEW
                    │                   │ clientDecision (client, in window)
                    │                   ├──────────────► VERIFIED
                    │                   │
                    │  raiseDispute (either party, within review window)
                    └─────────┬─────────┘
                              ▼
                          DISPUTED
                              │ rule (arbitrator only, ERC-792)
                              ▼
                            RULED
                              │
        finalize ─────────────┴──────── finalize (VERIFIED, after window)
                              ▼
                   SETTLEMENT_AUTHORIZED
                              │ confirmSettlement (validator)
                              ▼
                           SETTLED
```

Enforced entirely on-chain in `contracts/VeyloAgreements.sol` — every
transition function checks the current `Status` and reverts on any
disallowed one (see `test/VeyloAgreements.test.js`'s "invalid transitions"
suites, one test per illegal edge, not a table-driven loop). The backend
never advances a database row's status on its own judgment: every route in
`backend/routes/agreements.js` checks the DB-mirrored status before
enqueueing anything, and every status the DB actually stores after a
write is read back from the confirmed transaction's on-chain effect (see §3).

**The outcome rule — the one invariant everything else exists to protect:**

```
outcome = ACCEPT   if every DETERMINISTIC criterion PASSes
                   and no SEMANTIC criterion is FAIL or INCONCLUSIVE
outcome = REJECT   if any DETERMINISTIC criterion FAILs
outcome = NONE     otherwise  →  NEEDS_REVIEW, a human decides
```

`REVIEW_WINDOW` is a public Solidity constant (3 days). `finalize()` accepts
a `VERIFIED` agreement only after the window has elapsed, or a `RULED`
agreement immediately — a ruling has already been through the dispute
process, so there's nothing left to wait out.

---

## 2. The deterministic/advisory split

This is the single most important boundary in the codebase, and it is
enforced structurally, not by convention.

**Where it lives in code:**

- `validator/core/engine.js` runs only `DETERMINISTIC` criteria (`file_exists`,
  `test_passes`, `test_suite_passes`, `http_route`, `lint_clean`) against an
  isolated sandbox (E2B in production, Docker locally, or a `none` backend
  that refuses to execute anything). It has no code path that reads a
  `SEMANTIC` criterion.
- `validator/advisory/AdvisoryValidator.js` runs only `SEMANTIC` criteria,
  one LLM call per criterion, at temperature 0, with the repository content
  explicitly delimited and labelled as untrusted data in the prompt. It has
  no code path that writes to the settlement outcome.
- `validator/core/resultsDocument.js`'s `computeFinalOutcome(deterministicResults,
  semanticResults)` is the **one function in the entire codebase** that
  produces the value passed to `recordVerification`. Read its body, not a
  description of it:

  ```js
  function computeFinalOutcome(deterministicResults, semanticResults) {
    if (deterministicResults.some((r) => r.status === "FAIL")) return "REJECT";
    if (deterministicResults.some((r) => r.status === "INCONCLUSIVE")) return "NONE";
    if (semanticResults.some((r) => r.status === "FAIL" || r.status === "INCONCLUSIVE")) return "NONE";
    return "ACCEPT";
  }
  ```

  A `SEMANTIC` result has exactly one way to influence this function: by
  being `FAIL` or `INCONCLUSIVE`, which routes to `NONE` (human review) —
  never directly to `ACCEPT` or `REJECT`. There is no branch, anywhere, where
  a semantic status alone produces a settlement-moving value. This was
  verified directly as a unit call during Phase 3
  (`computeFinalOutcome([{status:'FAIL'}], [{status:'PASS'}])` → `'REJECT'`
  — a deterministic FAIL wins even in the hypothetical worst case where an
  injected prompt forced an advisory PASS).

- The one honest gap this doesn't close: a semantic criterion that
  genuinely, incorrectly reports `PASS` (not attacked — just wrong) when
  every deterministic criterion also passed produces `ACCEPT` with no human
  in the loop, since nothing routes a `PASS` to review. See
  `docs/INTERVIEW_NOTES.md`'s "what if the AI is just wrong" for the full
  reasoning and why the failure direction is still bounded (a wrong `FAIL`
  only costs a review delay; only a wrong `PASS` can silently move money).

**Evidence-reference verification**, also structural rather than
trust-based: every `evidenceRef` an advisory result cites is checked against
the actual submitted files after the model responds (`AdvisoryValidator.js`).
An unresolvable reference — wrong line, wrong file, a path-traversal
attempt — forces the result to `INCONCLUSIVE`, never lets a fabricated
citation stand.

---

## 3. Canonical hashing

`criteriaHash`, `evidenceHash`, `resultsHash`, and `deterministicHash` are
all `keccak256` over one canonical JSON encoding, implemented once in
`backend/lib/canonical.js` and used, unmodified, everywhere a hash is
computed: the backend, the test suite, the frontend's live
criteriaHash preview (`frontend/src/lib/canonical.ts`, an independent
TypeScript port of the same algorithm), and — deliberately reimplemented a
*third* time, not imported — `tools/verify.js`.

The rule:

1. Object keys sorted lexicographically by UTF-8 code point, at every level.
2. No insignificant whitespace.
3. UTF-8, no BOM.
4. Numbers in shortest round-trip form; no `-0`, no exponent form for
   integers.
5. `null` fields omitted entirely, never emitted as `null`.
6. Non-deterministic fields (timestamps, durations, sandbox ids, temp paths)
   are excluded **before** hashing by the caller, never zeroed in place.

`resultsHash` covers the whole results document (`deterministic` +
`advisory` sections); `deterministicHash` covers only the `deterministic`
section, reusing the exact value `engine.js`'s `runEngine()` already
computed rather than recomputing it a second time
(`validator/core/resultsDocument.js`). Only `deterministicHash` is ever
claimed reproducible — the plan never claims the advisory section is.

Why three independent implementations of the same algorithm exist rather
than one shared module everywhere: `tools/verify.js` is explicitly
standalone (Phase 5 Part B) so that a passing run proves something an
import couldn't — if it silently reused `backend/lib/canonical.js`, a bug in
that one file would make every hash "agree" with itself and prove nothing.

---

## 4. The outbox — the consistency layer

Every on-chain write goes through `backend/services/outbox.js`. The design
problem it solves: a chain call can fail after the database has already
changed, or succeed after the process that submitted it has crashed, and
naive code either loses the write or resubmits it twice.

**Intent before action.** `outbox.enqueue()` is always called inside the
*same* Prisma transaction as the business-state change it accompanies (see
every route in `backend/routes/agreements.js` — e.g. `POST /agreements`
creates the `Agreement` row and its `CREATE_AGREEMENT` outbox row in one
`prisma.$transaction`). If the process dies immediately after, the intent
to write to the chain already exists in the database; nothing is silently
lost.

**Nonce pinning, not "check before resubmitting."** Before a row's first
send attempt, `reserveNonce()` fetches the signer's next transaction count
and persists it *inside the row's own payload* — not just in memory. Every
later attempt at that row, whether triggered by a crash, a reorg, or a
bounded retry, reuses that exact pinned nonce. This is what makes "kill the
process mid-write, restart" resolve to *one* transaction rather than zero
or two: a resend with the same nonce either lands once (if the first
attempt never reached the mempool) or is rejected as a duplicate by the
node (if it did) — there is no third outcome.

**Confirmation depth, not "receipt exists."** A row only moves to
`CONFIRMED` after `confirmationsRequired` (default 3) blocks have been mined
on top of its receipt's block. If a previously-seen receipt disappears
(reorg), the row resets to `PENDING` — keeping its pinned nonce — rather
than treating a reorg'd transaction as final.

**Effect application only after confirmation succeeds, not before.** A real
bug, found and fixed during Phase 4: the original code marked a row
`CONFIRMED` *before* calling `applyConfirmedEffect()` (the function that
writes the decoded on-chain result back into the `Agreement`/`Dispute`/
`Settlement` row). A `CONFIRMED` row is never revisited by the poller, so a
transaction that mined correctly but whose effect-application threw (a real
repro: a stale local `onChainId` colliding with Prisma's unique constraint
after a contract redeploy) left the database permanently out of sync with
an immutable, already-final chain write. Fixed: the row stays `SUBMITTED`
with the error visible in `lastError` until `applyConfirmedEffect` actually
succeeds — safe to retry indefinitely, since it only re-derives DB state
from a receipt that can't change.

**A disclosed, unresolved limitation in the same file:** if a pinned nonce
is later found to have been consumed by some other transaction from the
same signer, `outbox.js` scans up to 500 recent blocks looking for the
transaction that used it before giving up for that tick. If it isn't found
in that window — observed for real during this project, when a single
shared test wallet had done enough unrelated transactions to push the
match outside the lookback range — the row has **no automatic terminal
state**: it retries the same 500-block scan on every subsequent tick,
forever, and since `outbox.resume()` is awaited during server startup
before `app.listen()` runs, a row stuck this way can make the server slow
to start. The one instance of this hit during development was resolved by
a human marking the row `FAILED` with the reason recorded — not something
the code does for you today.

---

## 5. The settlement saga

`backend/services/settlement/engine.js`. The problem: settlement spans two
independently-failing systems — the chain (authoritative for the outcome)
and a payment provider (which actually moves money) — and a crash between
them must never produce a double-payment or a lost one.

**The governing rule, enforced twice, not once.** The on-chain outcome is
read a single time to create the `Settlement` row (`getOrCreateSettlement`)
— never invented locally — and read again from the chain immediately before
every `release`/`reverse` call (`ensureAction`), refusing to proceed if it no
longer matches what was recorded at intent time. The backend is never
allowed to reason "my database says release, so I'll pay" — only the chain
authorizes an action.

**Three idempotent, independently-resumable steps**, each safe to call
repeatedly, including after a real process crash:

```
ensureHold              → PaymentProvider.createHold
ensureAction             → PaymentProvider.release | .reverse
ensureConfirmSettlement  → enqueues CONFIRM_SETTLEMENT via the outbox (§4)
```

Each derives the *same* deterministic idempotency key on every call
(`canonical.hashCanonical({ scope: "veylo-settlement-v1", agreementId, action })`)
rather than generating and persisting a random one — "querying the provider
for an existing key" is implemented as *replaying the same call*, which the
provider itself resolves idempotently. This mirrors how a real Stripe/Razorpay
idempotency key actually works: you don't look it up separately, you retry
the same request and get the same result back.

**Why double-paying is structurally hard, not just tested against:**
`SimulatedProvider`'s idempotency contract (`backend/services/settlement/PaymentProvider.js`'s
header) requires every implementation to return the *same* reference for a
repeated call with the same key and to never repeat the underlying side
effect. `SimulatedProvider` persists its ledger (`SimulatedProviderRecord`)
in a table **separate from** `Settlement` — deliberately, so that idempotency-key
replay after a real kill is tested against a genuinely independent source of
truth (what an external provider's own servers would remember), not against
Veylo's own possibly-lost write.

**Fault injection, not simulation of fault injection.** Fault modes
(`CRASH_BEFORE_ACT`, `CRASH_AFTER_ACT`, `ERROR_BEFORE_ACT`, `ERROR_AFTER_ACT`,
`TIMEOUT`, `DUPLICATE_REFERENCE`) are armed via environment variables read
inside `SimulatedProvider`'s own call, specifically so a test harness can
spawn a *fresh child process* with the fault configured and let it *really*
crash (`process.exit(1)` from inside the provider call, not a caught
exception standing in for one) — see `scripts/settlementFaultInjection.js`
and `scripts/settlementStepRunner.js`. The measured results are in
`docs/EVALUATION.md`.

**Bounded, terminal failure.** Each step retries up to `MAX_ATTEMPTS` (5)
times with the error recorded in `lastError`; beyond that the `Settlement`
row moves to terminal `FAILED`, visible via `GET /agreements/:id/settlement`,
and is never auto-retried — the same "fail visibly, don't hide it" pattern
as the outbox.

**A disclosed local-bookkeeping gap, same shape as §4's:** the settlement
worker's `tick()` processes every pending row globally, not scoped to one
agreement. During Phase 4's own fault-injection testing, a dangling
`CONFIRM_SETTLEMENT` row from one test scenario was picked up by a *different*
scenario's global tick and settled that agreement for real, on-chain,
correctly — just earlier than the test harness expected, and the harness
had already reset that agreement's local `Settlement` row in anticipation of
running its own scenario. Net effect: a small number of agreements are
genuinely `SETTLED` on-chain (verifiable via `tools/verify.js` or
`GET /agreements/:id`) but have no local `Settlement` row, so
`GET /agreements/:id/settlement` reports "not initiated yet" for them —
an honest reflection of a real local data gap, not a fabricated status. The
test harness now refuses to reset an agreement whose `Settlement` row is
already `SETTLED` (rather than silently discarding real bookkeeping), so this
specific interaction can't recur, but the already-affected rows were not
backfilled.

---

## 6. Where the database and the chain can disagree, and how that's surfaced

`GET /agreements/:id` returns the database row, an on-chain read
(`chainService.getAgreement`), and an `inSync` boolean — computed by direct
comparison, not asserted. A background `driftDetector` (`backend/services/driftDetector.js`)
periodically re-checks every agreement with an on-chain id and feeds
`GET /health`'s drift count. An unreachable chain during a check is recorded
as `unreachable: true`, never folded into a false "drift: 0" — the same
principle applies throughout: a dependency that can't be reached reports
that fact, it never reports success on its behalf.
