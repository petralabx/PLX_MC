// Cross-repo Activity summary — pure fold over mc_events + the newest
// github.backfill.report, and the session-gated GET /api/activity envelope.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { computeRepoActivity } from "@/lib/compliance/activity";
import type { BackfillReport } from "@/lib/compliance/backfill";
import type { EventRow } from "@/lib/compliance/repo";

const NOW = new Date("2026-09-25T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

let seq = 0;
function ev(kind: string, repo: string | null, ts: string, partial: Partial<EventRow> = {}): EventRow {
  seq += 1;
  return {
    seq: String(seq),
    ts,
    kind,
    actor: "claude-code",
    repo,
    taskId: null,
    pr: null,
    payload: {},
    ...partial,
  };
}

const REGISTRY = [
  { repo: "petralabx/PLX_MC", displayName: "PLX Mission Control" },
  { repo: "petralabx/plx-customer-portal", displayName: "PLX Customer Portal" },
  { repo: "petralabx/plx_secondbrain", displayName: "PLX Second Brain" },
];

function backfill(partial: Partial<BackfillReport> = {}): BackfillReport {
  return {
    generatedAt: hoursAgo(5),
    windowDays: 7,
    since: hoursAgo(5 + 7 * 24),
    repos: [
      {
        repo: "petralabx/PLX_MC",
        status: "ok",
        reason: null,
        merged: 4,
        attributed: 2,
        unattributedCount: 2,
        unattributed: [
          {
            number: 9,
            title: "Unlinked fix",
            url: "https://github.com/petralabx/PLX_MC/pull/9",
            author: "octo",
            mergedAt: hoursAgo(30),
            reason: "no_stamp",
          },
        ],
        truncated: false,
      },
      {
        repo: "petralabx/plx-customer-portal",
        status: "degraded",
        reason: "permission_denied",
        merged: 0,
        attributed: 0,
        unattributedCount: 0,
        unattributed: [],
        truncated: false,
      },
    ],
    totals: { merged: 4, unattributed: 2, degraded: 1 },
    ...partial,
  };
}

describe("computeRepoActivity", () => {
  beforeEach(() => {
    seq = 0;
  });

  it("folds events per registry repo (full or bare repo names) into activity rows", () => {
    const events = [
      // Checkout/complete carry the full slug; gate/pr events the bare name.
      ev("checkout", "petralabx/PLX_MC", hoursAgo(50)),
      ev("gate.passed", "PLX_MC", hoursAgo(40), { pr: "1" }),
      ev("gate.blocked", "PLX_MC", hoursAgo(39), { pr: "1" }),
      ev("gate.passed", "PLX_MC", hoursAgo(38), { pr: "1" }),
      ev("gate.passed", "PLX_MC", hoursAgo(37), { pr: "2" }),
      // Outside the 30-day gate window — not in the rate.
      ev("gate.blocked", "PLX_MC", hoursAgo(24 * 40), { pr: "0" }),
      ev("pr.opened", "PLX_MC", hoursAgo(10), {
        pr: "5",
        payload: { title: "Operator PR", taskIds: [] },
      }),
      ev("pr.opened", "PLX_MC", hoursAgo(9), {
        pr: "6",
        taskId: "TASK-7",
        payload: { title: "Agent PR", taskIds: ["TASK-7"] },
      }),
      ev("pr.opened", "PLX_MC", hoursAgo(8), { pr: "7", payload: { title: "Merged", taskIds: [] } }),
      ev("pr.merged", "PLX_MC", hoursAgo(2), { pr: "7" }),
      // Not a registry repo — ignored.
      ev("gate.blocked", "some-other-repo", hoursAgo(1), { pr: "1" }),
      // Portal: only old activity; no pr.* events at all.
      ev("checkout", "petralabx/plx-customer-portal", hoursAgo(24 * 12)),
    ];
    const report = computeRepoActivity({ events, registry: REGISTRY, backfill: backfill(), now: NOW });

    expect(report.generatedAt).toBe(NOW.toISOString());
    expect(report.gateWindowDays).toBe(30);
    expect(report.repos.map((r) => r.repo)).toEqual(REGISTRY.map((r) => r.repo));

    const plx = report.repos[0];
    expect(plx.displayName).toBe("PLX Mission Control");
    expect(plx.lastActivityAt).toBe(hoursAgo(2));
    expect(plx.freshness).toBe("fresh");
    expect(plx.gate).toEqual({ passed: 3, blocked: 1, blockRate: 0.25 });
    expect(plx.openPrs).toEqual({
      open: 2,
      unstamped: 1,
      items: [
        { pr: "6", title: "Agent PR", stamped: true, at: hoursAgo(9) },
        { pr: "5", title: "Operator PR", stamped: false, at: hoursAgo(10) },
      ],
    });
    expect(plx.unattributed).toMatchObject({ count: 2, status: "ok", reason: null });
    expect(plx.unattributed?.items[0].number).toBe(9);

    const portal = report.repos[1];
    expect(portal.freshness).toBe("stale");
    // No pr.* events → unknown (webhook not delivering), never a fabricated 0.
    expect(portal.openPrs).toBeNull();
    expect(portal.gate).toEqual({ passed: 0, blocked: 0, blockRate: null });
    expect(portal.unattributed).toMatchObject({ status: "degraded", reason: "permission_denied" });

    const brain = report.repos[2];
    expect(brain).toMatchObject({ lastActivityAt: null, freshness: "none", openPrs: null });
    // Registry repo absent from the backfill report → unknown.
    expect(brain.unattributed).toBeNull();

    expect(report.events).toEqual({
      newestAt: hoursAgo(1),
      oldestSampledAt: hoursAgo(24 * 40),
      sampled: events.length,
      truncated: false,
    });
    expect(report.backfill).toEqual({ generatedAt: hoursAgo(5), windowDays: 7, stale: false });
  });

  it("marks dormant repos, a stale/missing backfill, and a truncated event sample", () => {
    const events = [ev("checkout", "petralabx/PLX_MC", hoursAgo(24 * 45))];
    const stale = computeRepoActivity({
      events,
      registry: REGISTRY,
      backfill: backfill({ generatedAt: hoursAgo(48) }),
      now: NOW,
      sampleLimit: 1,
    });
    expect(stale.repos[0].freshness).toBe("dormant");
    expect(stale.backfill.stale).toBe(true);
    expect(stale.events.truncated).toBe(true);

    const never = computeRepoActivity({ events: [], registry: REGISTRY, backfill: null, now: NOW });
    expect(never.backfill).toEqual({ generatedAt: null, windowDays: null, stale: true });
    expect(never.events).toEqual({ newestAt: null, oldestSampledAt: null, sampled: 0, truncated: false });
    expect(never.repos.every((r) => r.unattributed === null && r.freshness === "none")).toBe(true);
  });
});

// ─── GET /api/activity ───────────────────────────────────────────────────────

const m = vi.hoisted(() => ({
  requireSessionActor: vi.fn(),
  eventsByKinds: vi.fn(),
}));

vi.mock("@/lib/routing/mutations/actors", () => ({
  requireSessionActor: m.requireSessionActor,
}));

vi.mock("@/lib/compliance/repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/compliance/repo")>()),
  eventsByKinds: m.eventsByKinds,
}));

