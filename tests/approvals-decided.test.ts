// TASK-3720 — the viewer's decided history on the Approvals screen: questions
// they answered (answer.answeredBy is their sessionAuthorId) and gates they
// approved or rejected (gate.decidedBy is their session audit label, as
// decideApprovalGate stores it, matched case-insensitively), inside a window of
// days (default 14, clamped to 1..90), newest first, on ACL-visible tasks only.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApprovalGate, Bucket, Project, Task, TaskQuestion } from "@/lib/mc-data";

const authState = vi.hoisted(() => ({
  session: null as { user?: { oid?: string | null; email?: string | null } } | null,
}));

const m = vi.hoisted(() => ({
  tasks: [] as unknown[],
  buckets: [] as unknown[],
  projects: [] as unknown[],
}));

vi.mock("@/lib/auth", () => ({
  auth: async () => authState.session,
  oidcEnabled: () => true,
}));

vi.mock("@/lib/permissions/repository", () => ({
  findMcUserByEntraOid: async (oid: string) => ({
    id: "u1",
    entraOid: oid,
    email: authState.session?.user?.email ?? "",
    accessRole: "member",
    status: "active",
  }),
  findServicePrincipalById: async () => null,
}));

vi.mock("@/lib/permissions/decision-log", () => ({ recordPermissionDecision: vi.fn(async () => true) }));
vi.mock("@/lib/permissions/shadow-mismatch", () => ({ recordShadowMismatch: vi.fn(async () => undefined) }));

vi.mock("@/lib/sync/repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sync/repo")>()),
  getEntities: async () => (m.tasks as Task[]).map((task) => ({ data: task })),
  getBuckets: async () => m.buckets,
  getProjects: async () => m.projects,
}));

import * as decidedRoute from "@/app/api/approvals/decided/route";
import { decidedRows } from "@/lib/compliance/decided";

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const noCtx = { params: Promise.resolve({} as Record<string, string>) };
const RICARDO = { authorId: "ricardo", auditLabel: "ricardo@petrasoap.com" };

function answered(id: string, answeredBy: string, answeredAt: string): TaskQuestion {
  return {
    id,
    addressee: answeredBy,
    text: `Question ${id}?`,
    options: ["A", "B"],
    askedBy: "cos@petrasoap.com",
    askedByPrincipal: "sp_mcp_grok",
    askedAt: ago(30),
    status: "answered",
    answer: { choice: 0, answeredBy, answeredAt, commentId: `CMT-${id}` },
  };
}

function decided(id: string, status: ApprovalGate["status"], decidedBy?: string, decidedAt?: string): ApprovalGate {
  return {
    id,
    reason: `Gate ${id}`,
    requestedBy: "cos@petrasoap.com",
    requestedAt: ago(30),
    status,
    ...(decidedBy ? { decidedBy } : {}),
    ...(decidedAt ? { decidedAt } : {}),
  };
}

function task(id: string, bucket: string, over: Partial<Task> = {}): Task {
  return { id, title: `Task ${id}`, bucket, stage: "progress", assignee: null, coassignees: [], ...over } as Task;
}

const get = (query = "") => decidedRoute.GET(new Request(`http://test/api/approvals/decided${query}`), noCtx);
const ids = async (resp: Response) =>
  ((await resp.json()) as { data: { decided: { kind: string; question?: { id: string }; gate?: { id: string } }[] } }).data.decided.map(
    (row) => (row.kind === "question" ? row.question!.id : row.gate!.id)
  );

beforeEach(() => {
  vi.clearAllMocks();
  authState.session = { user: { oid: "oid-ricardo", email: "Ricardo@PetraSoap.com" } };
  m.projects = [
    { id: "PRJ-OPEN" } as Project,
    { id: "PRJ-SECRET", visibility: "restricted", members: ["vince"] } as Project,
  ];
  m.buckets = [
    { id: "BKT-OPEN", project: "PRJ-OPEN" },
    { id: "BKT-SECRET", project: "PRJ-SECRET" },
  ] as Bucket[];
  m.tasks = [];
});

