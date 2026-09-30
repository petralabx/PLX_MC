// Fleet P8b: an optional idempotency key on task create, through
// POST /api/cursor/tasks and the mc_create_task MCP tool. A repeat with the
// same key from the same principal returns the original task and creates
// nothing. The same key with a different payload gets 409. The key rides on
// the mc_events dedup keys (appendEvent), so no migration is needed. The fake
// mc_events table below keeps the unique dedup_key rule of migration 010. Its
// fake transactions stage their rows and commit them only when the whole
// transaction succeeds, and the fake advisory lock serialises one key.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@/lib/mc-data";
import type { CreateTaskInput } from "@/lib/sync";

type EventRow = {
  seq: string;
  ts: Date;
  kind: string;
  actor: string;
  repo: string | null;
  task_id: string | null;
  pr: string | null;
  payload: Record<string, unknown>;
  dedup_key: string | null;
};

type FakeQuery = ((text: string, params?: unknown[]) => Promise<unknown[]>) & {
  afterCommit?: (fn: () => void) => void;
};

const h = vi.hoisted(() => {
  const state = {
    rows: [] as EventRow[],
    tasks: [] as Record<string, unknown>[],
    createInputs: [] as Record<string, unknown>[],
    createDelayMs: 0,
    // createTask waits for this gate before its transaction (a slow or stopped call).
    createGate: null as Promise<void> | null,
    // Failure injection: the result insert throws inside the create transaction.
    failResultInsert: false,
    // The age in seconds that the fake now() gives every mc_events row.
    ageSeconds: 0,
    locks: new Map<string, Promise<void>>(),
    // How many times a transaction waited for a held claim lock.
    lockWaits: 0,
    buckets: [] as Record<string, unknown>[],
    projects: [] as Record<string, unknown>[],
  };

  function runSql(text: string, params: unknown[], staged: EventRow[] | null): unknown[] {
    const visible = staged ? [...state.rows, ...staged] : state.rows;
    if (text.includes("INSERT INTO mc_events")) {
      const [kind, actor, repo, taskId, pr, payload, dedupKey] = params as [
        string,
        string,
        string | null,
        string | null,
        string | null,
        string,
        string | null,
      ];
      if (state.failResultInsert && kind === "task.create.idempotency.result") {
        throw new Error("injected: result write failed");
      }
      // ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING
      if (dedupKey && visible.some((row) => row.dedup_key === dedupKey)) return [];
      const seq = String(visible.length + 1);
      (staged ?? state.rows).push({
        seq,
        ts: new Date("2026-09-30T12:00:00Z"),
        kind,
        actor,
        repo,
        task_id: taskId,
        pr,
        payload: JSON.parse(payload) as Record<string, unknown>,
        dedup_key: dedupKey,
      });
      return [{ seq }];
    }
    if (text.includes("EXTRACT(EPOCH FROM (now() - ts))")) {
      const [dedupKey] = params as [string];
      return visible
        .filter((row) => row.dedup_key === dedupKey)
        .slice(0, 1)
        .map((row) => ({ task_id: row.task_id, age_seconds: state.ageSeconds }));
    }
    if (text.includes("FROM mc_events") && text.includes("dedup_key = $1")) {
      const [dedupKey] = params as [string];
      return visible.filter((row) => row.dedup_key === dedupKey).slice(0, 1);
    }
    throw new Error(`unexpected SQL in test: ${text}`);
  }

  async function fakeTransaction<T>(fn: (q: FakeQuery) => Promise<T>): Promise<T> {
    const staged: EventRow[] = [];
    const commits: (() => void)[] = [];
    const held: (() => void)[] = [];
    const q: FakeQuery = async (text, params = []) => {
      if (text.includes("pg_advisory_xact_lock")) {
        const key = String(params[0]);
        if (state.locks.has(key)) state.lockWaits += 1;
        while (state.locks.has(key)) await state.locks.get(key);
        let release: () => void = () => undefined;
        state.locks.set(
          key,
          new Promise<void>((resolve) => {
            release = () => {
              state.locks.delete(key);
              resolve();
            };
          })
        );
        held.push(release);
        return [{}];
      }
      return runSql(text, params, staged);
    };
    q.afterCommit = (commit) => commits.push(commit);
    try {
      const result = await fn(q);
      // COMMIT: the staged rows and the task become visible together.
      state.rows.push(...staged);
      for (const commit of commits) commit();
      return result;
    } finally {
      for (const release of held) release();
    }
  }

  return Object.assign(state, { runSql, fakeTransaction });
});

