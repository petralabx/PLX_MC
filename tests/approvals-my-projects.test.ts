// TASK-3720 — "My projects" on the Approvals screen. A project is the viewer's
// when they are on its member list, own it, or are assigned (assignee or
// coassignee) an open task in it: not in a terminal stage and not in an
// archived bucket or project. The project ACL always bounds it. The projects
// feed lists every open question (to anyone) and every pending gate on those
// projects' tasks, oldest first. The real requireSessionActor → authorize path
// and the real ACL run; the session, the identity row and the rows are seams.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApprovalGate, Bucket, Project, Task, TaskQuestion } from "@/lib/mc-data";
import { principalFromTokens } from "@/lib/permissions/project-acl";

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

import * as projectsRoute from "@/app/api/approvals/projects/route";
import { listProjectApprovals, myProjects, projectApprovals } from "@/lib/compliance/my-projects";

const RICARDO = principalFromTokens("oid-ricardo", "ricardo@petrasoap.com", "ricardo");
const VINCE = principalFromTokens("oid-vince", "vince@petrasoap.com", "vince");
const noCtx = { params: Promise.resolve({} as Record<string, string>) };

function project(id: string, over: Partial<Project> = {}): Project {
  return { id, name: `Project ${id}`, owner: "stephen", ...over } as Project;
}

function task(id: string, bucket: string, over: Partial<Task> = {}): Task {
  return { id, title: `Task ${id}`, bucket, stage: "progress", assignee: null, coassignees: [], ...over } as Task;
}

function question(id: string, over: Partial<TaskQuestion> = {}): TaskQuestion {
  return {
    id,
    addressee: "vince",
    text: `Question ${id}?`,
    options: [],
    askedBy: "cos@petrasoap.com",
    askedByPrincipal: "sp_mcp_grok",
    askedAt: "2026-10-21T12:00:00.000Z",
    status: "open",
    ...over,
  };
}

function gate(id: string, over: Partial<ApprovalGate> = {}): ApprovalGate {
  return {
    id,
    reason: `Gate ${id}`,
    requestedBy: "cos@petrasoap.com",
    requestedAt: "2026-10-21T12:00:00.000Z",
    status: "pending",
    ...over,
  };
}

function seed(): void {
  m.projects = [
    project("PRJ-MEMBER", { members: ["Ricardo@PetraSoap.com"] }),
    project("PRJ-OWNER", { owner: "Ricardo" }),
    project("PRJ-ALL", { owner: "ricardo", members: ["ricardo"] }),
    project("PRJ-ASSIGNED"),
    project("PRJ-COASSIGNED"),
    project("PRJ-CLOSED-ONLY"),
    project("PRJ-ARCHIVED-BUCKET"),
    project("PRJ-ARCHIVED", { archivedAt: "2026-10-01T00:00:00.000Z" }),
    project("PRJ-SECRET", { visibility: "restricted", members: ["vince"], owner: "vince" }),
    project("PRJ-NOT-MINE"),
  ];
  m.buckets = [
    { id: "BKT-MEMBER", project: "PRJ-MEMBER" },
    { id: "BKT-OWNER", project: "PRJ-OWNER" },
    { id: "BKT-ALL", project: "PRJ-ALL" },
    { id: "BKT-ASSIGNED", project: "PRJ-ASSIGNED" },
    { id: "BKT-COASSIGNED", project: "PRJ-COASSIGNED" },
    { id: "BKT-CLOSED-ONLY", project: "PRJ-CLOSED-ONLY" },
    { id: "BKT-ARCHIVED-BUCKET", project: "PRJ-ARCHIVED-BUCKET", archivedAt: "2026-10-01T00:00:00.000Z" },
    { id: "BKT-ARCHIVED", project: "PRJ-ARCHIVED" },
    { id: "BKT-SECRET", project: "PRJ-SECRET" },
    { id: "BKT-NOT-MINE", project: "PRJ-NOT-MINE" },
    { id: "BKT-LOOSE", project: null },
  ] as Bucket[];
  m.tasks = [
    task("TASK-ALL", "BKT-ALL", { assignee: "ricardo" }),
    task("TASK-ASSIGNED", "BKT-ASSIGNED", { assignee: "ricardo" }),
    task("TASK-COASSIGNED", "BKT-COASSIGNED", { coassignees: ["stephen", "RICARDO"] }),
    task("TASK-MERGED", "BKT-CLOSED-ONLY", { assignee: "ricardo", stage: "merged" }),
    task("TASK-VERIFIED", "BKT-CLOSED-ONLY", { assignee: "ricardo", stage: "verified" }),
    task("TASK-CANCELLED", "BKT-CLOSED-ONLY", { coassignees: ["ricardo"], stage: "cancelled" }),
    task("TASK-ARCHIVED-BUCKET", "BKT-ARCHIVED-BUCKET", { assignee: "ricardo" }),
    task("TASK-ARCHIVED", "BKT-ARCHIVED", { assignee: "ricardo" }),
    task("TASK-SECRET", "BKT-SECRET", {
      assignee: "ricardo",
      questions: [question("q_secret", { addressee: "ricardo" })],
      approvalGates: [gate("apg_secret")],
    }),
    task("TASK-NOT-MINE", "BKT-NOT-MINE", {
      questions: [question("q_not_mine", { addressee: "ricardo" })],
      approvalGates: [gate("apg_not_mine")],
    }),
    task("TASK-LOOSE", "BKT-LOOSE", { assignee: "ricardo", questions: [question("q_loose")] }),
  ];
}

