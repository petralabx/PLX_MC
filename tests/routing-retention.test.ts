// P10 — Retention expiry preserves final links/audit; provisional/detail expire.

import { describe, expect, it } from "vitest";
import {
  planRetentionActions,
  applyRetentionPlan,
  summarizeRetentionPlan,
  slaAgeHours,
  slaBreachBand,
  type RetentionRecord,
} from "@/lib/routing/retention";
import { loadRolloutConfig } from "@/lib/routing/rollout";

const NOW = new Date("2026-07-14T18:00:00.000Z");

describe("retention planning", () => {
  it("expires provisional sessions by idle 24h and absolute 7d", () => {
    const records: RetentionRecord[] = [
      {
        id: "rtx_idle",
        kind: "provisional_session",
        createdAt: "2026-07-12T17:00:00.000Z",
        lastActivityAt: "2026-07-12T17:00:00.000Z",
        absoluteExpiresAt: "2026-07-20T17:00:00.000Z",
      },
      {
        id: "rtx_absolute",
        kind: "provisional_session",
        createdAt: "2026-07-01T18:00:00.000Z",
        lastActivityAt: "2026-07-14T12:00:00.000Z",
        absoluteExpiresAt: "2026-07-08T18:00:00.000Z",
      },
      {
        id: "rtx_fresh",
        kind: "provisional_session",
        createdAt: "2026-07-14T12:00:00.000Z",
        lastActivityAt: "2026-07-14T17:00:00.000Z",
        absoluteExpiresAt: "2026-07-21T12:00:00.000Z",
      },
    ];
    const plan = planRetentionActions(records, NOW);
    expect(plan.find((p) => p.id === "rtx_idle")?.action).toBe("expire_provisional");
    expect(plan.find((p) => p.id === "rtx_absolute")?.action).toBe("expire_provisional");
    expect(plan.find((p) => p.id === "rtx_fresh")?.action).toBe("retain");
  });

  it("expires proposal detail 90d after resolution and unresolved UI after 7d", () => {
    const config = loadRolloutConfig();
    expect(config.retention.proposalDetailDaysAfterResolution).toBe(90);
    expect(config.sla.expireUnresolvedUiDays).toBe(7);

    const records: RetentionRecord[] = [
      {
        id: "prop_old",
        kind: "proposal_detail",
        resolvedAt: "2026-04-01T00:00:00.000Z",
      },
      {
        id: "prop_recent",
        kind: "proposal_detail",
        resolvedAt: "2026-07-01T00:00:00.000Z",
      },
      {
        id: "prop_unresolved_old",
        kind: "proposal_detail",
        createdAt: "2026-07-01T00:00:00.000Z",
      },
      {
        id: "cand_old",
        kind: "rejected_candidates",
        resolvedAt: "2026-03-01T00:00:00.000Z",
      },
    ];
    const plan = planRetentionActions(records, NOW);
    expect(plan.find((p) => p.id === "prop_old")?.action).toBe("expire_detail");
    expect(plan.find((p) => p.id === "prop_recent")?.action).toBe("retain");
    expect(plan.find((p) => p.id === "prop_unresolved_old")?.action).toBe(
      "expire_detail"
    );
    expect(plan.find((p) => p.id === "cand_old")?.action).toBe("expire_detail");
  });

  it("never expires final links or audit events", () => {
    const records: RetentionRecord[] = [
      {
        id: "link_1",
        kind: "final_link",
        resolvedAt: "2020-01-01T00:00:00.000Z",
      },
      {
        id: "audit_1",
        kind: "audit_event",
        createdAt: "2020-01-01T00:00:00.000Z",
      },
      {
        id: "marked",
        kind: "proposal_detail",
        resolvedAt: "2020-01-01T00:00:00.000Z",
        preserve: true,
      },
    ];
    const plan = planRetentionActions(records, NOW);
    expect(plan.every((p) => p.action === "preserve_final" || p.action === "retain")).toBe(
      true
    );
    expect(plan.find((p) => p.id === "link_1")?.action).toBe("preserve_final");
    expect(plan.find((p) => p.id === "audit_1")?.action).toBe("retain");

    const expired: string[] = [];
    const result = applyRetentionPlan(plan, {
      expireDetail: (id) => expired.push(id),
      expireProvisional: (id) => expired.push(id),
    });
    expect(expired).toEqual([]);
    expect(result.preservedFinalLinks).toBeGreaterThanOrEqual(1);
    expect(result.preservedAudit).toBe(1);
  });

  it("applyRetentionPlan only mutates expire actions", () => {
    const records: RetentionRecord[] = [
      {
        id: "rtx_x",
        kind: "provisional_session",
        lastActivityAt: "2026-07-01T00:00:00.000Z",
        createdAt: "2026-07-01T00:00:00.000Z",
      },
      {
        id: "link_keep",
        kind: "final_link",
        resolvedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const plan = planRetentionActions(records, NOW);
    const expired: string[] = [];
    applyRetentionPlan(plan, {
      expireProvisional: (id) => expired.push(id),
      expireDetail: (id) => expired.push(id),
    });
    expect(expired).toEqual(["rtx_x"]);
    expect(summarizeRetentionPlan(plan).preservedFinalLinks).toBe(1);
  });
});

describe("SLA bands", () => {
  it("maps age to ok / alert / expire", () => {
    expect(slaAgeHours("2026-07-14T12:00:00.000Z", NOW)).toBe(6);
    expect(slaBreachBand(6)).toBe("ok");
    expect(slaBreachBand(24)).toBe("alert");
    expect(slaBreachBand(24 * 7)).toBe("expire");
  });
});