import { ApiError } from "@/lib/api/route";
import { GET } from "@/app/api/activity/route";

const ctx = { params: Promise.resolve({}) };

describe("GET /api/activity", () => {
  beforeEach(() => {
    m.requireSessionActor.mockReset().mockResolvedValue({ actorId: "oid-1" });
    m.eventsByKinds.mockReset().mockImplementation(async (kinds: string[]) =>
      kinds.includes("github.backfill.report")
        ? [ev("github.backfill.report", null, hoursAgo(3), { payload: backfill() as never })]
        : [ev("gate.blocked", "PLX_MC", hoursAgo(1), { pr: "3" })]
    );
  });

  it("requires a session actor with task.read", async () => {
    m.requireSessionActor.mockRejectedValue(
      new ApiError("forbidden", "Authenticated session with Entra oid required.", 403)
    );
    const resp = await GET(new Request("http://test/api/activity"), ctx);
    expect(resp.status).toBe(403);
    expect(m.eventsByKinds).not.toHaveBeenCalled();
  });

  it("returns the { data } envelope with every registry repo", async () => {
    const resp = await GET(new Request("http://test/api/activity"), ctx);
    expect(resp.status).toBe(200);
    const { data } = await resp.json();
    expect(m.requireSessionActor).toHaveBeenCalledWith("task.read");
    expect(data.repos).toHaveLength(10);
    const plx = data.repos.find((r: { repo: string }) => r.repo === "petralabx/PLX_MC");
    expect(plx.gate).toEqual({ passed: 0, blocked: 1, blockRate: 1 });
    expect(plx.unattributed.count).toBe(2);
    expect(data.backfill.generatedAt).toBe(backfill().generatedAt);
  });
});
