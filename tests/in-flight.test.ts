// TASK-2592 — the Dashboard's live In flight view. computeInFlight: grouping,
// flags, ordering and wording. loadInFlight + GET /api/in-flight: nothing from a
// project the viewer can't access, no checkout ids, no raw event payloads, and
// the session gate runs before any read.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/route";
import type { DispatchListRow, EventRow } from "@/lib/compliance/repo";
import { principalFromTokens } from "@/lib/permissions/project-acl";

const h = vi.hoisted(() => ({
  email: "outsider@petrasoap.com",
  dispatches: [] as unknown[],
  recent: [] as unknown[],
  last: [] as unknown[],
  summaries: [] as { id: string; title: string; stage: string; bucket: string }[],
  requireSessionActor: vi.fn(async () => ({})),
  latestEventsForTasks: vi.fn(),
}));

vi.mock("@/lib/compliance/repo", () => ({
  listDispatches: async () => h.dispatches,
  eventsByKinds: async () => h.recent,
  latestEventsForTasks: h.latestEventsForTasks,
}));
vi.mock("@/lib/sync/repo", () => ({
  getProjects: async () => [
    { id: "PRJ-OPEN", visibility: "shared", members: [] },
    { id: "PRJ-SECRET", visibility: "restricted", members: ["vince@petrasoap.com"] },
  ],
  getBuckets: async () => [
    { id: "BKT-OPEN", project: "PRJ-OPEN" },
    { id: "BKT-SECRET", project: "PRJ-SECRET" },
  ],
  getTaskSummaries: async (ids: string[]) => h.summaries.filter((t) => ids.includes(t.id)),
  latestTaskWriteAt: async () => "2026-10-10T16:58:00.000Z",
  getEntities: async () => {
    throw new Error("the poll must not read the whole task table");
  },
}));
vi.mock("@/lib/routing/mutations/actors", () => ({
  requireSessionActor: h.requireSessionActor,
  aclPrincipalFromSession: async () => principalFromTokens(h.email),
}));

import {
  QUIET_AFTER_MS,
  RECENT_EVENT_LIMIT,
  actorLabel,
  computeInFlight,
  describeEvent,
  loadInFlight,
} from "@/lib/compliance/in-flight";
import { GET } from "@/app/api/in-flight/route";

const NOW = new Date("2026-10-10T17:00:00.000Z");
const at = (hhmm: string) => `2026-10-10T${hhmm}:00.000Z`;

function co(taskId: string, runtime: string, issued: string, expires = "23:59"): DispatchListRow {
  return {
    id: `dsp_${taskId.toLowerCase()}${runtime}${issued.replace(":", "")}`,
    actorKind: "agent",
    runtime,
    taskId,
    accountableHuman: "cos@petrasoap.com",
    repo: "petralabx/plx-customer-portal",
    revoked: false,
    issuedAt: at(issued),
    expiresAt: at(expires),
    releasedAt: null,
    releasedReason: null,
  };
}

function ev(seq: number, kind: string, taskId: string | null, time: string, extra: Partial<EventRow> = {}): EventRow {
  return {
    seq: String(seq),
    ts: at(time),
    kind,
    actor: "claude-code",
    repo: "plx-customer-portal",
    taskId,
    pr: null,
    payload: {},
    ...extra,
  };
}

const fold = (input: Partial<Parameters<typeof computeInFlight>[0]>) =>
  computeInFlight({ checkouts: [], tasks: [], lastEvents: [], recentEvents: [], tasksUpdatedAt: null, now: NOW, ...input });

