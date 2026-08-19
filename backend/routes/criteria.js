/**
 * routes/criteria.js
 * ────────────────────
 * The criteria-drafting assistant (VEYLO_BUILD_PLAN_REVISED.md Phase 3, Part
 * D). Takes a plain-language description and proposes a §6-format criteria
 * list, marking each DETERMINISTIC or SEMANTIC and flagging ambiguous or
 * unmeasurable ones.
 *
 * This route never persists anything and never touches the chain. The
 * client always edits and approves the draft; POST /agreements (where the
 * client's EIP-712 signature is recorded) is the only place a criteria list
 * becomes real.
 */

const express = require("express");
const router = express.Router();

const { draftCriteria } = require("../../validator/ai/testGenerator");
const { detectAmbiguity } = require("../../validator/ai/ambiguityDetector");

/**
 * POST /criteria/draft
 * Body: { description: string }
 */
router.post("/draft", async (req, res) => {
  try {
    const { description } = req.body;
    if (!description || typeof description !== "string" || !description.trim()) {
      return res.status(400).json({ error: "description (non-empty string) is required" });
    }

    const draft = await draftCriteria(description);

    const criteria = await Promise.all(
      draft.criteria.map(async (criterion, i) => {
        const ambiguity = await detectAmbiguity(criterion.text);
        return {
          ...criterion,
          downgradedFromDeterministic: draft.downgradedIndices.includes(i),
          ambiguous: ambiguity.isAmbiguous,
          ambiguityFlags: ambiguity.suggestions,
        };
      })
    );

    res.json({ criteria, provider: draft.provider, tokens: draft.tokens });
  } catch (error) {
    console.error("[Criteria] Draft error:", error);
    // Never fall back to a fabricated default list — a provider failure is
    // reported as a real failure, per rule 5.
    res.status(502).json({ error: "Failed to draft criteria", details: error.message });
  }
});

module.exports = router;
