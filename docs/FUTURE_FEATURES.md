# Future Features

Genuinely unbuilt work only — everything below is unimplemented today. Each
item is future tense on purpose: none of this exists in the codebase yet,
and nothing here should be read as a roadmap commitment, only as scoped-out
work with a stated condition for revisiting it.

This is not the place for ideas that were considered and rejected — see
`docs/PROJECT_REVIEW.md` §25 ("What We Explicitly Cut") for those, and don't
resurrect them here. A reputation system, a marketplace, multi-organization
endorsement, weighted scoring, and a decentralized validator set were all
considered and cut for stated reasons; they are not future features, they
are closed questions.

---

### A real payment provider (Razorpay Route)

`PaymentProvider` (`backend/services/settlement/PaymentProvider.js`) is a
port with one implementation, `SimulatedProvider` — no real money moves
anywhere in this build. A `RazorpayProvider` implementing the same port
would replace it for real settlement.

**Attempted 2026-09-05, found blocked — see `docs/CURRENT_STATE.md`'s Phase 6
entry.** Razorpay's Dashboard (Test Mode) does not list Route as an option on
this account at all. Confirmed against Razorpay's own current docs: Route was
discontinued for accounts that don't meet a new eligibility bar, effective
January 1, 2026 ([Route | FAQs | Razorpay
Docs](https://razorpay.com/docs/payments/route/faqs/?preferred-country=IN)).

**Condition before starting (updated, real bar as of 2026-09-05):**
domestic turnover exceeding ₹40 Lakhs, or export turnover exceeding ₹5 Lakhs,
in FY25 or FY26, plus confirmation that the linked account directly
interfaces with the customer for goods/services — then reapply and wait
5–7 business days for review. Separately, and still unresolved even if Route
access is regained: Render's free tier sleeps after 15 minutes idle, which
makes webhook-based payment confirmation unreliable — a webhook delivered to
a sleeping instance can be silently dropped or delayed, a real-money failure
mode this project has not built or tested a mitigation for. Both conditions
must hold before starting — not just Route access — or the correct outcome
is, again, to keep `SimulatedProvider` and say so.

### A second validator/deliverable type

The current engine (`validator/core/Validator.js`'s interface) evaluates one
deliverable shape: a Git repository at a commit, checked with five closed
DETERMINISTIC kinds. A second implementation (a document/PDF validator, for
example) is possible under the same interface but does not exist.

**Condition before starting:** a real consumer who needs it. Nothing in the
current corpus, evaluation, or demo exercises anything beyond a code
repository.

### Languages beyond Python and JavaScript

The deterministic checks (`validator/checks/`) and the labelled corpus
(`corpus/`, `corpus-adversarial/`) cover Python and JavaScript only. Go,
Rust, Java, and others are unevaluated — not "supported but untested,"
genuinely never exercised by any check kind or fixture.

**Condition before starting:** none stated; breadth was deliberately not
pursued in favor of depth on two languages (see `docs/PROJECT_REVIEW.md`
§4.4/§9).

### Independent validator operation

Today there is exactly one validator key (`VALIDATOR_PRIVATE_KEY`), held by
the project operator, who is also the arbitrator
(`CentralizedArbitrator`'s owner). A second, independently-operated
validator — someone other than the person who built this system running
their own instance against the same or a forked contract — does not exist.

**Condition before starting:** a second real operator, which by definition
can't be built solo. This is also the honest boundary stated throughout the
README and `docs/INTERVIEW_NOTES.md`: the trust model as shipped assumes one
operator, and "add a second one" is the actual mitigation for the
single-operator limitation, not a cosmetic feature.

### Evidence permanence (IPFS or similar)

`evidenceHash` commits to `{ repoUrl, commitHash }`, not to the repository's
content. If the repository at that URL is deleted, force-pushed, or made
private after verification, the hash still matches what was recorded, but
the underlying evidence itself is gone — nothing in this build pins or
mirrors it.

**Condition before starting:** none stated. This is a known, disclosed gap
(off-chain evidence loss), not a solved problem deferred for polish.

### Frontend redesign

The current UI reuses the existing component library (`frontend/src/components/`)
adapted to the Agreement lifecycle — it was deliberately not redesigned
visually this phase (see `VEYLO_BUILD_PLAN_REVISED.md`'s Phase 5 instruction:
"DO NOT redesign the app — a redesign is a separate later effort").

**Condition before starting:** none stated beyond it being explicitly a
separate, later effort.

### Frontend request-queueing for Groq's rate limit

`validator/ai/modelClient.js` fails over to Gemini on a Groq rate-limit
error, and rotates across multiple keys if configured
(`GROQ_API_KEYS`/`GEMINI_API_KEYS`), but there is no request queue that
smooths bursts against Groq's 30-requests-per-minute limit — a burst of
concurrent verifications can still fail over sooner than a queue would
require.

**Condition before starting:** observed real contention against the actual
free-tier limits in production use; not built speculatively.