describe("computeInFlight", () => {
  it("groups open checkouts by task, newest first, and flags a task held more than once", () => {
    const report = fold({
      checkouts: [co("TASK-2470", "cursor", "11:56"), co("TASK-2470", "claude-code", "11:58"), co("TASK-2470", "cursor", "11:59")],
    });
    expect(report.tasks).toHaveLength(1);
    const [task] = report.tasks;
    expect(task.checkouts.map((c) => [c.agent, c.issuedAt])).toEqual([
      ["Cursor", at("11:59")],
      ["Claude Code", at("11:58")],
      ["Cursor", at("11:56")],
    ]);
    expect(task.multiple).toBe(true);
    expect(task.since).toBe(at("11:56"));
  });

  it("takes the newest event since checkout as the latest activity, else the checkout itself", () => {
    const report = fold({
      checkouts: [co("TASK-1", "claude-code", "13:00"), co("TASK-2", "cursor", "16:00")],
      lastEvents: [
        ev(10, "task.progress", "TASK-1", "16:30", { payload: { notes: "Wired the panel\nmore detail", progressPct: 75 } }),
        // Older than TASK-2's checkout: an earlier session's work, not this one's.
        ev(9, "pr.synchronized", "TASK-2", "15:00", { pr: "12" }),
      ],
    });
    const byId = Object.fromEntries(report.tasks.map((t) => [t.taskId, t]));
    expect(byId["TASK-1"].lastActivity).toMatchObject({ text: "75% · Wired the panel", ts: at("16:30"), by: "Claude Code" });
    expect(byId["TASK-2"].lastActivity).toMatchObject({ kind: "checkout", text: "Checked out", ts: at("16:00"), by: "Cursor" });
  });

  it("flags a task quiet once two hours pass without activity", () => {
    const quietAt = new Date(NOW.getTime() - QUIET_AFTER_MS).toISOString().slice(11, 16);
    const report = fold({ checkouts: [co("TASK-1", "claude-code", quietAt), co("TASK-2", "claude-code", "15:01")] });
    const byId = Object.fromEntries(report.tasks.map((t) => [t.taskId, t]));
    expect(byId["TASK-1"].quiet).toBe(true);
    expect(byId["TASK-2"].quiet).toBe(false);
  });

  it("flags a task whose last open checkout ends within the hour", () => {
    const report = fold({
      checkouts: [
        co("TASK-1", "claude-code", "10:00", "17:45"),
        co("TASK-2", "cursor", "10:00", "17:30"),
        co("TASK-2", "claude-code", "16:00", "23:00"),
      ],
    });
    const byId = Object.fromEntries(report.tasks.map((t) => [t.taskId, t]));
    expect(byId["TASK-1"]).toMatchObject({ expiringSoon: true, expiresAt: at("17:45") });
    expect(byId["TASK-2"]).toMatchObject({ expiringSoon: false, expiresAt: at("23:00") });
  });

  it("orders tasks by latest activity, newest first, then by task number", () => {
    const report = fold({
      checkouts: [co("TASK-10", "cursor", "12:00"), co("TASK-9", "cursor", "12:00"), co("TASK-11", "cursor", "14:00")],
    });
    expect(report.tasks.map((t) => t.taskId)).toEqual(["TASK-11", "TASK-9", "TASK-10"]);
  });

  it("fills title, stage and initiative from the task, and leaves them empty for a task MC doesn't hold", () => {
    const report = fold({
      checkouts: [co("TASK-1", "cursor", "12:00"), co("TASK-404", "cursor", "12:00")],
      tasks: [{ id: "TASK-1", title: "Wire the panel", stage: "progress", bucket: "BKT-OPEN" }],
    });
    const byId = Object.fromEntries(report.tasks.map((t) => [t.taskId, t]));
    expect(byId["TASK-1"]).toMatchObject({ title: "Wire the panel", stage: "progress", bucketId: "BKT-OPEN" });
    expect(byId["TASK-404"]).toMatchObject({ title: null, stage: null, bucketId: null });
  });

  it("returns the newest events first, capped, and never a checkout id", () => {
    const recentEvents = Array.from({ length: RECENT_EVENT_LIMIT + 5 }, (_, i) => ev(i + 1, "checkout", "TASK-1", "12:00"));
    const report = fold({ checkouts: [co("TASK-1", "claude-code", "12:00")], recentEvents });
    expect(report.events).toHaveLength(RECENT_EVENT_LIMIT);
    expect(report.events[0].seq).toBe(String(RECENT_EVENT_LIMIT + 5));
    expect(JSON.stringify(report)).not.toContain("dsp_");
  });
});

describe("describeEvent", () => {
  it.each<[string, Partial<EventRow>, string]>([
    ["checkout", {}, "Checked out"],
    ["checkout.released", { payload: { reason: "merged" } }, "Checkout released after the merge"],
    ["checkout.released", { payload: { reason: "closed" } }, "Checkout released after the PR closed"],
    ["task.progress", { payload: { notes: "  \nFirst line\nsecond", progressPct: 40.4 } }, "40% · First line"],
    ["task.progress", { payload: { stage: "review" } }, "Progress update (In Review)"],
    ["task.completed", { payload: { summary: "long private summary" } }, "Work marked complete"],
    ["task.promoted", { payload: { stage: "merged" } }, "Moved to Merged"],
    ["pr.opened", { pr: "312", payload: { title: "Private PR title" } }, "PR #312 opened"],
    ["pr.synchronized", { pr: "312" }, "PR #312 updated"],
    ["pr.merged", { pr: "312" }, "PR #312 merged"],
    ["pr.closed", {}, "A PR closed without merging"],
    ["gate.passed", { pr: "312" }, "Compliance check passed on PR #312"],
    ["gate.blocked", { pr: "312" }, "Compliance check blocked PR #312"],
  ])("%s → %s", (kind, extra, text) => {
    expect(describeEvent({ kind, pr: null, payload: {}, ...extra })).toBe(text);
  });

  it("cuts a long note to one short line", () => {
    const text = describeEvent({ kind: "task.progress", pr: null, payload: { notes: "x".repeat(400) } });
    expect(text).toHaveLength(140);
    expect(text.endsWith("…")).toBe(true);
  });
});

