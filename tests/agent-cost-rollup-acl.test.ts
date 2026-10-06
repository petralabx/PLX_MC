// TASK-633 — cost roll-up applies the project ACL and resolves checkout ids
// outside the sampled event window (mocked repo + snapshot, no live DB).

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EventRow } from "@/lib/compliance/repo";

const state = vi.hoisted(() => ({
  events: [] as unknown[],
  durable: new Map<string, string>(),
  lookups: [] as string[][],
}));

vi.mock("@/lib/compliance/repo", () => ({
  eventsByKinds: async () => state.events,
  taskIdsByDispatchIds: async (ids: string[]) => {
    state.lookups.push(ids);
    return new Map(ids.filter((i) => state.durable.has(i)).map((i) => [i, state.durable.get(i)!]));
  },
}));
vi.mock("@/lib/sync", () => ({
  snapshot: async () => ({
    projects: [
      { id: "P-OPEN", visibility: "shared" },
      { id: "P-SECRET", visibility: "restricted", members: ["member@plx.test"] },
    ],
    buckets: [
      { id: "BKT-OPEN", project: "P-OPEN" },
      { id: "BKT-SECRET", project: "P-SECRET" },
    ],
    tasks: [
      { id: "TASK-OPEN", bucket: "BKT-OPEN" },
      { id: "TASK-SECRET", bucket: "BKT-SECRET" },
    ],
  }),
}));

import { loadCostRollup } from "@/lib/routing/cost-rollup";
import { principalFromTokens } from "@/lib/permissions/project-acl";

let seq = 0;
function ev(kind: string, actor: string, taskId: string | null, payload: Record<string, unknown> = {}): EventRow {
  seq += 1;
  return { seq: String(seq), ts: "2026-10-06T00:00:00Z", kind, actor, repo: null, taskId, pr: null, payload };
}
const tel = (actor: string, taskId: string | null, extra = {}) =>
  ev("agent.session_telemetry", actor, taskId, { tokensIn: 10, tokensOut: 5, costCents: 100, ...extra });

beforeEach(() => {
  state.durable = new Map();
  state.lookups = [];
  state.events = [
    tel("claude-code", "TASK-OPEN"),
    ev("task.completed", "claude-code", "TASK-OPEN"),
    tel("secret-runtime", "TASK-SECRET"),
    ev("task.completed", "secret-runtime", "TASK-SECRET"),
    ev("checkout", "cursor", "TASK-SECRET", { checkoutId: "dsp_sec" }),
    tel("cursor", null, { checkoutId: "dsp_sec" }),
  ];
});

describe("loadCostRollup project ACL", () => {
  it("drops restricted-project buckets, costs, runtimes and completions for a non-member", async () => {
    const r = await loadCostRollup(principalFromTokens("outsider@plx.test"));
    expect(r.byBucket.map((b) => b.bucket)).toEqual(["BKT-OPEN"]);
    expect(r.byRuntime.map((x) => x.runtime)).toEqual(["claude-code"]);
    expect(JSON.stringify(r)).not.toMatch(/SECRET|secret|cursor/);
  });

  it("drops checkout-attributed telemetry whose checkout is only in the durable ledger", async () => {
    state.events = [tel("cursor", null, { checkoutId: "dsp_old" })];
    state.durable.set("dsp_old", "TASK-SECRET");
    const r = await loadCostRollup(principalFromTokens("outsider@plx.test"));
    expect(r.byBucket).toEqual([]);
    expect(r.byRuntime).toEqual([]);
  });

  it("still shows restricted data to a project member", async () => {
    const r = await loadCostRollup(principalFromTokens("member@plx.test"));
    expect(r.byBucket.map((b) => b.bucket)).toEqual(["BKT-OPEN", "BKT-SECRET"]);
    const secret = r.byBucket.find((b) => b.bucket === "BKT-SECRET");
    expect(secret).toMatchObject({ costCents: 200, completedTasks: 1 });
  });
});

describe("loadCostRollup durable checkout resolution", () => {
  it("attributes telemetry to the bucket when its checkout is outside the event sample", async () => {
    state.events = [tel("cursor", null, { checkoutId: "dsp_old" }), ev("task.completed", "cursor", "TASK-OPEN")];
    state.durable.set("dsp_old", "TASK-OPEN");
    const r = await loadCostRollup(principalFromTokens("outsider@plx.test"));
    expect(state.lookups).toEqual([["dsp_old"]]);
    expect(r.byBucket).toHaveLength(1);
    expect(r.byBucket[0]).toMatchObject({ bucket: "BKT-OPEN", costCents: 100, completedTasks: 1 });
  });

  it("does not query the ledger for checkouts already in the sample", async () => {
    await loadCostRollup(principalFromTokens("member@plx.test"));
    expect(state.lookups).toEqual([[]]);
  });
});
