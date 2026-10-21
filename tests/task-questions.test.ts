// TASK-3567 — questions for a named person: who a question can be addressed
// to, per-person scoping, and the locked answer write-back (the answer on the
// question record plus a task comment). Only the addressee can answer, whatever
// their role; a refused attempt is audited.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Task, TaskQuestion } from "@/lib/mc-data";

const h = vi.hoisted(() => ({
  tasks: new Map<string, { data: Record<string, unknown> }>(),
  patches: [] as { id: string; patch: Record<string, unknown>; actor: string; opts: Record<string, unknown> }[],
  txEvents: [] as Record<string, unknown>[],
  events: [] as Record<string, unknown>[],
  locked: [] as string[],
}));

vi.mock("@/lib/db", () => ({
  // Runs the body with a marker query; a throw rolls back the staged writes.
  withTransaction: async (fn: (q: unknown) => Promise<unknown>) => {
    const before = new Map([...h.tasks].map(([k, v]) => [k, { data: { ...v.data } }]));
    const patches = h.patches.length;
    const txEvents = h.txEvents.length;
    try {
      return await fn("tx");
    } catch (err) {
      h.tasks = before;
      h.patches.length = patches;
      h.txEvents.length = txEvents;
      throw err;
    }
  },
}));

vi.mock("@/lib/sync", () => ({
  ensureSeeded: async () => undefined,
  patchTask: async (id: string, patch: Record<string, unknown>, actor: string, opts: Record<string, unknown>) => {
    const row = h.tasks.get(id);
    if (!row) return null;
    h.patches.push({ id, patch, actor, opts });
    const dataPatch = { ...patch };
    delete dataPatch.activityLine;
    row.data = { ...row.data, ...dataPatch };
    return row.data;
  },
}));

vi.mock("@/lib/sync/repo", () => ({
  getEntity: async (_type: string, id: string, q?: unknown, forUpdate?: boolean) => {
    if (q === "tx" && forUpdate) h.locked.push(id);
    return h.tasks.get(id) ?? null;
  },
  getEntities: async () => [...h.tasks.values()],
  getBuckets: async () => [
    { id: "BKT-OPEN", project: "PRJ-OPEN" },
    { id: "BKT-SECRET", project: "PRJ-SECRET" },
  ],
  getProjects: async () => [
    { id: "PRJ-OPEN", visibility: "shared" },
    { id: "PRJ-SECRET", visibility: "restricted", members: ["vince"] },
  ],
  stamp: () => "2026.10.21 · 17:00",
}));

vi.mock("@/lib/compliance/repo", () => ({
  appendEvent: async (e: Record<string, unknown>) => {
    h.events.push(e);
  },
  appendEventTx: async (_q: unknown, e: Record<string, unknown>) => {
    h.txEvents.push(e);
    return "1";
  },
}));

vi.mock("@/lib/permissions/decision-log", () => ({ recordPermissionDecision: async () => true }));
vi.mock("@/lib/permissions/shadow-mismatch", () => ({ recordShadowMismatch: async () => undefined }));

import {
  answerQuestion,
  askQuestion,
  listOpenQuestions,
  normalizeAddressee,
  openQuestionRows,
  questionLink,
} from "@/lib/compliance/questions";

function seedTask(id: string, over: Partial<Task> = {}): void {
  h.tasks.set(id, {
    data: { id, title: `Task ${id}`, stage: "progress", bucket: "BKT-OPEN", questions: [], comments: [], ...over },
  });
}

function question(over: Partial<TaskQuestion> = {}): TaskQuestion {
  return {
    id: "q_1",
    addressee: "ricardo",
    text: "Which posting group?",
    options: ["RAW MAT", "MFGPKG"],
    recommended: 1,
    recommendationReason: "41499 is live",
    askedBy: "cos@petrasoap.com",
    askedByPrincipal: "sp_mcp_grok",
    askedRuntime: "grok",
    askedAt: "2026-10-21T16:00:00.000Z",
    status: "open",
    ...over,
  };
}

const ask = {
  taskId: "TASK-1",
  addressee: "ricardo",
  text: "Which posting group?",
  options: ["RAW MAT", "MFGPKG"],
  recommended: 1,
  recommendationReason: "41499 is live",
  askedBy: "cos@petrasoap.com",
  askedByPrincipal: "sp_mcp_grok",
  runtime: "grok",
};

const stored = (id: string) => h.tasks.get(id)!.data as unknown as Task;

