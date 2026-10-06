// TASK-633 — GET /api/agent-metrics?rollup=cost access check at the route
// handler. Auth matches the default path; restricted-project cost is scoped
// with the caller's ACL principal before it is returned.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/route";
import type { EventRow } from "@/lib/compliance/repo";
import { principalFromTokens } from "@/lib/permissions/project-acl";

const m = vi.hoisted(() => ({
  requireSessionActor: vi.fn(),
  aclPrincipalFromSession: vi.fn(),
  loadAgentOutcomes: vi.fn(),
  loadPrincipalOutcomes: vi.fn(),
  events: [] as unknown[],
  durable: new Map<string, string>(),
  lookups: [] as string[][],
  eventReads: 0,
  eventCallArgs: [] as unknown[][],
}));

vi.mock("@/lib/routing/mutations/actors", () => ({
  requireSessionActor: m.requireSessionActor,
  aclPrincipalFromSession: m.aclPrincipalFromSession,
}));

vi.mock("@/lib/routing/outcomes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/routing/outcomes")>();
  return {
    ...actual,
    loadAgentOutcomes: m.loadAgentOutcomes,
    loadPrincipalOutcomes: m.loadPrincipalOutcomes,
  };
});

vi.mock("@/lib/compliance/repo", () => ({
  eventsByKinds: async (...args: unknown[]) => {
    m.eventReads += 1;
    m.eventCallArgs.push(args);
    return m.events;
  },
  taskIdsByDispatchIds: async (ids: string[]) => {
    m.lookups.push(ids);
    return new Map(ids.filter((id) => m.durable.has(id)).map((id) => [id, m.durable.get(id)!]));
  },
}));

