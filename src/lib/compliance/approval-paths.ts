// Vince, 2026-10-25 (TASK-3901): money, migrations and workflow files are the only
// changes that need a person. An agent PR that touches them passes the compliance
// gate only under a signed MC merge approval of its exact head (approval-signature.ts),
// decided by someone on PLX_MC_APPROVAL_DECIDERS. Everything else lands on CI and
// AI review. Operator PRs stay ungated: a person already made them.

import { approvalDeciderAllowlist } from "./approval-signature";
import { approvalSigningKey } from "@/lib/secrets";

export type ApprovalPathClass = "money" | "migration" | "workflow";

// Docs about money or migrations are not money or migrations.
const DOC_RE = /(^|\/)docs\/|\.(md|mdx|txt)$/i;

const CLASS_PATTERNS: ReadonlyArray<readonly [ApprovalPathClass, RegExp, { docs: boolean }]> = [
  // A migrations folder, or a script that backfills, purges or migrates data.
  ["migration", /(^|\/)migrations?\/|(^|\/)scripts\/(.*\/)?[^/]*(backfill|purge|migrate)[^/]*$/i, { docs: false }],
  // Business Central and ERP posting, payments, billing, invoices, ledgers, pricing, costs, and trading code.
  [
    "money",
    /(^|\/)(bc|businesscentral|bc-sync|erp|payments?|billing|invoices?|ledger|pricing|costs?)(\/|\.|-)|(^|\/)(trading|trading_v2|trading-v2|trading-research)(\/|$)/i,
    { docs: false },
  ],
  // GitHub Actions workflows and the composite actions they run.
  ["workflow", /^\.github\/(workflows|actions)\//, { docs: true }],
];

/** The classes of change in `paths` that need a person's approval, in a fixed order. */
export function approvalPathClasses(paths: readonly string[]): ApprovalPathClass[] {
  const found = new Set<ApprovalPathClass>();
  for (const path of paths) {
    for (const [cls, re, { docs }] of CLASS_PATTERNS) {
      if (re.test(path) && (docs || !DOC_RE.test(path))) found.add(cls);
    }
  }
  return CLASS_PATTERNS.map(([cls]) => cls).filter((cls) => found.has(cls));
}

export type PathApprovalMode = "enforce" | "warn" | "off";

/**
 * PLX_MC_PATH_APPROVAL: enforce, warn or off. Unset enforces once approvals can be
 * signed and the decider list is set; until then it warns, because an approval MC
 * cannot sign could never clear the gate.
 */
export function pathApprovalMode(): { mode: PathApprovalMode; why: string | null } {
  const raw = (process.env.PLX_MC_PATH_APPROVAL ?? "").trim().toLowerCase();
  if (raw === "enforce" || raw === "warn" || raw === "off") return { mode: raw, why: null };
  if (!approvalSigningKey()) return { mode: "warn", why: "PLX_MC_APPROVAL_SIGNING_KEY is not set" };
  if (approvalDeciderAllowlist().length === 0) return { mode: "warn", why: "PLX_MC_APPROVAL_DECIDERS is not set" };
  return { mode: "enforce", why: null };
}