vi.mock("@/lib/db", () => ({
  query: async (text: string, params: unknown[] = []) => h.runSql(text, params, null),
  withTransaction: h.fakeTransaction,
}));

vi.mock("@/lib/sync", () => ({
  createTask: vi.fn(
    async (
      input: CreateTaskInput,
      _attribution?: unknown,
      options?: { inTransaction?: (q: unknown, task: Task) => Promise<void> }
    ) => {
      h.createInputs.push({ ...input });
      if (h.createDelayMs) await new Promise((resolve) => setTimeout(resolve, h.createDelayMs));
      if (h.createGate) await h.createGate;
      if (input.title === "boom") {
        const { ApiError } = await import("@/lib/api/route");
        throw new ApiError("invalid_repos", "repos must be registry ids", 422);
      }
      const task = { id: `TASK-${900 + h.tasks.length}`, stage: "backlog", ...input };
      // Like the real createTask: the task row and the inTransaction writes
      // commit together, or not at all.
      await h.fakeTransaction(async (q) => {
        if (options?.inTransaction) await options.inTransaction(q, task as unknown as Task);
        q.afterCommit?.(() => h.tasks.push(task));
      });
      return task as unknown as Task;
    }
  ),
  patchTask: vi.fn(async () => null),
  snapshot: vi.fn(async () => ({
    tasks: h.tasks,
    buckets: h.buckets,
    projects: h.projects,
    conflicts: [],
    errors: [],
    lastSweep: null,
  })),
}));

vi.mock("@/lib/sync/repo", () => ({
  getEntity: vi.fn(async (_kind: string, id: string) => {
    const task = h.tasks.find((row) => row.id === id);
    return task ? { data: task } : null;
  }),
  getBuckets: vi.fn(async () => h.buckets),
  getProjects: vi.fn(async () => h.projects),
}));

vi.mock("@/lib/mcp/sync-meta", () => ({
  syncMetaForTask: vi.fn(async () => ({ status: "queued" })),
}));

vi.mock("@/lib/compliance/service", () => ({
  checkout: vi.fn(),
  complete: vi.fn(),
}));

vi.mock("@/lib/compliance/go-live-announcer", () => ({
  announceGoLiveEventSafe: async () => undefined,
}));

vi.mock("@/lib/mcp/audit", () => ({
  recordMcpToolCall: vi.fn(async () => "1"),
}));

vi.mock("@/lib/permissions/decision-log", () => ({
  recordPermissionDecision: vi.fn(async () => true),
}));


import { POST as mcpPost } from "@/app/api/cursor/mcp/route";
import { POST as tasksPost } from "@/app/api/cursor/tasks/route";
import type { TxQuery } from "@/lib/db";
import { syncMetaForTask } from "@/lib/mcp/sync-meta";
import {
  runIdempotentTaskCreate,
  taskCreatePayloadHash,
  type PersistIdempotencyResult,
} from "@/lib/mcp/task-create-idempotency";

const ctx = { params: Promise.resolve({}) };

const KEYS: Record<string, string> = {
  sp_mcp_claude_code: "claude-key",
  sp_mcp_portal: "portal-key",
};

function headers(key: string): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "x-api-key": key,
    "x-mc-operator-email": "vince@petrasoap.com",
    "x-mc-repo": "petralabx/PLX_MC",
    "x-mc-runtime": "portal-cos",
  };
}

type CreateData = { taskId: string; task: { id: string; title: string }; replayed?: boolean };

