// Fleet P8 (D15, D16): a task's assignee may name an agent as `agent:<slug>`.
// Only a signed-in person or sp_mcp_portal may set one. Every other MCP
// principal gets 403 through the MCP tool (POST /api/cursor/mcp) and through
// POST /api/cursor/tasks. mc_search_tasks filters by assignee. Real per-agent
// key auth and real grants run here; only storage seams are faked.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@/lib/mc-data";
import type { CreateTaskInput } from "@/lib/sync";

const h = vi.hoisted(() => ({
  tasks: [] as Record<string, unknown>[],
  created: [] as Record<string, unknown>[],
  patched: [] as { id: string; patch: Record<string, unknown> }[],
  session: null as { user?: { oid?: string | null; email?: string | null } } | null,
}));

vi.mock("@/lib/sync", () => ({
  createTask: vi.fn(async (input: CreateTaskInput) => {
    const task = { id: `TASK-${900 + h.tasks.length}`, stage: "backlog", ...input };
    h.created.push(input as unknown as Record<string, unknown>);
    h.tasks.push(task);
    return task as unknown as Task;
  }),
  patchTask: vi.fn(async (id: string, patch: Record<string, unknown>) => {
    h.patched.push({ id, patch });
    return { id, ...patch } as unknown as Task;
  }),
  createBucket: vi.fn(),
  createProject: vi.fn(),
  patchBucket: vi.fn(),
  snapshot: vi.fn(async () => ({
    tasks: h.tasks,
    buckets: [{ id: "BKT-INFRA", name: "Infra" }],
    projects: [],
    conflicts: [],
    errors: [],
    lastSweep: null,
  })),
}));

vi.mock("@/lib/sync/repo", () => ({
  getEntity: vi.fn(async (_kind: string, id: string) => {
    const task = h.tasks.find((row) => row.id === id);
    return task ? { data: task } : { data: { id, bucket: "BKT-INFRA" } };
  }),
  getBuckets: vi.fn(async () => [{ id: "BKT-INFRA", name: "Infra" }]),
  getProjects: vi.fn(async () => []),
}));

vi.mock("@/lib/mcp/sync-meta", () => ({
  syncMetaForTask: vi.fn(async () => ({ status: "queued" })),
}));

vi.mock("@/lib/compliance/service", () => ({
  checkout: vi.fn(),
  complete: vi.fn(),
}));

vi.mock("@/lib/compliance/repo", () => ({
  getDispatch: vi.fn(async () => null),
  appendEvent: vi.fn(async () => undefined),
}));

vi.mock("@/lib/mcp/audit", () => ({
  recordMcpToolCall: vi.fn(async () => "1"),
}));

vi.mock("@/lib/permissions/decision-log", () => ({
  recordPermissionDecision: vi.fn(async () => true),
}));

vi.mock("@/lib/auth", () => ({
  auth: async () => h.session,
}));

import { POST as mcpPost } from "@/app/api/cursor/mcp/route";
import { GET as cursorTasksGet, POST as cursorTasksPost } from "@/app/api/cursor/tasks/route";
import { PATCH as sessionTaskPatch } from "@/app/api/tasks/[id]/route";
import { ApiError } from "@/lib/api/route";
import type { McpIdentity } from "@/lib/mcp/auth";
import { actionCreateTask } from "@/lib/mcp/actions";
import { MCP_AGENT_SERVICE_PRINCIPAL_IDS } from "@/lib/permissions";

const PORTAL = "sp_mcp_portal";
const AGENT = "agent:hasitha-fernando";

const KEYS: Record<string, string> = {
  sp_mcp_claude_code: "claude-key",
  sp_mcp_grok: "grok-key",
  sp_mcp_agent_runner: "runner-key",
  sp_mcp_portal: "portal-key",
};

function headers(key: string): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "x-api-key": key,
    "x-mc-operator-email": "vince@petrasoap.com",
    "x-mc-repo": "petralabx/PLX_MC",
  };
}

async function callTool(key: string, name: string, args: Record<string, unknown>) {
  const res = await mcpPost(
    new Request("http://localhost/api/cursor/mcp", {
      method: "POST",
      headers: headers(key),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    })
  );
  expect(res.status).toBe(200);
  const json = (await res.json()) as {
    result: { content: { type: string; text: string }[]; isError?: boolean };
  };
  return {
    isError: json.result.isError === true,
    body: JSON.parse(json.result.content[0].text) as Record<string, unknown>,
  };
}

