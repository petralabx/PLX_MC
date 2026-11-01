// The compliance verifier (EN-007 decisions 2, 9, 12). Pure: given the PR's
// resolved task, actor kind, risk tier, and whether the bucket has a PRD, it
// returns a pass/block verdict plus human-readable reasons. The GitHub status
// check (P1b) wraps this; the soft-vs-hard (warn vs block) decision belongs to
// the caller, not here. Reuses the EN-003 evidence + accountability model.

import type { Evidence } from "@/lib/mc-data";
import { hasHumanAccountableOwner } from "@/lib/mc-data";
import { hasVideoArtifact, hasVisualArtifact } from "./evidence-artifacts";
import {
  VIDEO_EVIDENCE_ENFORCE_FROM,
  VISUAL_EVIDENCE_ENFORCE_FROM,
  blockingFindings,
  complexityReasons,
  describeFindings,
  evidenceStandardReport,
  requiresHumanVerification,
  videoEvidenceMode,
  visualEvidenceMode,
} from "./evidence-standard";
import { bundleRequirementsFor } from "./risk";
import type { RiskTier, VerifyInput, VerifyResult } from "./types";

// Is the evidence object complete enough for this tier?
//   minimal → a non-empty summary
//   note    → a non-empty summary + a non-empty, fully-done checklist + rollback
//   full    → note + change-appropriate proof (screenshots or a test run; an
//             uploaded screenshot artifact counts, TASK-3166)
// A non-empty summary is required at EVERY tier, and an EMPTY checklist is never
// "complete" (review S2 — the prior code let note/full pass with no summary and
// treated `items: []` as vacuously done, which was weaker than the low tier).
export function evidenceCompleteForTier(
  ev: Evidence | undefined,
  tier: RiskTier
): { ok: boolean; missing: string[] } {
  const req = bundleRequirementsFor(tier);
  const missing: string[] = [];

  // Reasons name the FIELD to send, not the abstract artifact. The checklist is
  // derived in buildTaskEvidence from verificationCommands + rollback, so "missing
  // a complete evidence checklist" sent readers hunting for an `items` field
  // that no caller supplies. Say what to do instead.
  if (!ev || !ev.summary.trim()) missing.push("an evidence summary (send `summary`)");
  if (req.evidence === "minimal") return { ok: missing.length === 0, missing };

  const checklistComplete = !!ev && ev.items.length > 0 && ev.items.every((i) => i.done);
  if (!checklistComplete) {
    missing.push(
      "a complete evidence checklist (send `verificationCommands` and `rollback` to mc_save_evidence, or to mc_complete_task after merge; the checklist is derived from them)"
    );
  }
  if (req.rollback && !ev?.rollback?.trim()) missing.push("a rollback plan (send `rollback`)");
  const screenshot = ev?.artifacts?.some((artifact) => artifact.kind === "screenshot");
  if (req.evidence === "full" && !(ev?.shots?.length || ev?.qa || screenshot)) {
    missing.push("change-appropriate proof (send `testRun` or `shots`, or upload a screenshot with mc_upload_evidence)");
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
      reasons.push("high-risk change requires a linked bucket PRD");
    } else if (bucketPrd === "no_bucket") {
      reasons.push("high-risk change requires the task on an initiative with a linked bucket PRD");
    } else if (bucketPrd === "unknown" || bucketPrd === "store_unavailable") {
      // The bucket store cannot be read (EN-005/006): advisory, never a hard
      // block (review S1). A missing initiative is no_bucket and does block.
      notes.push("bucket-PRD requirement not enforced yet (bucket store unavailable) — advisory");
    }
  }
  // Human-verification evidence standard (TASK-3165): the summary a person reads
  // is held to STE-lite. A note during the warn-only week, a reason after it.
  if (requiresHumanVerification(task.labels, tier) && task.evidence?.summary?.trim()) {
    const report = evidenceStandardReport(task.evidence.summary, true, input.now);
    const blocking = blockingFindings(report);
    const errors = report.findings.filter((finding) => finding.severity === "error");
    const line = (found: typeof errors) => `evidence summary breaks STE-lite (${found.length}): ${describeFindings(found)}`;
    if (blocking.length > 0) reasons.push(line(blocking));
    else if (errors.length > 0) notes.push(`${line(errors)} Warning only until ${report.enforceFrom.slice(0, 10)}.`);
  }
  // Visual evidence (TASK-3166): a diagram, annotated screenshot or web page that
  // a person can open. It blocks only after its week and while uploads are on.
  const uploadsOff = input.evidenceStoreProblem
    ? `Warning only: the evidence store failed its health check (${input.evidenceStoreProblem}).`
    : "Warning only: evidence uploads are off for this task.";
  if (requiresHumanVerification(task.labels, tier) && !hasVisualArtifact(task.evidence)) {
    const line = "no visual evidence: upload a diagram, annotated screenshot or web page with mc_upload_evidence.";
    if (visualEvidenceMode(input.now, input.evidenceStoreEnabled) === "block") reasons.push(line);
    else if (!input.evidenceStoreEnabled) notes.push(`${line} ${uploadsOff}`);
    else notes.push(`${line} Warning only until ${VISUAL_EVIDENCE_ENFORCE_FROM.slice(0, 10)}.`);
  }
  // Explainer video (TASK-3167): complex work a person must verify needs a short
  // video. Same rules as visual evidence, with its own week.
  const complex = requiresHumanVerification(task.labels, tier) ? complexityReasons(task, tier) : [];
  if (complex.length > 0 && !hasVideoArtifact(task.evidence)) {
    const line =
      `no explainer video: complex change (${complex.join(", ")}); ` +
      "make one with the plx-knowledge-video skill and upload it with mc_upload_evidence (kind video).";
    if (videoEvidenceMode(input.now, input.evidenceStoreEnabled) === "block") reasons.push(line);
    else if (!input.evidenceStoreEnabled) notes.push(`${line} ${uploadsOff}`);
    else notes.push(`${line} Warning only until ${VIDEO_EVIDENCE_ENFORCE_FROM.slice(0, 10)}.`);
  }

  return reasons.length === 0
    ? { verdict: "pass", reasons: [`agent bundle complete for ${tier}-risk change`, ...notes] }
    : { verdict: "block", reasons: [...reasons, ...notes] };
}