async function restCreate(body: Record<string, unknown>, key = "portal-key") {
  const resp = await tasksPost(
    new Request("http://test/api/cursor/tasks", {
      method: "POST",
      headers: headers(key),
      body: JSON.stringify(body),
    }),
    ctx
  );
  const json = (await resp.json()) as { data?: CreateData; error?: { code: string; message: string } };
  return { status: resp.status, json };
}

async function toolCreate(args: Record<string, unknown>, key = "portal-key") {
  const res = await mcpPost(
    new Request("http://test/api/cursor/mcp", {
      method: "POST",
      headers: headers(key),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "mc_create_task", arguments: args },
      }),
    })
  );
  expect(res.status).toBe(200);
  const json = (await res.json()) as {
    result: { content: { type: string; text: string }[]; isError?: boolean };
  };
  const text = json.result.content[0].text;
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = { text };
  }
  return { isError: json.result.isError === true, body };
}

const TASK = {
  title: "Delegated by COS",
  bucket: "BKT-INFRA",
  priority: "high",
  assignee: "agent:hasitha-fernando",
};

beforeEach(() => {
  vi.stubEnv("PLX_MC_MCP_ENABLED", "1");
  vi.stubEnv("PLX_MC_MCP_API_KEY", "");
  vi.stubEnv("PLX_MC_MCP_AGENT_KEYS", JSON.stringify(KEYS));
  vi.stubEnv("PLX_MC_ALLOWED_USERS", "vince@petrasoap.com");
  h.rows.length = 0;
  h.tasks.length = 0;
  h.createInputs.length = 0;
  h.createDelayMs = 0;
  h.createGate = null;
  h.failResultInsert = false;
  h.ageSeconds = 0;
  h.locks.clear();
  h.lockWaits = 0;
  h.buckets = [{ id: "BKT-INFRA", name: "Infra", project: null }];
  h.projects = [];
});

// Moves a created task into a restricted project that the caller is not a member of.
function moveTaskIntoRestrictedProject(taskId: string) {
  h.buckets.push({ id: "BKT-SECRET", name: "Secret", project: "PRJ-SECRET" });
  h.projects.push({
    id: "PRJ-SECRET",
    name: "Secret",
    visibility: "restricted",
    members: ["someone-else@petrasoap.com"],
  });
  const task = h.tasks.find((row) => row.id === taskId);
  if (!task) throw new Error(`no ${taskId}`);
  task.bucket = "BKT-SECRET";
  task.title = "Secret title";
}