function restCreate(key: string, body: Record<string, unknown>) {
  return cursorTasksPost(
    new Request("http://localhost/api/cursor/tasks", {
      method: "POST",
      headers: headers(key),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) }
  );
}

function identityFor(principalId: string): McpIdentity {
  return {
    operatorEmail: "vince@petrasoap.com",
    runtime: "test",
    workerId: "w1",
    repo: "petralabx/PLX_MC",
    servicePrincipalId: principalId as McpIdentity["servicePrincipalId"],
    actor: { kind: "service", id: principalId, status: "active" },
  };
}

beforeEach(() => {
  vi.stubEnv("PLX_MC_MCP_ENABLED", "1");
  vi.stubEnv("PLX_MC_MCP_API_KEY", "");
  vi.stubEnv("PLX_MC_MCP_AGENT_KEYS", JSON.stringify(KEYS));
  vi.stubEnv("PLX_MC_ALLOWED_USERS", "vince@petrasoap.com");
  vi.stubEnv("PLX_MC_ROUTING_SUGGEST_ENABLED", "0");
  h.tasks.length = 0;
  h.created.length = 0;
  h.patched.length = 0;
  h.session = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("agent assignee through the MCP tool", () => {
  it("sp_mcp_portal creates a task with an agent: assignee", async () => {
    const result = await callTool("portal-key", "mc_create_task", {
      title: "Draft the weekly supplier digest",
      bucket: "BKT-INFRA",
      reporter: "cos@petrasoap.com",
      assignee: AGENT,
    });
    expect(result.isError).toBe(false);
    expect(result.body).toMatchObject({ taskId: "TASK-900" });
    expect(h.created).toHaveLength(1);
    expect(h.created[0]).toMatchObject({ assignee: AGENT });
  });

  it("sp_mcp_grok gets 403 (forbidden) and no task is created", async () => {
    const result = await callTool("grok-key", "mc_create_task", {
      title: "Delegate from Grok Bot",
      bucket: "BKT-INFRA",
      reporter: "cos@petrasoap.com",
      assignee: AGENT,
    });
    expect(result.isError).toBe(true);
    expect(result.body).toMatchObject({
      error: { code: "forbidden", message: expect.stringContaining("agent:") },
    });
    expect(h.created).toHaveLength(0);
  });

  it("an assignee search finds the task by its agent", async () => {
    await callTool("portal-key", "mc_create_task", {
      title: "Agent task",
      bucket: "BKT-INFRA",
      reporter: "cos@petrasoap.com",
      assignee: AGENT,
    });
    await callTool("portal-key", "mc_create_task", {
      title: "Other agent task",
      bucket: "BKT-INFRA",
      reporter: "cos@petrasoap.com",
      assignee: "agent:chief-of-staff",
    });
    await callTool("portal-key", "mc_create_task", {
      title: "Unassigned task",
      bucket: "BKT-INFRA",
      reporter: "cos@petrasoap.com",
    });

    const result = await callTool("portal-key", "mc_search_tasks", { assignee: AGENT });
    expect(result.isError).toBe(false);
    const data = result.body.data as { tasks: { id: string; assignee: string }[]; total: number };
    expect(data.total).toBe(1);
    expect(data.tasks.map((task) => task.assignee)).toEqual([AGENT]);
    expect(result.body.meta).toMatchObject({ filter: { assignee: AGENT } });

    // A runner holds the full MCP bundle and finds the same task.
    const runner = await callTool("runner-key", "mc_search_tasks", { assignee: AGENT });
    expect((runner.body.data as { total: number }).total).toBe(1);
  });
});

describe("agent assignee through POST /api/cursor/tasks", () => {
  it("sp_mcp_grok gets 403", async () => {
    const resp = await restCreate("grok-key", {
      title: "Delegate from Grok Bot",
      bucket: "BKT-INFRA",
      assignee: AGENT,
    });
    expect(resp.status).toBe(403);
    const json = (await resp.json()) as { error: { code: string } };
    expect(json.error.code).toBe("forbidden");
    expect(h.created).toHaveLength(0);
  });

  it("sp_mcp_portal gets 200", async () => {
    const resp = await restCreate("portal-key", {
      title: "Portal delegate",
      bucket: "BKT-INFRA",
      assignee: AGENT,
    });
    expect(resp.status).toBe(200);
    expect(h.created[0]).toMatchObject({ assignee: AGENT });
  });

  it("GET /api/cursor/tasks?assignee= finds the task", async () => {
    await restCreate("portal-key", { title: "A", bucket: "BKT-INFRA", assignee: AGENT });
    await restCreate("portal-key", { title: "B", bucket: "BKT-INFRA", assignee: "vince" });
    const resp = await cursorTasksGet(
      new Request(`http://localhost/api/cursor/tasks?assignee=${encodeURIComponent(AGENT)}`, {
        headers: headers("grok-key"),
      }),
      { params: Promise.resolve({}) }
    );
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as {
      data: { tasks: { title: string }[]; total: number };
      meta: { filter: Record<string, unknown> };
    };
    expect(json.data.total).toBe(1);
    expect(json.data.tasks[0].title).toBe("A");
    expect(json.meta.filter).toMatchObject({ assignee: AGENT });
  });

  it("keeps a person assignee open to every MCP principal", async () => {
    const resp = await restCreate("grok-key", {
      title: "Person assignee",
      bucket: "BKT-INFRA",
      assignee: "vince",
    });
    expect(resp.status).toBe(200);
    expect(h.created[0]).toMatchObject({ assignee: "vince" });
  });
});

describe("the rule in actionCreateTask", () => {
  it("refuses an agent: assignee from every MCP principal except sp_mcp_portal", async () => {
    const others = MCP_AGENT_SERVICE_PRINCIPAL_IDS.filter((id) => id !== PORTAL);
    expect(others).toEqual(
      expect.arrayContaining(["sp_mcp_cursor", "sp_mcp_grok", "sp_mcp_agent_runner"])
    );
    for (const principalId of others) {
      const attempt = actionCreateTask(identityFor(principalId), {
        title: "Delegate",
        bucket: "BKT-INFRA",
        reporter: "ignored",
        assignee: AGENT,
      });
      await expect(attempt).rejects.toBeInstanceOf(ApiError);
      await expect(attempt).rejects.toMatchObject({ code: "forbidden", status: 403 });
    }
    expect(h.created).toHaveLength(0);
  });

  it("catches case and whitespace variants of the agent: prefix", async () => {
    for (const assignee of ["Agent:hasitha-fernando", "  agent:hasitha-fernando", "AGENT:x"]) {
      await expect(
        actionCreateTask(identityFor("sp_mcp_grok"), {
          title: "Delegate",
          bucket: "BKT-INFRA",
          reporter: "ignored",
          assignee,
        })
      ).rejects.toMatchObject({ code: "forbidden", status: 403 });
    }
    expect(h.created).toHaveLength(0);
  });

  it("refuses a revoked sp_mcp_portal", async () => {
    const identity = identityFor(PORTAL);
    identity.actor = { kind: "service", id: PORTAL, status: "revoked" };
    await expect(
      actionCreateTask(identity, {
        title: "Delegate",
        bucket: "BKT-INFRA",
        reporter: "ignored",
        assignee: AGENT,
      })
    ).rejects.toMatchObject({ status: 403 });
    expect(h.created).toHaveLength(0);
  });
});

describe("agent assignee through the session route PATCH /api/tasks/[id]", () => {
  it("lets a signed-in person reassign a task to an agent", async () => {
    h.session = { user: { oid: "entra-vince", email: "vince@petrasoap.com" } };
    const resp = await sessionTaskPatch(
      new Request("http://localhost/api/tasks/TASK-7", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assignee: AGENT }),
      }),
      { params: Promise.resolve({ id: "TASK-7" }) }
    );
    expect(resp.status).toBe(200);
    expect(h.patched).toEqual([
      expect.objectContaining({ id: "TASK-7", patch: expect.objectContaining({ assignee: AGENT }) }),
    ]);
  });

  it("refuses a caller with no session", async () => {
    const resp = await sessionTaskPatch(
      new Request("http://localhost/api/tasks/TASK-7", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assignee: AGENT }),
      }),
      { params: Promise.resolve({ id: "TASK-7" }) }
    );
    expect(resp.status).toBe(403);
    expect(h.patched).toHaveLength(0);
  });
});
