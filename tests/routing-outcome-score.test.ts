// TASK-634: outcome metrics feed routing suggestion scores. Historical pass
// rate, cycle time, and cost per completed task re-rank fuzzy candidates
// toward buckets where the requesting runtime beats its peers; no history is
// neutral and leaves the engine order untouched.

import { describe, expect, it } from "vitest";
import type { EventRow } from "@/lib/compliance/repo";
import {
  OUTCOME_MAX_POINTS,
  applyOutcomeScores,
  buildOutcomeIndex,
  scoreOutcome,
} from "@/lib/routing/outcome-score";
import type { RoutingCandidateRecord } from "@/lib/routing/types";

let seq = 0;
function ev(kind: string, actor: string, taskId: string, ts: string, payload: Record<string, unknown> = {}): EventRow {
  seq += 1;
  return { seq: String(seq), ts, kind, actor, repo: "petralabx/PLX_MC", taskId, pr: null, payload };
}

/** n checkouts by `actor` in `bucket`, `done` of them completed after `cycleH` hours at `costCents` each. */
function history(actor: string, prefix: string, n: number, done: number, cycleH: number, costCents: number) {
  const events: EventRow[] = [];
  const tasks: Array<[string, string]> = [];
  for (let i = 0; i < n; i++) {
    const taskId = `${prefix}-${actor}-${i}`;
    const checkoutId = `dsp_${prefix}_${actor}_${i}`;
    const start = Date.parse("2026-09-01T00:00:00Z") + i * 86_400_000;
    events.push(ev("checkout", actor, taskId, new Date(start).toISOString(), { checkoutId }));
    if (i < done) {
      const end = new Date(start + cycleH * 3_600_000).toISOString();
      events.push(ev("agent.session_telemetry", actor, taskId, end, { checkoutId, costCents }));
      events.push(ev("task.completed", actor, taskId, end, { checkoutId }));
    }
    tasks.push([taskId, prefix]);
  }
  return { events, tasks };
}

function candidate(rank: number, taskId: string, bucketId: string, matchScore: number, fuzzy = true): RoutingCandidateRecord {
  return {
    rank,
    taskId,
    bucketId,
    projectId: `PRJ-${bucketId}`,
    matchScore,
    authorizationTrust: fuzzy ? "fuzzy" : "author_declaration",
    reasons: ["title_overlap"],
  };
}

function seeded() {
  // cursor beats claude-cli on BKT-UI (pass rate, speed, cost); the reverse on BKT-API.
  const parts = [
    history("cursor", "BKT-UI", 5, 5, 2, 100),
    history("claude-cli", "BKT-UI", 5, 2, 10, 400),
    history("cursor", "BKT-API", 5, 1, 12, 500),
    history("claude-cli", "BKT-API", 5, 5, 3, 120),
  ];
  return buildOutcomeIndex(
    parts.flatMap((p) => p.events),
    new Map(parts.flatMap((p) => p.tasks))
  );
}

describe("routing outcome score (TASK-634)", () => {
  it("ranks the bucket where the requesting runtime performs better higher, with evidence", () => {
    const index = seeded();
    // Engine order: the BKT-API candidate leads by 3 points.
    const engine = [
      candidate(1, "TASK-A", "BKT-API", 60),
      candidate(2, "TASK-U", "BKT-UI", 57),
    ];

    const forCursor = applyOutcomeScores(engine, "cursor", index);
    expect(forCursor.map((c) => c.taskId)).toEqual(["TASK-U", "TASK-A"]);
    expect(forCursor.map((c) => c.rank)).toEqual([1, 2]);
    const ui = forCursor[0].outcomeScore;
    expect(ui.status).toBe("scored");
    expect(ui.applied).toBe(true);
    expect(ui.points).toBeGreaterThan(0);
    expect(ui.points).toBeLessThanOrEqual(OUTCOME_MAX_POINTS);
    expect(ui.evidence).toMatchObject({
      runtime: "cursor",
      bucketId: "BKT-UI",
      checkouts: 5,
      completed: 5,
      passRate: 1,
      peerRuntimes: 2,
      peerCheckouts: 10,
      peerPassRate: 0.7,
      medianCycleMs: 2 * 3_600_000,
      costPerCompletedTaskCents: 100,
    });
    expect(forCursor[0].reasons).toContain(`outcome:+${ui.points}`);
    expect(forCursor[1].outcomeScore.points).toBeLessThan(0);

    // The better lane for each bucket gets the higher component.
    const forClaude = applyOutcomeScores(engine, "claude-cli", index);
    expect(forClaude.map((c) => c.taskId)).toEqual(["TASK-A", "TASK-U"]);
    expect(scoreOutcome(index, "cursor", "BKT-UI").points).toBeGreaterThan(
      scoreOutcome(index, "claude-cli", "BKT-UI").points
    );
  });

  it("never moves exact references above or below their engine position", () => {
    const index = seeded();
    const engine = [
      candidate(1, "TASK-X", "BKT-API", 100, false),
      candidate(2, "TASK-U", "BKT-UI", 99),
    ];
    const ranked = applyOutcomeScores(engine, "cursor", index);
    expect(ranked.map((c) => c.taskId)).toEqual(["TASK-X", "TASK-U"]);
    expect(ranked[0].outcomeScore.applied).toBe(false);
    expect(ranked[0].reasons).toEqual(["title_overlap"]);
  });

  it("is neutral with no history and keeps the engine order unchanged", () => {
    const engine = [
      candidate(1, "TASK-1", "BKT-API", 60),
      candidate(2, "TASK-2", "BKT-UI", 60),
      candidate(3, "TASK-3", "BKT-UI", 41),
    ];
    for (const index of [buildOutcomeIndex([], new Map()), null]) {
      const ranked = applyOutcomeScores(engine, "cursor", index);
      expect(ranked.map((c) => [c.rank, c.taskId, c.matchScore, c.reasons])).toEqual(
        engine.map((c) => [c.rank, c.taskId, c.matchScore, c.reasons])
      );
      for (const c of ranked) {
        expect(c.outcomeScore.points).toBe(0);
        expect(c.outcomeScore.applied).toBe(false);
        expect(c.outcomeScore.status).toBe(index ? "insufficient_history" : "metrics_unavailable");
      }
    }
  });

  it("stays neutral below the minimum sample or without peers", () => {
    const thin = [history("cursor", "BKT-UI", 2, 2, 1, 10), history("claude-cli", "BKT-UI", 5, 0, 1, 10)];
    const thinIndex = buildOutcomeIndex(thin.flatMap((p) => p.events), new Map(thin.flatMap((p) => p.tasks)));
    expect(scoreOutcome(thinIndex, "cursor", "BKT-UI")).toMatchObject({ points: 0, status: "insufficient_history" });

    const solo = history("cursor", "BKT-UI", 5, 5, 1, 10);
    const soloIndex = buildOutcomeIndex(solo.events, new Map(solo.tasks));
    expect(scoreOutcome(soloIndex, "cursor", "BKT-UI")).toMatchObject({ points: 0, status: "no_peer_history" });
  });

  it("ignores events on tasks outside the visible task map", () => {
    const hidden = history("cursor", "BKT-UI", 5, 5, 1, 10);
    const index = buildOutcomeIndex(hidden.events, new Map());
    expect(index.size).toBe(0);
  });
});
