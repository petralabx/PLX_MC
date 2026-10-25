// TASK-3901: money, migration and workflow paths need a person's approval; docs never do.
import { afterEach, describe, expect, it } from "vitest";

import { approvalPathClasses, pathApprovalMode } from "@/lib/compliance/approval-paths";

const KEYS = ["PLX_MC_PATH_APPROVAL", "PLX_MC_APPROVAL_SIGNING_KEY", "PLX_MC_APPROVAL_DECIDERS"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("approvalPathClasses", () => {
  it("finds migrations and data scripts", () => {
    expect(approvalPathClasses(["portal/prisma/migrations/20261025_x/migration.sql"])).toEqual(["migration"]);
    expect(approvalPathClasses(["db/migrations/049_nav_stars.sql"])).toEqual(["migration"]);
    expect(approvalPathClasses(["scripts/backfill-open-pr-links.mjs"])).toEqual(["migration"]);
    expect(approvalPathClasses(["scripts/db/purge-old-rows.py"])).toEqual(["migration"]);
  });

  it("finds money and trading code", () => {
    expect(approvalPathClasses(["portal/src/app/api/cron/bc-sync/route.ts"])).toEqual(["money"]);
    expect(approvalPathClasses(["src/payments/charge.ts"])).toEqual(["money"]);
    expect(approvalPathClasses(["src/trading_v2/engine.py"])).toEqual(["money"]);
  });

  it("finds workflows and the composite actions they run", () => {
    expect(approvalPathClasses([".github/workflows/ci.yml", ".github/actions/setup/action.yml"])).toEqual(["workflow"]);
  });

  it("never counts docs, and ignores look-alikes", () => {
    expect(
      approvalPathClasses([
        "docs/runbooks/BC-CRON-HTTP-PACER.md",
        "docs/migrations/notes.txt",
        "portal/src/lib/fm-migration/map.ts",
        "scripts/uat-agent/repair-handoff.mjs",
        "src/lib/costing.ts",
        ".github/CODEOWNERS",
        "src/x.ts",
      ])
    ).toEqual([]);
  });

  it("lists each class once, in a fixed order", () => {
    expect(
      approvalPathClasses([".github/workflows/a.yml", "src/billing/x.ts", "db/migrations/1.sql", "db/migrations/2.sql"])
    ).toEqual(["migration", "money", "workflow"]);
  });
});

describe("pathApprovalMode", () => {
  it("warns until approvals can be signed and deciders are set, then enforces", () => {
    for (const k of KEYS) delete process.env[k];
    expect(pathApprovalMode()).toEqual({ mode: "warn", why: "PLX_MC_APPROVAL_SIGNING_KEY is not set" });
    process.env.PLX_MC_APPROVAL_SIGNING_KEY = "k";
    expect(pathApprovalMode()).toEqual({ mode: "warn", why: "PLX_MC_APPROVAL_DECIDERS is not set" });
    process.env.PLX_MC_APPROVAL_DECIDERS = "vince@petrasoap.com";
    expect(pathApprovalMode()).toEqual({ mode: "enforce", why: null });
  });

  it("an explicit setting wins", () => {
    process.env.PLX_MC_PATH_APPROVAL = "off";
    expect(pathApprovalMode().mode).toBe("off");
    process.env.PLX_MC_PATH_APPROVAL = "ENFORCE";
    expect(pathApprovalMode().mode).toBe("enforce");
  });
});
