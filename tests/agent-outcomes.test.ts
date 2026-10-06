// TASK-632/633 — per-runtime agent outcome metrics computed from mc_events:
// success, rework, cycle time, and session token/cost telemetry.

import { describe, expect, it } from "vitest";

import { computeAgentOutcomes, computePrincipalOutcomes, windowSince } from "@/lib/routing/outcomes";
import type { EventRow } from "@/lib/compliance/repo";

let seq = 0;
function ev(
  kind: string,
  actor: string,
  ts: string,
  taskId: string | null,
  payload: Record<string, unknown> = {}
): EventRow {
  seq += 1;
  return { seq: String(seq), ts, kind, actor, repo: null, taskId, pr: null, payload };
}

describe("computeAgentOutcomes", () => {
  it("computes success rate and median cycle time per runtime", () => {
    const events = [
      ev("checkout", "claude-code", "2026-07-23T00:00:00Z", "TASK-1", { checkoutId: "dsp_1" }),
      ev("task.completed", "claude-code", "2026-07-23T01:00:00Z", "TASK-1", { checkoutId: "dsp_1" }),
      ev("checkout", "claude-code", "2026-07-23T02:00:00Z", "TASK-2", { checkoutId: "dsp_2" }),
      ev("task.completed", "claude-code", "2026-07-23T05:00:00Z", "TASK-2", { checkoutId: "dsp_2" }),
      ev("checkout", "claude-code", "2026-07-23T06:00:00Z", "TASK-3", { checkoutId: "dsp_3" }),
    ];
    const [m] = computeAgentOutcomes(events);
    expect(m.runtime).toBe("claude-code");
    expect(m.checkouts).toBe(3);
    expect(m.completed).toBe(2);
    expect(m.successRate).toBeCloseTo(2 / 3);
    // Cycles: 1h and 3h → median 2h.
    expect(m.medianCycleMs).toBe(2 * 60 * 60 * 1000);
  });

  it("counts rework: a checkout on a task that already completed once", () => {
    const events = [
      ev("checkout", "codex", "2026-07-23T00:00:00Z", "TASK-1", { checkoutId: "dsp_1" }),
      ev("task.completed", "codex", "2026-07-23T01:00:00Z", "TASK-1", { checkoutId: "dsp_1" }),
      ev("checkout", "codex", "2026-07-23T02:00:00Z", "TASK-1", { checkoutId: "dsp_2" }),
    ];
    const [m] = computeAgentOutcomes(events);
    expect(m.reworkCheckouts).toBe(1);
    expect(m.reworkRate).toBeCloseTo(1 / 2);
  });

  it("aggregates session telemetry per runtime", () => {
    const events = [
      ev("agent.session_telemetry", "claude-code", "2026-07-23T00:00:00Z", null, {
        tokensIn: 1000,
        tokensOut: 400,
        costCents: 35,
      }),
      ev("agent.session_telemetry", "claude-code", "2026-07-23T01:00:00Z", null, {
        tokensIn: 500,
        tokensOut: 100,
      }),
      ev("agent.session_telemetry", "cursor", "2026-07-23T01:00:00Z", null, {
        tokensIn: 9,
        tokensOut: 1,
        costCents: 2,
      }),
    ];
    const outcomes = computeAgentOutcomes(events);
    const claude = outcomes.find((o) => o.runtime === "claude-code")!;
    expect(claude.telemetry).toEqual({
      sessions: 2,
      tokensIn: 1500,
      tokensOut: 500,
      costCents: 35,
    });
    expect(outcomes.find((o) => o.runtime === "cursor")!.telemetry.sessions).toBe(1);
  });

  it("separates runtimes and survives events arriving out of order", () => {
    const events = [
      ev("task.completed", "a", "2026-07-23T01:00:00Z", "TASK-1", { checkoutId: "dsp_1" }),
      ev("checkout", "a", "2026-07-23T00:00:00Z", "TASK-1", { checkoutId: "dsp_1" }),
    ];
    // seq order decides fold order; the completion has the lower seq here, so
    // the checkout→completion pair cannot be matched — no negative cycles.
    const [m] = computeAgentOutcomes(events);
    expect(m.medianCycleMs).toBeNull();
    expect(m.completed).toBe(1);
  });

  it("ignores malformed telemetry numbers", () => {
    const events = [
      ev("agent.session_telemetry", "x", "2026-07-23T00:00:00Z", null, {
        tokensIn: -5,
        tokensOut: "many",
        costCents: Number.NaN,
      }),
    ];
    const [m] = computeAgentOutcomes(events);
    expect(m.telemetry).toEqual({ sessions: 1, tokensIn: 0, tokensOut: 0, costCents: 0 });
  });
});