beforeEach(() => {
  h.tasks.clear();
  h.patches.length = 0;
  h.txEvents.length = 0;
  h.events.length = 0;
  h.locked.length = 0;
});

describe("normalizeAddressee", () => {
  it("takes a directory id, or an email that becomes the listed person's id", () => {
    expect(normalizeAddressee("ricardo")).toBe("ricardo");
    expect(normalizeAddressee(" Ricardo@PetraSoap.com ")).toBe("ricardo");
  });

  it("keeps a person outside the directory as their lowercased email", () => {
    expect(normalizeAddressee("Sam@Example.com")).toBe("sam@example.com");
  });

  it("refuses an agent, an unknown id and a blank", () => {
    expect(normalizeAddressee("vibes")).toBeNull();
    expect(normalizeAddressee("agent:grok")).toBeNull();
    expect(normalizeAddressee("nobody")).toBeNull();
    expect(normalizeAddressee("  ")).toBeNull();
  });
});

describe("askQuestion", () => {
  it("stores an open q_* question under the row lock and audits question.asked", async () => {
    seedTask("TASK-1");
    const { question: q, created } = await askQuestion({ ...ask, addressee: "ricardo@petrasoap.com" });
    expect(created).toBe(true);
    expect(q).toMatchObject({ addressee: "ricardo", status: "open", options: ["RAW MAT", "MFGPKG"], recommended: 1 });
    expect(q.id).toMatch(/^q_[0-9a-f]{16}$/);
    expect(h.locked).toEqual(["TASK-1"]);
    expect(h.patches[0]?.opts.query).toBe("tx");
    expect(stored("TASK-1").questions).toEqual([q]);
    expect(h.txEvents).toEqual([
      expect.objectContaining({ kind: "question.asked", actor: "cos@petrasoap.com", taskId: "TASK-1" }),
    ]);
  });

  it("does not freeze the task: no approval gate is raised", async () => {
    seedTask("TASK-1");
    await askQuestion(ask);
    expect(stored("TASK-1").approvalGates).toBeUndefined();
  });

  it("returns the open question instead of a duplicate when asked again", async () => {
    seedTask("TASK-1");
    const first = await askQuestion(ask);
    const again = await askQuestion({ ...ask, addressee: "ricardo@petrasoap.com" });
    expect(again).toEqual({ question: first.question, created: false });
    expect(stored("TASK-1").questions).toHaveLength(1);
    expect(h.txEvents).toHaveLength(1);
  });

  it("refuses an agent addressee, a bad recommendation and an unknown task", async () => {
    seedTask("TASK-1");
    await expect(askQuestion({ ...ask, addressee: "vibes" })).rejects.toMatchObject({ code: "invalid_addressee", status: 400 });
    await expect(askQuestion({ ...ask, recommended: 2 })).rejects.toMatchObject({ status: 400 });
    await expect(askQuestion({ ...ask, recommended: undefined })).rejects.toMatchObject({ status: 400 });
    await expect(askQuestion({ ...ask, taskId: "TASK-404" })).rejects.toMatchObject({ code: "not_found", status: 404 });
    expect(h.patches).toHaveLength(0);
  });

  it("links straight to the question on the Approvals screen", () => {
    expect(questionLink("q_abc")).toBe("https://mc.plxcustomer.io/?screen=approvals&question=q_abc");
  });
});

describe("per-person scoping", () => {
  it("lists only the viewer's open questions, oldest first", () => {
    const tasks = [
      { id: "TASK-1", title: "One", stage: "progress", questions: [question({ id: "q_late", askedAt: "2026-10-21T18:00:00Z" })] },
      {
        id: "TASK-2",
        title: "Two",
        stage: "backlog",
        questions: [
          question({ id: "q_early", askedAt: "2026-10-21T09:00:00Z" }),
          question({ id: "q_vince", addressee: "vince" }),
          question({ id: "q_done", status: "answered" }),
        ],
      },
    ] as Task[];
    expect(openQuestionRows(tasks, "ricardo").map((r) => r.question.id)).toEqual(["q_early", "q_late"]);
    expect(openQuestionRows(tasks, "vince").map((r) => r.question.id)).toEqual(["q_vince"]);
  });

  it("drops questions on tasks the viewer's project ACL hides", async () => {
    seedTask("TASK-1", { questions: [question({ id: "q_open" })] });
    seedTask("TASK-9", { bucket: "BKT-SECRET", questions: [question({ id: "q_secret" })] });
    const rows = await listOpenQuestions("ricardo", { tokens: ["ricardo", "ricardo@petrasoap.com"] });
    expect(rows.map((r) => r.question.id)).toEqual(["q_open"]);
  });
});

