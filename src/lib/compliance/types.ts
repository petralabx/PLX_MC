// EN-007 compliance gate — pure domain types. The verifier and risk classifier
// in this module are I/O-free and unit-tested (tests/compliance.test.ts). The
// persistence layer (mc_events, the dispatch ledger) and the /api/compliance
// routes build on top in a later increment — see docs/product/SYSTEM_OF_RECORD.md
// (phases P1b onward).

import type { Task } from "@/lib/mc-data";
import {
  COMPLIANCE_PROJECTION_SERVICE_PRINCIPAL_ID,
  GITHUB_ACTIONS_ROUTING_SERVICE_PRINCIPAL_ID,
} from "@/lib/permissions";

// Risk tier of a change — decides how much of the bundle is required (EN-007
// decision 12). Derived from the changed paths + labels at PR time.
export type RiskTier = "low" | "standard" | "high";

// Who authored the work, resolved from the checkout credential — never git
// metadata (decision 9). Operators are ungated (detail optional); agents are
// held to the tier-appropriate bundle.
export type ActorKind = "agent" | "operator";

// What a tier requires of the bundle. `evidence` is the floor on the evidence
// object; `rollback` and `prd` are hard requirements when true.
export interface BundleRequirement {
  evidence: "full" | "note" | "minimal";
  rollback: boolean;
  prd: boolean;
}

export interface VerifyInput {
  // The MC task the PR resolves to, or null when no checkout/link exists.
  task: Task | null;
  actor: ActorKind;
  tier: RiskTier;
  // Whether the task's initiative has an http(s) PRD link (decision 12).
  // "store_unavailable" and "unknown" stay advisory: never hard-block when the
  // bucket store cannot be read (review S1). "no_bucket" blocks.
  bucketPrd: "present" | "absent" | "no_bucket" | "store_unavailable" | "unknown";
}

export interface VerifyResult {
  verdict: "pass" | "block";
  reasons: string[];
}

/** Re-export durable SPs used by the propose + projection paths. */
export {
  GITHUB_ACTIONS_ROUTING_SERVICE_PRINCIPAL_ID,
  COMPLIANCE_PROJECTION_SERVICE_PRINCIPAL_ID,
};

/** Kill switch for operator routing proposals (never restores silent sparse Tasks). */
export function routingProposalsEnabled(): boolean {
  return (process.env.PLX_MC_ROUTING_PROPOSALS_ENABLED ?? "1").trim() !== "0";
}