// A gate that holds createTask before its transaction until the test opens it.
function holdCreate(): () => void {
  let open: () => void = () => undefined;
  h.createGate = new Promise<void>((resolve) => (open = resolve));
  return open;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/cursor/tasks with an idempotency key", () => {
  it("returns the original task for a repeat and creates nothing", async () => {
    const first = await restCreate({ ...TASK, idempotencyKey: "cos-run-42" });
    expect(first.status).toBe(200);
    expect(first.json.data).toMatchObject({ taskId: "TASK-900" });
    expect(first.json.data?.replayed).toBeUndefined();

    const repeat = await restCreate({ ...TASK, idempotencyKey: "cos-run-42" });
    expect(repeat.status).toBe(200);
    expect(repeat.json.data).toMatchObject({
      taskId: "TASK-900",
      task: { id: "TASK-900", title: "Delegated by COS" },
      replayed: true,
    });
    expect(h.tasks).toHaveLength(1);
    expect(h.createInputs).toHaveLength(1);
  });

  it("does not pass the key into the task", async () => {
    await restCreate({ ...TASK, idempotencyKey: "cos-run-42" });
    expect(h.createInputs[0]).not.toHaveProperty("idempotencyKey");
  });

  it("records the claim and the result on mc_events dedup keys", async () => {
    await restCreate({ ...TASK, idempotencyKey: "cos-run-42" });
    expect(h.rows.map((row) => [row.kind, row.dedup_key, row.task_id])).toEqual([
      ["task.create.idempotency", "task.create.idempotency:sp_mcp_portal:cos-run-42", null],
      [
        "task.create.idempotency.result",
        "task.create.idempotency:sp_mcp_portal:cos-run-42:task",
        "TASK-900",
      ],
    ]);
  });

  it("gives 409 for the same key with a different payload and creates nothing", async () => {
    await restCreate({ ...TASK, idempotencyKey: "cos-run-42" });
    const changed = await restCreate({ ...TASK, title: "Another title", idempotencyKey: "cos-run-42" });
    expect(changed.status).toBe(409);
    expect(changed.json.error?.code).toBe("idempotency_key_reused");
    expect(changed.json.data).toBeUndefined();
    const noAssignee = await restCreate({
      title: TASK.title,
      bucket: TASK.bucket,
      priority: TASK.priority,
      idempotencyKey: "cos-run-42",
    });
    expect(noAssignee.status).toBe(409);
    expect(h.tasks).toHaveLength(1);
  });

  it("creates a new task for a new key", async () => {
    await restCreate({ ...TASK, idempotencyKey: "cos-run-42" });
    const other = await restCreate({ ...TASK, idempotencyKey: "cos-run-43" });
    expect(other.status).toBe(200);
    expect(other.json.data?.taskId).toBe("TASK-901");
    expect(h.tasks).toHaveLength(2);
  });

  it("keeps each principal's keys apart", async () => {
    const body = { title: "Shared key", bucket: "BKT-INFRA", idempotencyKey: "same-key" };
    const portal = await restCreate(body, "portal-key");
    const claude = await restCreate(body, "claude-key");
    expect(portal.status).toBe(200);
    expect(claude.status).toBe(200);
    expect(portal.json.data?.taskId).toBe("TASK-900");
    expect(claude.json.data?.taskId).toBe("TASK-901");
    expect(claude.json.data?.replayed).toBeUndefined();
    expect(h.tasks).toHaveLength(2);
  });

  it("keeps the old behaviour without a key", async () => {
    await restCreate(TASK);
    await restCreate(TASK);
    expect(h.tasks).toHaveLength(2);
    expect(h.rows).toEqual([]);
  });

  it("creates one task for concurrent repeats of the same key", async () => {
    h.createDelayMs = 40;
    const results = await Promise.all(
      Array.from({ length: 5 }, () => restCreate({ ...TASK, idempotencyKey: "cos-run-77" }))
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(new Set(results.map((r) => r.json.data?.taskId))).toEqual(new Set(["TASK-900"]));
    expect(results.filter((r) => r.json.data?.replayed === true)).toHaveLength(4);
    expect(h.createInputs).toHaveLength(1);
    expect(h.tasks).toHaveLength(1);
  });

  it("creates one task when concurrent calls share a key but not a payload", async () => {
    h.createDelayMs = 40;
    const [a, b] = await Promise.all([
      restCreate({ ...TASK, idempotencyKey: "cos-run-78" }),
      restCreate({ ...TASK, title: "Other", idempotencyKey: "cos-run-78" }),
    ]);
    expect([a.status, b.status]).toEqual([200, 409]);
    expect(b.json.error?.code).toBe("idempotency_key_reused");
    expect(h.tasks).toHaveLength(1);
  });

  it("gives 409 for a repeat after the first create failed, and creates nothing", async () => {
    const first = await restCreate({ title: "boom", bucket: "BKT-INFRA", idempotencyKey: "k-fail" });
    expect(first.status).toBe(422);
    const repeat = await restCreate({ title: "boom", bucket: "BKT-INFRA", idempotencyKey: "k-fail" });
    expect(repeat.status).toBe(409);
    expect(repeat.json.error?.code).toBe("idempotency_key_failed");
    expect(h.createInputs).toHaveLength(1);
    expect(h.rows.map((row) => row.kind)).toEqual([
      "task.create.idempotency",
      "task.create.idempotency.failed",
    ]);
  });

  it("does not use up the key when a check fails before the create", async () => {
    // sp_mcp_claude_code may not set an agent: assignee (fleet P8).
    const refused = await restCreate({ ...TASK, idempotencyKey: "k-refused" }, "claude-key");
    expect(refused.status).toBe(403);
    expect(h.rows).toEqual([]);
    const allowed = await restCreate(
      { ...TASK, assignee: "vince", idempotencyKey: "k-refused" },
      "claude-key"
    );
    expect(allowed.status).toBe(200);
    expect(h.tasks).toHaveLength(1);
  });

  const malformed: unknown[] = ["", "a:b", "has space", "x".repeat(129), 42, null];
  for (const idempotencyKey of malformed) {
    it(`gives 400 for idempotencyKey ${JSON.stringify(idempotencyKey)?.slice(0, 20)}`, async () => {
      const resp = await restCreate({ ...TASK, idempotencyKey });
      expect(resp.status).toBe(400);
      expect(resp.json.error?.code).toBe("invalid_request");
      expect(h.tasks).toHaveLength(0);
      expect(h.rows).toEqual([]);
    });
  }

  it("gives 401 with no key", async () => {
    const resp = await restCreate({ ...TASK, idempotencyKey: "cos-run-42" }, "wrong-key");
    expect(resp.status).toBe(401);
    expect(h.rows).toEqual([]);
  });

  it("rolls the task back when its result write fails, and a retry creates nothing", async () => {
    // Failure injection: the result insert throws inside the create transaction.
    h.failResultInsert = true;
    const first = await restCreate({ ...TASK, idempotencyKey: "k-atomic" });
    expect(first.status).toBe(500);
    // No task exists without its result.
    expect(h.tasks).toEqual([]);
    expect(h.rows.map((row) => [row.kind, row.payload.error ?? null])).toEqual([
      ["task.create.idempotency", null],
      ["task.create.idempotency.failed", "internal"],
    ]);
    h.failResultInsert = false;
    const retry = await restCreate({ ...TASK, idempotencyKey: "k-atomic" });
    expect(retry.status).toBe(409);
    expect(retry.json.error?.code).toBe("idempotency_key_failed");
    expect(h.createInputs).toHaveLength(1);
    expect(h.tasks).toEqual([]);
  });

  it("closes an abandoned claim, and the late first call rolls its task back", async () => {
    // The first call claims the key, then stops before its create commits.
    const open = holdCreate();
    const first = restCreate({ ...TASK, idempotencyKey: "k-stopped" });
    await vi.waitFor(() => expect(h.createInputs).toHaveLength(1));
    h.ageSeconds = 300;
    const retry = await restCreate({ ...TASK, idempotencyKey: "k-stopped" });
    expect(retry.status).toBe(409);
    expect(retry.json.error?.code).toBe("idempotency_key_failed");
    expect(
      h.rows.find((row) => row.kind === "task.create.idempotency.failed")?.payload.error
    ).toBe("abandoned");
    // The first call resumes after the claim closed: its task rolls back.
    open();
    const late = await first;
    expect(late.status).toBe(409);
    expect(late.json.error?.code).toBe("idempotency_key_failed");
    expect(h.tasks).toEqual([]);
    expect(h.createInputs).toHaveLength(1);
    expect(h.rows.some((row) => row.kind === "task.create.idempotency.result")).toBe(false);
  });

  it("refuses a replay after the task moved into a restricted project", async () => {
    const first = await restCreate({ ...TASK, idempotencyKey: "k-moved" });
    expect(first.status).toBe(200);
    moveTaskIntoRestrictedProject("TASK-900");
    vi.mocked(syncMetaForTask).mockClear();
    const replay = await restCreate({ ...TASK, idempotencyKey: "k-moved" });
    expect(replay.status).toBe(403);
    expect(replay.json.error?.code).toBe("project_acl_denied");
    expect(replay.json.data).toBeUndefined();
    expect(JSON.stringify(replay.json)).not.toContain("Secret title");
    expect(syncMetaForTask).not.toHaveBeenCalled();
    expect(h.tasks).toHaveLength(1);
  });

  it("still replays for a member of the task's new restricted project", async () => {
    await restCreate({ ...TASK, idempotencyKey: "k-member" });
    moveTaskIntoRestrictedProject("TASK-900");
    h.projects[0].members = ["vince@petrasoap.com"];
    const replay = await restCreate({ ...TASK, idempotencyKey: "k-member" });
    expect(replay.status).toBe(200);
    expect(replay.json.data).toMatchObject({ taskId: "TASK-900", replayed: true });
    expect(h.tasks).toHaveLength(1);
  });
});