vi.mock("@/lib/sync", () => ({
  snapshot: async () => ({
    projects: [
      { id: "P-OPEN", visibility: "shared" },
      {
        id: "P-SECRET",
        visibility: "restricted",
        members: ["member@plx.test", "admin@plx.test"],
      },
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

import { GET } from "@/app/api/agent-metrics/route";

const OUTCOMES = [{ runtime: "claude-code", completed: 1 }];
const PRINCIPALS = [{ principal: "sp_open", completed: 1 }];

const call = (qs: string) =>
  GET(new Request(`http://x/api/agent-metrics${qs}`), { params: Promise.resolve({}) });

let seq = 0;
function ev(kind: string, actor: string, taskId: string | null, payload: Record<string, unknown> = {}): EventRow {
  seq += 1;
  return { seq: String(seq), ts: "2026-10-06T00:00:00Z", kind, actor, repo: null, taskId, pr: null, payload };
}
const tel = (actor: string, taskId: string | null, extra = {}) =>
  ev("agent.session_telemetry", actor, taskId, { tokensIn: 10, tokensOut: 5, costCents: 100, ...extra });

interface CostPayload {
  byRuntime: Array<{ runtime: string; costCents: number; completedTasks: number }>;
  byBucket: Array<{
    bucket: string;
    costCents: number;
    completedTasks: number;
    runtimes: Array<{ runtime: string }>;
  }>;
}

interface MetricsBody {
  outcomes: unknown;
  principals: unknown;
  windowDays: number | null;
  truncated: boolean;
  cost?: CostPayload;
}

async function bodyOf(qs: string): Promise<{ status: number; data?: MetricsBody; error?: { code: string; message: string } }> {
  const res = await call(qs);
  const json = (await res.json()) as { data?: MetricsBody; error?: { code: string; message: string } };
  return { status: res.status, data: json.data, error: json.error };
}

function expectRestrictedVisible(cost: CostPayload) {
  expect(cost.byBucket.map((b) => b.bucket)).toEqual(["BKT-OPEN", "BKT-SECRET"]);
  const secret = cost.byBucket.find((b) => b.bucket === "BKT-SECRET");
  expect(secret).toMatchObject({ costCents: 300, completedTasks: 1 });
  expect(secret?.runtimes.map((r) => r.runtime)).toEqual(["cursor", "ledger-runtime", "secret-runtime"]);
}

describe("GET /api/agent-metrics?rollup=cost", () => {
  beforeEach(() => {
    m.requireSessionActor.mockReset().mockResolvedValue({ actorId: "oid-1" });
    m.aclPrincipalFromSession.mockReset().mockResolvedValue(principalFromTokens("outsider@plx.test"));
    m.loadAgentOutcomes.mockReset().mockResolvedValue(OUTCOMES);
    m.loadPrincipalOutcomes.mockReset().mockResolvedValue({ principals: PRINCIPALS, truncated: false });
    m.durable = new Map([["dsp_old", "TASK-SECRET"]]);
    m.lookups = [];
    m.eventReads = 0;
    m.eventCallArgs = [];
    m.events = [
      tel("claude-code", "TASK-OPEN"),
      ev("task.completed", "claude-code", "TASK-OPEN"),
      tel("secret-runtime", "TASK-SECRET"),
      ev("task.completed", "secret-runtime", "TASK-SECRET"),
      ev("checkout", "cursor", "TASK-SECRET", { checkoutId: "dsp_sec" }),
      tel("cursor", null, { checkoutId: "dsp_sec" }),
      tel("ledger-runtime", null, { checkoutId: "dsp_old" }),
    ];
  });

  it("refuses an unauthenticated caller on rollup=cost exactly as on the default path", async () => {
    m.requireSessionActor.mockRejectedValue(
      new ApiError("forbidden", "Authenticated session with Entra oid required.", 403)
    );
    const cost = await bodyOf("?rollup=cost");
    const plain = await bodyOf("");
    expect(cost.status).toBe(403);
    expect(cost).toEqual(plain);
    expect(cost.error).toEqual({ code: "forbidden", message: "Authenticated session with Entra oid required." });
    expect(m.loadAgentOutcomes).not.toHaveBeenCalled();
    expect(m.loadPrincipalOutcomes).not.toHaveBeenCalled();
    expect(m.aclPrincipalFromSession).not.toHaveBeenCalled();
    expect(m.eventReads).toBe(0);
  });

  it("refuses a missing task.read permission on rollup=cost exactly as on the default path", async () => {
    m.requireSessionActor.mockRejectedValue(new ApiError("forbidden", "task.read denied (no_grant).", 403));
    const cost = await bodyOf("?rollup=cost");
    const plain = await bodyOf("?windowDays=14");
    expect(cost.status).toBe(403);
    expect(cost).toEqual(plain);
    expect(cost.error?.code).toBe("forbidden");
    expect(m.requireSessionActor).toHaveBeenCalledWith("task.read");
    expect(m.eventReads).toBe(0);
    expect(m.loadAgentOutcomes).not.toHaveBeenCalled();
  });

  it("drops restricted-project bucket, cost, runtime and completion for a non-member, including checkout-attributed telemetry", async () => {
    const { status, data } = await bodyOf("?rollup=cost");
    expect(status).toBe(200);
    expect(m.lookups).toEqual([["dsp_old"]]);
    expect(data?.cost?.byBucket.map((b) => b.bucket)).toEqual(["BKT-OPEN"]);
    expect(data?.cost?.byRuntime).toEqual([
      expect.objectContaining({ runtime: "claude-code", costCents: 100, completedTasks: 1 }),
    ]);
    expect(JSON.stringify(data?.cost)).not.toMatch(/SECRET|secret-runtime|ledger-runtime|cursor|dsp_sec|dsp_old/);
    expect(data?.outcomes).toEqual(OUTCOMES);
    expect(data?.principals).toEqual(PRINCIPALS);
    expect(data?.windowDays).toBeNull();
    expect(data?.truncated).toBe(false);
  });

  it("shows restricted-project cost to a project member", async () => {
    m.aclPrincipalFromSession.mockResolvedValue(principalFromTokens("member@plx.test"));
    const { status, data } = await bodyOf("?rollup=cost");
    expect(status).toBe(200);
    expectRestrictedVisible(data!.cost!);
  });

  it("shows restricted-project cost to an allowlisted admin", async () => {
    m.aclPrincipalFromSession.mockResolvedValue(principalFromTokens("admin@plx.test"));
    const { status, data } = await bodyOf("?rollup=cost");
    expect(status).toBe(200);
    expectRestrictedVisible(data!.cost!);
  });

  it("keeps outcomes, principals, windowDays and truncated on rollup=cost", async () => {
    const { status, data } = await bodyOf("?rollup=cost&windowDays=14");
    expect(status).toBe(200);
    expect(data?.windowDays).toBe(14);
    expect(data?.outcomes).toEqual(OUTCOMES);
    expect(data?.principals).toEqual(PRINCIPALS);
    expect(data?.truncated).toBe(false);
    expect(data?.cost?.byBucket.map((b) => b.bucket)).toEqual(["BKT-OPEN"]);
    expect(m.loadAgentOutcomes).toHaveBeenCalledWith({ windowDays: 14 });
    expect(m.loadPrincipalOutcomes).toHaveBeenCalledWith({ windowDays: 14 });
    expect(m.requireSessionActor).toHaveBeenCalledWith("task.read");
    // Cost roll-up stays on the unwindowed event sample.
    expect(m.eventCallArgs).toEqual([[expect.any(Array)]]);
  });

  it("leaves the default response unchanged when rollup is omitted", async () => {
    const { status, data } = await bodyOf("?windowDays=14");
    expect(status).toBe(200);
    expect(data).toEqual({
      outcomes: OUTCOMES,
      principals: PRINCIPALS,
      windowDays: 14,
      truncated: false,
    });
    expect(m.loadAgentOutcomes).toHaveBeenCalledWith({ windowDays: 14 });
    expect(m.loadPrincipalOutcomes).toHaveBeenCalledWith({ windowDays: 14 });
    expect(m.eventReads).toBe(0);
    expect(m.aclPrincipalFromSession).not.toHaveBeenCalled();
  });

  it("rejects invalid windowDays on rollup=cost before loading outcomes or cost", async () => {
    const { status, error } = await bodyOf("?rollup=cost&windowDays=0");
    expect(status).toBe(400);
    expect(error?.code).toBe("invalid_query");
    expect(m.loadAgentOutcomes).not.toHaveBeenCalled();
    expect(m.loadPrincipalOutcomes).not.toHaveBeenCalled();
    expect(m.eventReads).toBe(0);
    expect(m.aclPrincipalFromSession).not.toHaveBeenCalled();
  });
});
