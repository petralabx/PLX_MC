// The compliance verifier (EN-007 decisions 2, 9, 12). Pure: given the PR's
// resolved task, actor kind, risk tier, and whether the bucket has a PRD, it
// returns a pass/block verdict plus human-readable reasons. The GitHub status
// check (P1b) wraps this; the soft-vs-hard (warn vs block) decision belongs to
// the caller, not here. Reuses the EN-003 evidence + accountability model.

import type { Evidence } from "@/lib/mc-data";
import { hasHumanAccountableOwner } from "@/lib/mc-data";
import { bundleRequirementsFor } from "./risk";
import type { RiskTier, VerifyInput, VerifyResult } from "./types";

// Is the evidence object complete enough for this tier?
//   minimal → a non-empty summary
//   note    → a non-empty summary + a non-empty, fully-done checklist + rollback
//   full    → note + change-appropriate proof (screenshots or a test run)
// A non-empty summary is required at EVERY tier, and an EMPTY checklist is never
// "complete" (review S2 — the prior code let note/full pass with no summary and
// treated `items: []` as vacuously done, which was weaker than the low tier).
export function evidenceCompleteForTier(
  ev: Evidence | undefined,
  tier: RiskTier
): { ok: boolean; missing: string[] } {
  const req = bundleRequirementsFor(tier);
  const missing: string[] = [];

  if (!ev || !ev.summary.trim()) missing.push("an evidence summary");
  if (req.evidence === "minimal") return { ok: missing.length === 0, missing };

  const checklistComplete = !!ev && ev.items.length > 0 && ev.items.every((i) => i.done);
  if (!checklistComplete) missing.push("a complete evidence checklist");
  if (req.rollback && !ev?.rollback?.trim()) missing.push("a rollback plan");
  if (req.evidence === "full" && !(ev?.shots?.length || ev?.qa)) {
    missing.push("change-appropriate proof (screenshots or a test run)");
  }
  return { ok: missing.length === 0, missing };
}

export function verifyCompliance(input: VerifyInput): VerifyResult {
  const { task, actor, tier, bucketPrd } = input;

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
  // Blocking reasons flip the verdict; advisory notes are surfaced but do not.
  const reasons: string[] = [];
  const notes: string[] = [];
  if (!hasHumanAccountableOwner(task)) {
    reasons.push("needs a human accountable owner (defaults to the dispatching operator)");
  }
  const ev = evidenceCompleteForTier(task.evidence, tier);
  reasons.push(...ev.missing.map((m) => `missing ${m}`));
  if (bundleRequirementsFor(tier).prd) {
    if (bucketPrd === "absent") {
      reasons.push("high-risk change requires an approved bucket PRD");
    } else if (bucketPrd === "unknown") {
      // No server bucket store yet (EN-005/006): the PRD requirement can't be
      // evaluated, so it is advisory — never a hard block (review S1).
      notes.push("bucket-PRD requirement not enforced yet (no bucket store) — advisory");
    }
  }

  return reasons.length === 0
    ? { verdict: "pass", reasons: [`agent bundle complete for ${tier}-risk change`, ...notes] }
    : { verdict: "block", reasons: [...reasons, ...notes] };
}
