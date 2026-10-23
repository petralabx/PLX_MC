// TASK-3567 — who may ask and who may answer. Bots ask (question.ask); only a
// signed-in person answers (question.answer), and agents are context-denied
// even with a mistaken grant. The routes take the person from the session,
// never the body, and apply the project ACL. The real requireSessionActor →
// authorize path and the real ACL guard run; the session, the identity row and
// the questions service are seams (as in tests/session-gated-mutations.test.ts).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bucket, Project, Task } from "@/lib/mc-data/types";

const authState = vi.hoisted(() => ({
  session: null as { user?: { oid?: string | null; email?: string | null } } | null,
  role: "member" as "owner" | "admin" | "member",
}));

const m = vi.hoisted(() => ({
  buckets: [] as unknown[],
  projects: [] as unknown[],
  tasks: [] as unknown[],
  answerQuestion: vi.fn(async (input: Record<string, unknown>) => ({
    question: { id: input.questionId, status: "answered" },
    comment: { id: "CMT-1" },
  })),
  listOpenQuestions: vi.fn(async () => [] as unknown[]),
  remindQuestion: vi.fn(async (input: Record<string, unknown>) => ({
    question: { id: input.questionId, status: "open", reminders: [{ by: input.remindedBy }] },
    comment: { id: "CMT-2" },
  })),
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
    accessRole: authState.role,
    status: "active",
  }),
  findServicePrincipalById: async () => null,
}));

vi.mock("@/lib/permissions/decision-log", () => ({ recordPermissionDecision: vi.fn(async () => true) }));
vi.mock("@/lib/permissions/shadow-mismatch", () => ({ recordShadowMismatch: vi.fn(async () => undefined) }));

vi.mock("@/lib/sync/repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sync/repo")>()),
  getBuckets: async () => m.buckets,
  getProjects: async () => m.projects,
  getEntity: async (type: string, id: string) => {
    const task = type === "task" ? (m.tasks as Task[]).find((t) => t.id === id) : undefined;
    return task ? { data: task } : null;
  },
}));

vi.mock("@/lib/compliance/questions", () => ({
  answerQuestion: m.answerQuestion,
  listOpenQuestions: m.listOpenQuestions,
  remindQuestion: m.remindQuestion,
}));

import { authorize } from "@/lib/permissions";
import { evaluateContext } from "@/lib/permissions/predicates";
import * as answerRoute from "@/app/api/questions/answer/route";
import * as listRoute from "@/app/api/questions/route";
import * as remindRoute from "@/app/api/questions/remind/route";

const RICARDO = { user: { oid: "oid-ricardo", email: "ricardo@petrasoap.com" } };
const VINCE = { user: { oid: "oid-vince", email: "vince@petrasoap.com" } };