describe("computePrincipalOutcomes (TASK-632)", () => {
  const co = (rt: string, ts: string, task: string, id: string, principal: string | null) =>
    ev("checkout", rt, ts, task, { checkoutId: id, permissionActorId: principal });
  const done = (rt: string, ts: string, task: string, id: string) =>
    ev("task.completed", rt, ts, task, { checkoutId: id });
  const gate = (kind: string, rt: string, ts: string, task: string, actorKind = "agent") =>
    ev(kind, rt, ts, task, { actorKind });

  it("keys by principal, not runtime label, with median cycle", () => {
    const [a, b] = computePrincipalOutcomes([
      co("cursor", "2026-10-01T00:00:00Z", "T1", "d1", "sp_a"),
      done("cursor", "2026-10-01T02:00:00Z", "T1", "d1"),
      co("cursor", "2026-10-01T00:00:00Z", "T2", "d2", "sp_b"),
    ]);
    expect(a.principal).toBe("sp_a");
    expect(a.runtimes).toEqual(["cursor"]);
    expect(a.successRate).toBe(1);
    expect(a.medianCycleMs).toBe(2 * 3600_000);
    expect(b.principal).toBe("sp_b");
    expect(b.successRate).toBe(0);
  });

  it("buckets checkouts without a principal as unattributed", () => {
    const [m] = computePrincipalOutcomes([co("codex", "2026-10-01T00:00:00Z", "T1", "d1", null)]);
    expect(m.principal).toBe("unattributed");
  });

  it("counts agent gate outcomes per principal and ignores operator gates", () => {
    const [m] = computePrincipalOutcomes([
      co("cursor", "2026-10-01T00:00:00Z", "T1", "d1", "sp_a"),
      gate("gate.blocked", "cursor", "2026-10-01T01:00:00Z", "T1"),
      gate("gate.passed", "cursor", "2026-10-01T02:00:00Z", "T1"),
      gate("gate.passed", "someone", "2026-10-01T02:00:00Z", "T1", "operator"),
      ev("approval.decided", "human", "2026-10-01T03:00:00Z", "T1", { decision: "rejected" }),
    ]);
    expect(m.gatePassed).toBe(1);
    expect(m.gateBlocked).toBe(1);
    expect(m.gatePassRate).toBe(0.5);
    expect(m.approvalsRejected).toBe(1);
  });

  it("counts a stage reopen once and charges it to the completing principal", () => {
    const [m] = computePrincipalOutcomes([
      co("cursor", "2026-10-01T00:00:00Z", "T1", "d1", "sp_a"),
      done("cursor", "2026-10-01T01:00:00Z", "T1", "d1"),
      ev("task.progress", "cursor:x@y", "2026-10-01T02:00:00Z", "T1", { stage: "progress" }),
      ev("task.progress", "cursor:x@y", "2026-10-01T03:00:00Z", "T1", { stage: "review" }),
    ]);
    expect(m.reopens).toBe(1);
    expect(m.reworkRate).toBe(1);
  });

  it("does not double count a re-checkout followed by progress", () => {
    const [m] = computePrincipalOutcomes([
      co("cursor", "2026-10-01T00:00:00Z", "T1", "d1", "sp_a"),
      done("cursor", "2026-10-01T01:00:00Z", "T1", "d1"),
      co("cursor", "2026-10-01T02:00:00Z", "T1", "d2", "sp_a"),
      ev("task.progress", "cursor:x@y", "2026-10-01T03:00:00Z", "T1", { stage: "progress" }),
    ]);
    expect(m.reworkCheckouts).toBe(1);
    expect(m.reopens).toBe(0);
  });

  it("does not treat progress at a done-band stage as a reopen", () => {
    const [m] = computePrincipalOutcomes([
      co("cursor", "2026-10-01T00:00:00Z", "T1", "d1", "sp_a"),
      done("cursor", "2026-10-01T01:00:00Z", "T1", "d1"),
      ev("task.progress", "cursor:x@y", "2026-10-01T02:00:00Z", "T1", { stage: "verified" }),
    ]);
    expect(m.reopens).toBe(0);
  });
});

describe("rolling window", () => {
  it("windowSince is undefined when unbounded and now-minus-days otherwise", () => {
    expect(windowSince(undefined)).toBeUndefined();
    expect(windowSince(7, Date.parse("2026-10-08T00:00:00Z"))).toBe("2026-10-01T00:00:00.000Z");
  });
});