const hierarchy = (principal = RICARDO) => ({
  tasks: m.tasks as Task[],
  buckets: m.buckets as Bucket[],
  projects: m.projects as Project[],
  principal,
});

beforeEach(() => {
  vi.clearAllMocks();
  authState.session = { user: { oid: "oid-ricardo", email: "ricardo@petrasoap.com" } };
  seed();
});

describe("myProjects", () => {
  it("lists a project for each reason, in the order member, owner, assignee", () => {
    const mine = myProjects(hierarchy());
    expect(mine).toEqual([
      { id: "PRJ-MEMBER", name: "Project PRJ-MEMBER", reasons: ["member"] },
      { id: "PRJ-OWNER", name: "Project PRJ-OWNER", reasons: ["owner"] },
      { id: "PRJ-ALL", name: "Project PRJ-ALL", reasons: ["member", "owner", "assignee"] },
      { id: "PRJ-ASSIGNED", name: "Project PRJ-ASSIGNED", reasons: ["assignee"] },
      { id: "PRJ-COASSIGNED", name: "Project PRJ-COASSIGNED", reasons: ["assignee"] },
    ]);
  });

  it("does not list a project reached only through closed tasks (merged, verified, cancelled)", () => {
    expect(myProjects(hierarchy()).map((p) => p.id)).not.toContain("PRJ-CLOSED-ONLY");
    (m.tasks as Task[]).push(task("TASK-OPEN-AGAIN", "BKT-CLOSED-ONLY", { assignee: "ricardo", stage: "backlog" }));
    expect(myProjects(hierarchy()).find((p) => p.id === "PRJ-CLOSED-ONLY")?.reasons).toEqual(["assignee"]);
  });

  it("does not count an open task in an archived bucket or archived project as assigned work", () => {
    const ids = myProjects(hierarchy()).map((p) => p.id);
    expect(ids).not.toContain("PRJ-ARCHIVED-BUCKET");
    expect(ids).not.toContain("PRJ-ARCHIVED");
  });

  it("never lists a restricted project the viewer cannot access, even with a task assigned to them", () => {
    expect(myProjects(hierarchy()).map((p) => p.id)).not.toContain("PRJ-SECRET");
    expect(myProjects(hierarchy(VINCE)).find((p) => p.id === "PRJ-SECRET")?.reasons).toEqual(["member", "owner"]);
  });

  it("matches nothing for a principal with no tokens", () => {
    expect(myProjects(hierarchy(principalFromTokens()))).toEqual([]);
  });
});