const post = (body: unknown, path = "answer") =>
  new Request(`http://test/api/questions/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const noCtx = { params: Promise.resolve({} as Record<string, string>) };

beforeEach(() => {
  vi.clearAllMocks();
  authState.session = RICARDO;
  authState.role = "member";
  m.buckets = [{ id: "BKT-OPEN", project: "PRJ-OPEN" } as Bucket, { id: "BKT-SECRET", project: "PRJ-SECRET" } as Bucket];
  m.projects = [
    { id: "PRJ-OPEN" } as Project,
    { id: "PRJ-SECRET", visibility: "restricted", members: ["vince@petrasoap.com"] } as Project,
  ];
  m.tasks = [
    { id: "TASK-OPEN", bucket: "BKT-OPEN" } as Task,
    { id: "TASK-SECRET", bucket: "BKT-SECRET" } as Task,
  ];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("question capabilities", () => {
  const agent = { kind: "service" as const, id: "sp_mcp_grok", status: "active" as const };
  const member = { kind: "human" as const, id: "u3", role: "member" as const, status: "active" as const };

  it("agent principals ask but never answer", () => {
    expect(authorize({ actor: agent, capability: "question.ask" }).allowed).toBe(true);
    expect(authorize({ actor: agent, capability: "question.answer" }).allowed).toBe(false);
  });

  it("the predicate refuses question.answer to any service actor, a mistaken grant included", () => {
    expect(evaluateContext(agent, { actor: agent, capability: "question.answer" })).toBe("context_denied");
  });

  it("people answer at any role, members included, and never ask", () => {
    for (const role of ["member", "admin", "owner"] as const) {
      const person = { ...member, role };
      expect(authorize({ actor: person, capability: "question.answer" }).allowed).toBe(true);
      expect(authorize({ actor: person, capability: "question.ask" }).allowed).toBe(false);
    }
  });
});

describe("POST /api/questions/answer", () => {
  it("answers as the session person, never a body field (member under enforce)", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "enforce");
    const resp = await answerRoute.POST(
      post({ taskId: "TASK-OPEN", questionId: "q_1", choice: 1, text: "note", answeredBy: "vince" }),
      noCtx
    );
    expect(resp.status).toBe(200);
    expect(m.answerQuestion).toHaveBeenCalledWith({
      taskId: "TASK-OPEN",
      questionId: "q_1",
      choice: 1,
      text: "note",
      answeredBy: "ricardo",
    });
  });

  it("passes another person's session through as that person, so the addressee check refuses them", async () => {
    authState.session = VINCE;
    authState.role = "owner";
    await answerRoute.POST(post({ taskId: "TASK-OPEN", questionId: "q_1", choice: 0 }), noCtx);
    expect(m.answerQuestion).toHaveBeenCalledWith(expect.objectContaining({ answeredBy: "vince" }));
  });

  it("refuses an empty answer before any write", async () => {
    const resp = await answerRoute.POST(post({ taskId: "TASK-OPEN", questionId: "q_1", text: "  " }), noCtx);
    expect(resp.status).toBe(400);
    expect(m.answerQuestion).not.toHaveBeenCalled();
  });

  it("refuses a task in a restricted project the person is not a member of", async () => {
    const resp = await answerRoute.POST(post({ taskId: "TASK-SECRET", questionId: "q_1", choice: 0 }), noCtx);
    expect(resp.status).toBe(403);
    expect(m.answerQuestion).not.toHaveBeenCalled();
  });

  it("refuses a request with no signed-in session", async () => {
    authState.session = null;
    const resp = await answerRoute.POST(post({ taskId: "TASK-OPEN", questionId: "q_1", choice: 0 }), noCtx);
    expect(resp.status).toBe(403);
    expect(m.answerQuestion).not.toHaveBeenCalled();
  });
});

describe("GET /api/questions", () => {
  it("lists the session person's questions under their ACL principal", async () => {
    const resp = await listRoute.GET(new Request("http://test/api/questions"), noCtx);
    expect(resp.status).toBe(200);
    expect(m.listOpenQuestions).toHaveBeenCalledWith(
      "ricardo",
      expect.objectContaining({ tokens: expect.arrayContaining(["ricardo", "ricardo@petrasoap.com"]) })
    );
  });
});

describe("POST /api/questions/remind (TASK-3720)", () => {
  it("reminds as the session person, never a body field, under their ACL principal (member under enforce)", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "enforce");
    const resp = await remindRoute.POST(post({ taskId: "TASK-OPEN", questionId: "q_1", remindedBy: "vince" }, "remind"), noCtx);
    expect(resp.status).toBe(200);
    expect(m.remindQuestion).toHaveBeenCalledWith({
      taskId: "TASK-OPEN",
      questionId: "q_1",
      remindedBy: "ricardo",
      principal: expect.objectContaining({ tokens: expect.arrayContaining(["ricardo", "ricardo@petrasoap.com"]) }),
    });
    const json = (await resp.json()) as { data: Record<string, unknown> };
    expect(json.data).toEqual({ question: { id: "q_1", status: "open", reminders: [{ by: "ricardo" }] } });
  });

  it("refuses a task in a restricted project the person is not a member of (403)", async () => {
    const resp = await remindRoute.POST(post({ taskId: "TASK-SECRET", questionId: "q_1" }, "remind"), noCtx);
    expect(resp.status).toBe(403);
    expect(m.remindQuestion).not.toHaveBeenCalled();
  });

  it("refuses a body without a question id (400) and a request with no session (403)", async () => {
    expect((await remindRoute.POST(post({ taskId: "TASK-OPEN" }, "remind"), noCtx)).status).toBe(400);
    authState.session = null;
    expect((await remindRoute.POST(post({ taskId: "TASK-OPEN", questionId: "q_1" }, "remind"), noCtx)).status).toBe(403);
    expect(m.remindQuestion).not.toHaveBeenCalled();
  });
});