describe("mc_create_task with an idempotency key", () => {
  it("returns the original task for a repeat and creates nothing", async () => {
    const args = { ...TASK, reporter: "cos@petrasoap.com", idempotencyKey: "tool-run-1" };
    const first = await toolCreate(args);
    expect(first.isError).toBe(false);
    expect(first.body).toMatchObject({ taskId: "TASK-900" });
    const repeat = await toolCreate(args);
    expect(repeat.isError).toBe(false);
    expect(repeat.body).toMatchObject({ taskId: "TASK-900", replayed: true });
    expect(h.tasks).toHaveLength(1);
  });

  it("matches a REST create with the same key and payload", async () => {
    await restCreate({ ...TASK, idempotencyKey: "both-1" });
    const repeat = await toolCreate({ ...TASK, reporter: "cos@petrasoap.com", idempotencyKey: "both-1" });
    expect(repeat.isError).toBe(false);
    expect(repeat.body).toMatchObject({ taskId: "TASK-900", replayed: true });
    expect(h.tasks).toHaveLength(1);
  });

  it("gives a 409 error for the same key with a different payload", async () => {
    await toolCreate({ ...TASK, reporter: "cos@petrasoap.com", idempotencyKey: "tool-run-2" });
    const changed = await toolCreate({
      ...TASK,
      priority: "low",
      reporter: "cos@petrasoap.com",
      idempotencyKey: "tool-run-2",
    });
    expect(changed.isError).toBe(true);
    expect(changed.body).toMatchObject({ error: { code: "idempotency_key_reused" } });
    expect(h.tasks).toHaveLength(1);
  });

  it("creates one task for concurrent repeats", async () => {
    h.createDelayMs = 40;
    const args = { ...TASK, reporter: "cos@petrasoap.com", idempotencyKey: "tool-run-3" };
    const results = await Promise.all([toolCreate(args), toolCreate(args), toolCreate(args)]);
    expect(results.map((r) => r.isError)).toEqual([false, false, false]);
    expect(new Set(results.map((r) => r.body.taskId))).toEqual(new Set(["TASK-900"]));
    expect(h.createInputs).toHaveLength(1);
  });

  it("refuses a malformed key", async () => {
    const result = await toolCreate({ ...TASK, reporter: "cos@petrasoap.com", idempotencyKey: "a:b" });
    expect(result.isError).toBe(true);
    expect(h.tasks).toHaveLength(0);
    expect(h.rows).toEqual([]);
  });

  it("refuses a replay after the task moved into a restricted project", async () => {
    const args = { ...TASK, reporter: "cos@petrasoap.com", idempotencyKey: "tool-moved" };
    const first = await toolCreate(args);
    expect(first.isError).toBe(false);
    moveTaskIntoRestrictedProject("TASK-900");
    vi.mocked(syncMetaForTask).mockClear();
    const replay = await toolCreate(args);
    expect(replay.isError).toBe(true);
    expect(replay.body).toMatchObject({ error: { code: "project_acl_denied" } });
    expect(JSON.stringify(replay.body)).not.toContain("Secret title");
    expect(replay.body).not.toHaveProperty("task");
    expect(syncMetaForTask).not.toHaveBeenCalled();
    expect(h.tasks).toHaveLength(1);
  });
});