describe("projectApprovals", () => {
  it("lists every open question, to anyone, and every pending gate on my projects' tasks, oldest first", () => {
    const tasks = m.tasks as Task[];
    tasks.push(
      task("TASK-Q1", "BKT-MEMBER", {
        title: "Member work",
        stage: "backlog",
        evidence: { summary: "bundle", items: [{ key: "tests" }] } as unknown as Task["evidence"],
        questions: [
          question("q_late", { askedAt: "2026-10-21T18:00:00.000Z", addressee: "ricardo" }),
          question("q_answered", { status: "answered" }),
        ],
        approvalGates: [
          gate("apg_late", { requestedAt: "2026-10-21T18:00:00.000Z" }),
          gate("apg_done", { status: "approved", decidedBy: "vince@petrasoap.com" }),
        ],
      }),
      task("TASK-Q2", "BKT-OWNER", {
        title: "Owner work",
        stage: "merged",
        questions: [question("q_early", { askedAt: "2026-10-21T09:00:00.000Z", addressee: "stephen" })],
        approvalGates: [gate("apg_early", { requestedAt: "2026-10-21T09:00:00.000Z" })],
      })
    );
    const feed = projectApprovals(hierarchy());
    expect(feed.projects.map((p) => p.id)).toEqual(["PRJ-MEMBER", "PRJ-OWNER", "PRJ-ALL", "PRJ-ASSIGNED", "PRJ-COASSIGNED"]);
    expect(feed.questions.map((r) => r.question.id)).toEqual(["q_early", "q_late"]);
    expect(feed.questions[0]).toMatchObject({ taskId: "TASK-Q2", taskTitle: "Owner work", stage: "merged", projectId: "PRJ-OWNER" });
    expect(feed.gates.map((r) => r.gate.id)).toEqual(["apg_early", "apg_late"]);
    expect(feed.gates[1]).toMatchObject({
      taskId: "TASK-Q1",
      projectId: "PRJ-MEMBER",
      evidence: { summary: "bundle", itemKeys: ["tests"] },
    });
    expect(feed.gates[0]?.evidence).toBeNull();
  });

  it("gives a non-member no restricted project, question or gate", () => {
    const feed = projectApprovals(hierarchy());
    expect(feed.projects.map((p) => p.id)).not.toContain("PRJ-SECRET");
    expect(feed.questions.map((r) => r.question.id)).not.toContain("q_secret");
    expect(feed.gates.map((r) => r.gate.id)).not.toContain("apg_secret");
    const member = projectApprovals(hierarchy(VINCE));
    expect(member.questions.map((r) => r.question.id)).toEqual(["q_secret"]);
    expect(member.gates.map((r) => r.gate.id)).toEqual(["apg_secret"]);
  });

  it("leaves out tasks outside my projects, and tasks in a bucket with no project", () => {
    const feed = projectApprovals(hierarchy());
    expect(feed.questions.map((r) => r.question.id)).not.toContain("q_not_mine");
    expect(feed.questions.map((r) => r.question.id)).not.toContain("q_loose");
    expect(feed.gates.map((r) => r.gate.id)).not.toContain("apg_not_mine");
  });
});

describe("listProjectApprovals", () => {
  it("reads every task and the ACL maps, then scopes to the principal", async () => {
    const feed = await listProjectApprovals(VINCE);
    expect(feed.projects.map((p) => p.id)).toEqual(["PRJ-SECRET"]);
    expect(feed.questions.map((r) => r.question.id)).toEqual(["q_secret"]);
  });
});

describe("GET /api/approvals/projects", () => {
  it("returns the session person's projects feed in the data envelope", async () => {
    const resp = await projectsRoute.GET(new Request("http://test/api/approvals/projects"), noCtx);
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as { data: { projects: { id: string }[]; questions: unknown[]; gates: unknown[] } };
    expect(json.data.projects.map((p) => p.id)).toEqual(["PRJ-MEMBER", "PRJ-OWNER", "PRJ-ALL", "PRJ-ASSIGNED", "PRJ-COASSIGNED"]);
    expect(json.data.questions).toEqual([]);
    expect(json.data.gates).toEqual([]);
  });

  it("refuses a request with no signed-in session", async () => {
    authState.session = null;
    const resp = await projectsRoute.GET(new Request("http://test/api/approvals/projects"), noCtx);
    expect(resp.status).toBe(403);
  });
});