describe("actorLabel", () => {
  it.each([
    ["claude-code", "Claude Code"],
    ["claude-code:cos@petrasoap.com", "Claude Code"],
    ["cursor:cos@petrasoap.com", "Cursor"],
    ["human:vince@petrasoap.com", "vince@petrasoap.com"],
    ["compliance-projection", "Mission Control"],
    ["some-new-runtime", "some-new-runtime"],
  ])("%s → %s", (actor, label) => {
    expect(actorLabel(actor)).toBe(label);
  });
});

describe("loadInFlight and GET /api/in-flight", () => {
  beforeEach(() => {
    h.email = "outsider@petrasoap.com";
    h.requireSessionActor.mockReset().mockResolvedValue({});
    h.dispatches = [
      co("TASK-OPEN", "claude-code", "12:00"),
      co("TASK-SECRET", "cursor", "11:00"),
      co("TASK-GONE", "claude-code", "13:00"),
    ];
    h.summaries = [
      { id: "TASK-OPEN", title: "Open work", stage: "progress", bucket: "BKT-OPEN" },
      { id: "TASK-SECRET", title: "Secret work", stage: "review", bucket: "BKT-SECRET" },
    ];
    h.last = [
      ev(20, "task.progress", "TASK-OPEN", "16:00", { payload: { notes: "Halfway" } }),
      ev(21, "pr.opened", "TASK-SECRET", "16:10", { pr: "77", payload: { title: "Secret PR title" } }),
    ];
    h.latestEventsForTasks.mockReset().mockImplementation(async () => h.last);
    h.recent = [
      ev(31, "pr.merged", null, "16:40", { pr: "5", payload: { title: "Unstamped PR title" } }),
      ev(30, "pr.opened", "TASK-SECRET", "16:10", { pr: "77", payload: { title: "Secret PR title" } }),
      ev(29, "task.progress", "TASK-OPEN", "16:00", { payload: { notes: "Halfway" } }),
    ];
  });

  it("leaves out every trace of a restricted project for a non-member", async () => {
    const report = await loadInFlight(principalFromTokens("outsider@petrasoap.com"), NOW);
    expect(report.tasks.map((t) => t.taskId)).toEqual(["TASK-OPEN", "TASK-GONE"]);
    expect(report.events.map((e) => e.seq)).toEqual(["31", "29"]);
    expect(JSON.stringify(report)).not.toMatch(/SECRET|Secret/);
  });

  it("includes the restricted project for a member", async () => {
    const report = await loadInFlight(principalFromTokens("vince@petrasoap.com"), NOW);
    expect(report.tasks.map((t) => t.taskId)).toContain("TASK-SECRET");
    expect(report.events.map((e) => e.seq)).toEqual(["31", "30", "29"]);
  });

  it("reads latest activity from the oldest open checkout on, for the open tasks only", async () => {
    await loadInFlight(principalFromTokens("vince@petrasoap.com"), NOW);
    const [taskIds, , since] = h.latestEventsForTasks.mock.calls[0];
    expect([...taskIds].sort()).toEqual(["TASK-GONE", "TASK-OPEN", "TASK-SECRET"]);
    expect(since).toBe(at("11:00"));
  });

  it("sends no checkout ids and no event payloads", async () => {
    const body = JSON.stringify(await loadInFlight(principalFromTokens("vince@petrasoap.com"), NOW));
    expect(body).not.toContain("dsp_");
    expect(body).not.toContain("PR title");
    expect(body).not.toContain("payload");
  });

  it("serves the viewer's report in the standard envelope", async () => {
    const res = await GET(new Request("http://localhost/api/in-flight"), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(h.requireSessionActor).toHaveBeenCalledWith("task.read");
    expect(data.tasks.map((t: { taskId: string }) => t.taskId)).toEqual(["TASK-OPEN", "TASK-GONE"]);
    expect(data.tasksUpdatedAt).toBe("2026-10-10T16:58:00.000Z");
  });

  it("refuses a session the gate refuses, before reading anything", async () => {
    h.requireSessionActor.mockRejectedValue(new ApiError("forbidden", "Authenticated session with Entra oid required.", 403));
    const res = await GET(new Request("http://localhost/api/in-flight"), { params: Promise.resolve({}) });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("forbidden");
    expect(h.latestEventsForTasks).not.toHaveBeenCalled();
  });
});
