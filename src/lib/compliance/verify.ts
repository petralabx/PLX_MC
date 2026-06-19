// The compliance verifier (EN-007 decisions 2, 9, 12). Pure: given the PR's
// resolved task, actor kind, risk tier, and whether the bucket has a PRD, it
// returns a pass/block verdict plus human-readable reasons. The GitHub status
// check (P1b) wraps this; the soft-vs-hard (warn vs block) decision belongs to
// the caller, not here. Reuses the EN-003 evidence + accountability model.

import type { Evidence } from "@/lib/mc-data";
import { evidenceComplete, hasHumanAccountableOwner } from "@/lib/mc-data";
import { bundleRequirementsFor } from "./risk";
import type { RiskTier, VerifyInput, VerifyResult } from "./types";

// Is the evidence object complete enough for this tier?
//   minimal → a non-empty summary
//   note    → a complete evidence checklist + a rollback note
//   full    → note + change-appropriate proof (screenshots or a test run)
export function evidenceCompleteForTier(
  ev: Evidence | undefined,
  tier: RiskTier
): { ok: boolean; missing: string[] } {
  const req = bundleRequirementsFor(tier);
  const missing: string[] = [];

  if (req.evidence === "minimal") {
    if (!ev || !ev.summary.trim()) missing.push("an evidence summary");
    return { ok: missing.length === 0, missing };
  }

  if (!evidenceComplete(ev)) missing.push("a complete evidence checklist");
  if (req.rollback && !ev?.rollback?.trim()) missing.push("a rollback plan");
  if (req.evidence === "full" && !(ev?.shots?.length || ev?.qa)) {
    missing.push("change-appropriate proof (screenshots or a test run)");
  }
  return { ok: missing.length === 0, missing };
}

export function verifyCompliance(input: VerifyInput): VerifyResult {
  const { task, actor, tier, bucketHasPrd } = input;

  // No task resolved from the checkout/link.
  if (!task) {
    if (actor === "operator") {
      // Operator work is recorded but ungated — ingestion auto-creates a sparse
      // task (decision 5). The gate passes.
      return { verdict: "pass", reasons: ["operator PR — a sparse task will be recorded"] };
    }
    return {
      verdict: "block",
      reasons: ["agent PR has no checked-out MC task (decision 3: checkout handshake required)"],
    };
  }

  // Operators keep optionality on detail (decision 5) — recorded, not gated.
  if (actor === "operator") {
    return { verdict: "pass", reasons: ["operator PR — recorded, bundle optional"] };
  }

  // Agent work: enforce the tier-appropriate bundle + a human accountable owner.
  const reasons: string[] = [];
  if (!hasHumanAccountableOwner(task)) {
    reasons.push("needs a human accountable owner (defaults to the dispatching operator)");
  }
  const ev = evidenceCompleteForTier(task.evidence, tier);
  reasons.push(...ev.missing.map((m) => `missing ${m}`));
  if (bundleRequirementsFor(tier).prd && !bucketHasPrd) {
    reasons.push("high-risk change requires an approved bucket PRD");
  }

  return reasons.length === 0
    ? { verdict: "pass", reasons: [`agent bundle complete for ${tier}-risk change`] }
    : { verdict: "block", reasons };
}