describe("decidedRows", () => {
  it("lists the viewer's answers and gate decisions in the window, newest first", () => {
    const tasks = [
      task("TASK-1", "BKT-OPEN", {
        title: "One",
        questions: [answered("q_mine_old", "ricardo", ago(3)), answered("q_vince", "vince", ago(1))],
        approvalGates: [
          decided("apg_mine_new", "approved", "ricardo@petrasoap.com", ago(0.5)),
          decided("apg_other", "rejected", "vince@petrasoap.com", ago(1)),
          decided("apg_pending", "pending"),
        ],
      }),
      task("TASK-2", "BKT-OPEN", {
        questions: [answered("q_mine_new", "ricardo", ago(1))],
        approvalGates: [decided("apg_rejected", "rejected", "RICARDO@petrasoap.com", ago(2))],
      }),
    ];
    const rows = decidedRows(tasks, RICARDO, Date.now() - 14 * DAY);
    expect(rows.map((r) => (r.kind === "question" ? r.question.id : r.gate.id))).toEqual([
      "apg_mine_new",
      "q_mine_new",
      "apg_rejected",
      "q_mine_old",
    ]);
    expect(rows[0]).toMatchObject({ kind: "gate", taskId: "TASK-1", taskTitle: "One", decidedAt: tasks[0].approvalGates![0].decidedAt });
    expect(rows[1]).toMatchObject({ kind: "question", taskId: "TASK-2", decidedAt: tasks[1].questions![0].answer!.answeredAt });
  });

  it("drops decisions older than the window", () => {
    const tasks = [
      task("TASK-1", "BKT-OPEN", {
        questions: [answered("q_in", "ricardo", ago(6)), answered("q_out", "ricardo", ago(8))],
        approvalGates: [
          decided("apg_in", "approved", "ricardo@petrasoap.com", ago(6)),
          decided("apg_out", "approved", "ricardo@petrasoap.com", ago(8)),
        ],
      }),
    ];
    const rows = decidedRows(tasks, RICARDO, Date.now() - 7 * DAY);
    expect(rows.map((r) => (r.kind === "question" ? r.question.id : r.gate.id)).sort()).toEqual(["apg_in", "q_in"]);
  });
});

describe("GET /api/approvals/decided", () => {
  beforeEach(() => {
    m.tasks = [
      task("TASK-1", "BKT-OPEN", {
        questions: [answered("q_1h", "ricardo", ago(1 / 24)), answered("q_2d", "ricardo", ago(2))],
        approvalGates: [
          decided("apg_13d", "approved", "ricardo@petrasoap.com", ago(13)),
          decided("apg_15d", "rejected", "ricardo@petrasoap.com", ago(15)),
          decided("apg_89d", "approved", "ricardo@petrasoap.com", ago(89)),
          decided("apg_91d", "approved", "ricardo@petrasoap.com", ago(91)),
        ],
      }),
      task("TASK-SECRET", "BKT-SECRET", { questions: [answered("q_secret", "ricardo", ago(1))] }),
    ];
  });

  it("defaults to 14 days, as the session person, on tasks their ACL lets them see", async () => {
    const resp = await get();
    expect(resp.status).toBe(200);
    expect(await ids(resp)).toEqual(["q_1h", "q_2d", "apg_13d"]);
  });

  it("clamps days to 1..90", async () => {
    expect(await ids(await get("?days=0"))).toEqual(["q_1h"]);
    expect(await ids(await get("?days=-5"))).toEqual(["q_1h"]);
    expect(await ids(await get("?days=500"))).toEqual(["q_1h", "q_2d", "apg_13d", "apg_15d", "apg_89d"]);
    expect(await ids(await get("?days=3"))).toEqual(["q_1h", "q_2d"]);
  });

  it("refuses a non-numeric days with 400", async () => {
    for (const bad of ["abc", "7days", "Infinity"]) {
      const resp = await get(`?days=${bad}`);
      expect(resp.status).toBe(400);
      expect(((await resp.json()) as { error: { code: string } }).error.code).toBe("invalid_query");
    }
  });

  it("refuses a request with no signed-in session", async () => {
    authState.session = null;
    expect((await get()).status).toBe(403);
  });
});