describe("answerQuestion", () => {
  it("records the addressee's choice and posts it to the task as a comment, in one locked write", async () => {
    seedTask("TASK-1", { questions: [question()], comments: [{ id: "CMT-0", author: "vince", body: "hi", ts: "x", mentions: [] }] });
    const { question: q, comment } = await answerQuestion({
      taskId: "TASK-1",
      questionId: "q_1",
      choice: 1,
      text: "use it for packaging",
      answeredBy: "ricardo",
    });
    expect(q.status).toBe("answered");
    expect(q.answer).toMatchObject({ choice: 1, text: "use it for packaging", answeredBy: "ricardo", commentId: comment.id });
    expect(Number.isNaN(Date.parse(q.answer!.answeredAt))).toBe(false);
    expect(comment).toMatchObject({ author: "ricardo", ts: "2026.10.21 · 17:00", mentions: [] });
    expect(comment.id).toMatch(/^CMT-/);
    expect(comment.body).toBe(
      "Answer to a question from grok (q_1):\nQ: Which posting group?\nA: MFGPKG (the recommended option)\nNote: use it for packaging"
    );
    const task = stored("TASK-1");
    expect(task.comments?.map((c) => c.id)).toEqual(["CMT-0", comment.id]);
    expect(task.questions).toEqual([q]);
    expect(h.locked).toEqual(["TASK-1"]);
    expect(h.patches).toHaveLength(1);
    expect(h.patches[0]?.opts.query).toBe("tx");
    expect(h.txEvents).toEqual([
      expect.objectContaining({ kind: "question.answered", actor: "ricardo", taskId: "TASK-1" }),
    ]);
  });

  it("takes a typed answer with no option", async () => {
    seedTask("TASK-1", { questions: [question({ options: [], recommended: undefined, recommendationReason: undefined })] });
    const { question: q, comment } = await answerQuestion({ taskId: "TASK-1", questionId: "q_1", text: "  ask Sam  ", answeredBy: "ricardo" });
    expect(q.answer).toMatchObject({ text: "ask Sam" });
    expect(q.answer).not.toHaveProperty("choice");
    expect(comment.body.endsWith("A: ask Sam")).toBe(true);
  });

  it("refuses anyone but the addressee, an owner included, and audits the attempt", async () => {
    seedTask("TASK-1", { questions: [question()] });
    await expect(
      answerQuestion({ taskId: "TASK-1", questionId: "q_1", choice: 0, answeredBy: "vince" })
    ).rejects.toMatchObject({ code: "not_addressee", status: 403 });
    expect(stored("TASK-1").questions?.[0]?.status).toBe("open");
    expect(stored("TASK-1").comments).toEqual([]);
    expect(h.patches).toHaveLength(0);
    expect(h.txEvents).toHaveLength(0);
    expect(h.events).toEqual([
      expect.objectContaining({ kind: "question.denied", actor: "vince", payload: { questionId: "q_1", addressee: "ricardo" } }),
    ]);
  });

  it("answers once: a second answer is a conflict", async () => {
    seedTask("TASK-1", { questions: [question()] });
    await answerQuestion({ taskId: "TASK-1", questionId: "q_1", choice: 0, answeredBy: "ricardo" });
    await expect(
      answerQuestion({ taskId: "TASK-1", questionId: "q_1", choice: 1, answeredBy: "ricardo" })
    ).rejects.toMatchObject({ code: "question_already_answered", status: 409 });
    expect(stored("TASK-1").comments).toHaveLength(1);
  });

  it("refuses an empty answer, an out-of-range choice and unknown ids", async () => {
    seedTask("TASK-1", { questions: [question()] });
    await expect(answerQuestion({ taskId: "TASK-1", questionId: "q_1", text: "  ", answeredBy: "ricardo" })).rejects.toMatchObject({ status: 400 });
    await expect(answerQuestion({ taskId: "TASK-1", questionId: "q_1", choice: 2, answeredBy: "ricardo" })).rejects.toMatchObject({ status: 400 });
    await expect(answerQuestion({ taskId: "TASK-1", questionId: "q_x", choice: 0, answeredBy: "ricardo" })).rejects.toMatchObject({ status: 404 });
    await expect(answerQuestion({ taskId: "TASK-404", questionId: "q_1", choice: 0, answeredBy: "ricardo" })).rejects.toMatchObject({ status: 404 });
    expect(h.patches).toHaveLength(0);
    expect(h.events).toHaveLength(0);
  });
});