describe("taskCreatePayloadHash", () => {
  it("ignores the reporter, key order, and empty fields", () => {
    const a = taskCreatePayloadHash({ title: "T", bucket: "B", reporter: "x@y", assignee: null });
    const b = taskCreatePayloadHash({ bucket: "B", title: "T", reporter: "other@y" });
    expect(a).toBe(b);
  });

  it("changes with any task field", () => {
    const base = { title: "T", bucket: "B", reporter: "x@y" };
    const hash = taskCreatePayloadHash(base);
    expect(taskCreatePayloadHash({ ...base, title: "U" })).not.toBe(hash);
    expect(taskCreatePayloadHash({ ...base, priority: "low" })).not.toBe(hash);
    expect(taskCreatePayloadHash({ ...base, repos: ["plx-mc"] })).not.toBe(hash);
    expect(taskCreatePayloadHash({ ...base, assignee: "agent:x" })).not.toBe(hash);
  });
});

describe("runIdempotentTaskCreate", () => {
  const claim = {
    principalId: "sp_mcp_portal",
    idempotencyKey: "slow-1",
    payloadHash: "h1",
    actor: "portal-cos",
    repo: "petralabx/PLX_MC",
  };

  const fast = { pollMs: 5, pollAttempts: 3 };

  // A create that waits for `gate`, then commits its task and result together.
  function gatedCreate(gate: Promise<void>, taskId: string, holdLock?: Promise<void>) {
    return async (persist: PersistIdempotencyResult) => {
      await gate;
      await h.fakeTransaction(async (q) => {
        await persist(q as unknown as TxQuery, taskId);
        if (holdLock) await holdLock;
      });
      return taskId;
    };
  }

  function latch(): { promise: Promise<void>; open: () => void } {
    let open: () => void = () => undefined;
    const promise = new Promise<void>((resolve) => (open = resolve));
    return { promise, open };
  }

  it("gives 409 in progress when the first create has not finished in time", async () => {
    const gate = latch();
    const slow = runIdempotentTaskCreate(claim, gatedCreate(gate.promise, "TASK-900"), fast);
    await vi.waitFor(() => expect(h.rows).toHaveLength(1));
    const create = vi.fn(async () => "TASK-999");
    await expect(runIdempotentTaskCreate(claim, create, fast)).rejects.toMatchObject({
      code: "idempotency_in_progress",
      status: 409,
    });
    expect(create).not.toHaveBeenCalled();
    gate.open();
    await expect(slow).resolves.toEqual({ taskId: "TASK-900", replayed: false });
    await expect(runIdempotentTaskCreate(claim, create, fast)).resolves.toEqual({
      taskId: "TASK-900",
      replayed: true,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("keeps a young claim in progress and closes it once abandoned", async () => {
    // The first call claims the key and never finishes (the process stopped).
    void runIdempotentTaskCreate(claim, () => new Promise<string>(() => undefined), fast);
    await vi.waitFor(() => expect(h.rows).toHaveLength(1));
    const create = vi.fn(async () => "TASK-999");
    h.ageSeconds = 119;
    await expect(runIdempotentTaskCreate(claim, create, fast)).rejects.toMatchObject({
      code: "idempotency_in_progress",
    });
    h.ageSeconds = 120;
    await expect(runIdempotentTaskCreate(claim, create, fast)).rejects.toMatchObject({
      code: "idempotency_key_failed",
      status: 409,
    });
    expect(create).not.toHaveBeenCalled();
    expect(h.rows.map((row) => row.kind)).toEqual([
      "task.create.idempotency",
      "task.create.idempotency.failed",
    ]);
  });

  it("replays the committed result when the result wins the claim lock", async () => {
    // The first call holds the claim lock inside its create transaction.
    const commit = latch();
    const first = runIdempotentTaskCreate(
      claim,
      gatedCreate(Promise.resolve(), "TASK-900", commit.promise),
      fast
    );
    await vi.waitFor(() => expect(h.locks.size).toBe(1));
    // An old claim: the repeat would close it, but it waits for the lock first.
    h.ageSeconds = 300;
    const repeat = runIdempotentTaskCreate(claim, vi.fn(async () => "TASK-999"), fast);
    await vi.waitFor(() => expect(h.lockWaits).toBe(1));
    commit.open();
    await expect(first).resolves.toEqual({ taskId: "TASK-900", replayed: false });
    await expect(repeat).resolves.toEqual({ taskId: "TASK-900", replayed: true });
    expect(h.rows.map((row) => row.kind)).toEqual([
      "task.create.idempotency",
      "task.create.idempotency.result",
    ]);
  });
});
