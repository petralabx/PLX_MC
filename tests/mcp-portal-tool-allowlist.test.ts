// Fleet P8, decision CG-07b: sp_mcp_portal may call exactly two MC actions,
// mc_create_task and mc_search_tasks. Its task.read capability would also
// admit read tools such as mc_list_buckets, mc_list_conflicts and
// mc_get_context, so a per-principal tool allowlist refuses every other tool.
// These tests walk every HTTP MCP tool and every cursor REST route, so a new
// tool or route is refused to the portal unless this allowlist names it.

import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@/lib/mc-data";
import type { CreateTaskInput } from "@/lib/sync";

const h = vi.hoisted(() => ({
  tasks: [] as Record<string, unknown>[],
  writes: [] as string[],
}));

vi.mock("@/lib/sync", () => ({
  createTask: vi.fn(async (input: CreateTaskInput) => {
    h.writes.push("createTask");
    const task = { id: `TASK-${900 + h.tasks.length}`, stage: "backlog", ...input };
    h.tasks.push(task);
    return task as unknown as Task;
  }),
  patchTask: vi.fn(async () => {
    h.writes.push("patchTask");
    return null;
  }),
  createBucket: vi.fn(async () => {
    h.writes.push("createBucket");
    return { id: "BKT-NEW" };
  }),
  createProject: vi.fn(async () => {
    h.writes.push("createProject");
    return { id: "PRJ-NEW" };
  }),
  patchBucket: vi.fn(async () => {
    h.writes.push("patchBucket");
    return null;
  }),
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
  getEntity: vi.fn(async (_kind: string, id: string) => ({ data: { id, bucket: "BKT-INFRA" } })),
  getBuckets: vi.fn(async () => [{ id: "BKT-INFRA", name: "Infra" }]),
  getProjects: vi.fn(async () => []),
}));

vi.mock("@/lib/mcp/sync-meta", () => ({
  syncMetaForTask: vi.fn(async () => ({ status: "queued" })),
}));

vi.mock("@/lib/compliance/service", () => ({
  checkout: vi.fn(async () => {
    h.writes.push("checkout");
    return { checkoutId: "dsp_test" };
  }),
  complete: vi.fn(async () => {
    h.writes.push("complete");
  }),
}));

vi.mock("@/lib/compliance/repo", () => ({
  getDispatch: vi.fn(async () => null),
  appendEvent: vi.fn(async () => {
    h.writes.push("appendEvent");
    return "1";
  }),
}));

vi.mock("@/lib/mcp/audit", () => ({
  recordMcpToolCall: vi.fn(async () => "1"),
}));

vi.mock("@/lib/permissions/decision-log", () => ({
  recordPermissionDecision: vi.fn(async () => true),
}));

import { POST as mcpPost } from "@/app/api/cursor/mcp/route";
import { GET as cursorTasksGet, POST as cursorTasksPost } from "@/app/api/cursor/tasks/route";
import {
  MCP_TOOL_ALLOWLISTS,
  isMcpToolAllowed,
} from "@/lib/mcp/tool-allowlist";
import { MCP_AGENT_SERVICE_PRINCIPAL_IDS } from "@/lib/permissions";

const PORTAL = "sp_mcp_portal";
const ALLOWED_TOOLS = ["mc_create_task", "mc_search_tasks"];

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

async function rpc(key: string, method: string, params: Record<string, unknown>) {
  const res = await mcpPost(
    new Request("http://localhost/api/cursor/mcp", {
      method: "POST",
      headers: headers(key),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    })
  );
  expect(res.status).toBe(200);
  return (await res.json()) as { result: Record<string, unknown> };
}

async function callTool(key: string, name: string, args: Record<string, unknown>) {
  const json = await rpc(key, "tools/call", { name, arguments: args });
  const result = json.result as { content: { type: string; text: string }[]; isError?: boolean };
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(result.content[0].text) as Record<string, unknown>;
  } catch {
    body = { text: result.content[0].text };
  }
  return { isError: result.isError === true, body };
}

// Valid arguments for every HTTP MCP tool the portal may not call. The
// completeness test below fails when a tool is missing from this table.
const REFUSED_TOOL_ARGS: Record<string, Record<string, unknown>> = {
  mc_self_check: {},
  mc_get_context: { depth: "compact" },
  mc_list_buckets: {},
  mc_list_conflicts: {},
  mc_list_checkouts: {},
  mc_get_task: { id: "TASK-1" },
  mc_search_knowledge: { q: "x" },
  mc_verify_pr: { repo: "petralabx/PLX_MC", pr: 1 },
  mc_list_skills: {},
  mc_install_skills: {},
  mc_sync_skills: {},
  mc_submit_skill: { id: "portal-skill", name: "x", description: "x", skillMd: "# x" },
  mc_checkout_task: { taskId: "TASK-1", repo: "petralabx/PLX_MC" },
  mc_report_progress: { taskId: "TASK-1", stage: "progress", notes: "x" },
  mc_complete_task: {
    checkoutId: "dsp_x",
    summary: "done",
    verificationCommands: ["npm test"],
    rollback: "revert",
  },
  mc_create_bucket: { name: "New bucket" },
  mc_update_bucket: { id: "BKT-INFRA", name: "Renamed" },
  mc_create_project: { name: "New project" },
  mc_request_approval: { taskId: "TASK-1", reason: "please" },
  mc_suggest_work: { title: "x" },
  mc_create_routed_task: {
    proposalId: "rp_1",
    bucketId: "BKT-INFRA",
    title: "x",
    accountableOwnerId: "vince",
  },
  mc_confirm_existing: { proposalId: "rp_1", taskId: "TASK-1" },
  mc_attach_checkout: { proposalId: "rp_1", taskId: "TASK-1", checkoutId: "dsp_x" },
  mc_resolve_conflict: { conflictId: "cf-1", resolution: "keep_mc" },
  mc_resolve_conflicts: { conflictIds: ["cf-1"], resolution: "keep_mc" },
};

beforeEach(() => {
  vi.stubEnv("PLX_MC_MCP_ENABLED", "1");
  vi.stubEnv("PLX_MC_MCP_API_KEY", "");
  vi.stubEnv("PLX_MC_MCP_AGENT_KEYS", JSON.stringify(KEYS));
  vi.stubEnv("PLX_MC_ALLOWED_USERS", "vince@petrasoap.com");
  vi.stubEnv("PLX_MC_ROUTING_SUGGEST_ENABLED", "1");
  h.tasks.length = 0;
  h.writes.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("MCP tool allowlist", () => {
  it("lets sp_mcp_portal call only mc_create_task and mc_search_tasks", () => {
    expect([...(MCP_TOOL_ALLOWLISTS[PORTAL] ?? [])].sort()).toEqual(ALLOWED_TOOLS);
    for (const tool of ALLOWED_TOOLS) expect(isMcpToolAllowed(PORTAL, tool)).toBe(true);
    for (const tool of Object.keys(REFUSED_TOOL_ARGS)) {
      expect({ tool, allowed: isMcpToolAllowed(PORTAL, tool) }).toEqual({ tool, allowed: false });
    }
    expect(isMcpToolAllowed(PORTAL, "mc_tool_added_later")).toBe(false);
  });

  it("leaves every other MCP principal without a tool allowlist", () => {
    const others = MCP_AGENT_SERVICE_PRINCIPAL_IDS.filter((id) => id !== PORTAL);
    expect(others).toHaveLength(7);
    for (const principalId of others) {
      expect(MCP_TOOL_ALLOWLISTS[principalId]).toBeUndefined();
      for (const tool of [...ALLOWED_TOOLS, ...Object.keys(REFUSED_TOOL_ARGS)]) {
        expect(isMcpToolAllowed(principalId, tool)).toBe(true);
      }
    }
  });
});

describe("sp_mcp_portal through HTTP MCP (POST /api/cursor/mcp)", () => {
  it("covers every registered tool in this test", async () => {
    const json = await rpc("portal-key", "tools/list", {});
    const names = (json.result.tools as { name: string }[]).map((t) => t.name).sort();
    expect(names).toEqual([...ALLOWED_TOOLS, ...Object.keys(REFUSED_TOOL_ARGS)].sort());
  });

  it("creates a task with an agent: assignee", async () => {
    const result = await callTool("portal-key", "mc_create_task", {
      title: "Delegated by COS",
      bucket: "BKT-INFRA",
      reporter: "cos@petrasoap.com",
      assignee: "agent:hasitha-fernando",
    });
    expect(result.isError).toBe(false);
    expect(result.body).toMatchObject({ taskId: "TASK-900" });
    expect(h.writes).toEqual(["createTask"]);
  });

  it("searches tasks", async () => {
    await callTool("portal-key", "mc_create_task", {
      title: "Delegated by COS",
      bucket: "BKT-INFRA",
      reporter: "cos@petrasoap.com",
    });
    const result = await callTool("portal-key", "mc_search_tasks", { q: "delegated" });
    expect(result.isError).toBe(false);
    expect((result.body.data as { total: number }).total).toBe(1);
  });

  for (const [tool, args] of Object.entries(REFUSED_TOOL_ARGS)) {
    it(`refuses ${tool} with forbidden`, async () => {
      const result = await callTool("portal-key", tool, args);
      expect(result.isError).toBe(true);
      expect(result.body).toMatchObject({ error: { code: "forbidden" } });
      expect(h.writes).toEqual([]);
    });
  }

  it("keeps the read tools open to a full MCP principal", async () => {
    for (const tool of ["mc_list_buckets", "mc_get_context", "mc_list_skills"]) {
      const result = await callTool("claude-key", tool, REFUSED_TOOL_ARGS[tool]);
      expect({ tool, isError: result.isError }).toEqual({ tool, isError: false });
    }
  });
});

// Every cursor REST route file and HTTP method, found on disk.
const CURSOR_API_DIR = join(process.cwd(), "src", "app", "api", "cursor");
const HTTP_METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"] as const;

function cursorRouteFiles(): string[] {
  return (readdirSync(CURSOR_API_DIR, { recursive: true }) as string[])
    .filter((file) => file.endsWith(`${sep}route.ts`) || file === "route.ts")
    .map((file) => relative(CURSOR_API_DIR, join(CURSOR_API_DIR, file)).split(sep).join("/"))
    .sort();
}

type RouteHandler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

describe("sp_mcp_portal through the cursor REST routes", () => {
  it("creates a task through POST /api/cursor/tasks", async () => {
    const resp = await cursorTasksPost(
      new Request("http://localhost/api/cursor/tasks", {
        method: "POST",
        headers: headers("portal-key"),
        body: JSON.stringify({
          title: "Portal delegate",
          bucket: "BKT-INFRA",
          assignee: "agent:hasitha-fernando",
        }),
      }),
      { params: Promise.resolve({}) }
    );
    expect(resp.status).toBe(200);
    expect(h.writes).toEqual(["createTask"]);
  });

  it("searches tasks through GET /api/cursor/tasks", async () => {
    h.tasks.push({ id: "TASK-1", title: "Delegated", stage: "backlog", bucket: "BKT-INFRA" });
    const resp = await cursorTasksGet(
      new Request("http://localhost/api/cursor/tasks?q=delegated", {
        headers: headers("portal-key"),
      }),
      { params: Promise.resolve({}) }
    );
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as { data: { total: number } };
    expect(json.data.total).toBe(1);
  });

  it("refuses every other cursor route with 403 forbidden", async () => {
    const refused: string[] = [];
    const wrong: string[] = [];
    for (const file of cursorRouteFiles()) {
      // POST /api/cursor/mcp is the HTTP MCP transport, covered above.
      if (file === "mcp/route.ts") continue;
      const dir = file.replace(/\/?route\.ts$/, "");
      const mod = (await import(join(CURSOR_API_DIR, file))) as Record<string, unknown>;
      for (const method of HTTP_METHODS) {
        const handler = mod[method] as RouteHandler | undefined;
        if (typeof handler !== "function") continue;
        const label = `${method} /api/cursor/${dir}`;
        if (dir === "tasks" && (method === "GET" || method === "POST")) continue;
        const path = dir.replace("[id]", "TASK-1");
        const resp = await handler(
          new Request(`http://localhost/api/cursor/${path}`, {
            method,
            headers: headers("portal-key"),
            ...(method === "GET" ? {} : { body: "{}" }),
          }),
          { params: Promise.resolve({ id: "TASK-1" }) }
        );
        const json = (await resp.json().catch(() => ({}))) as { error?: { code?: string } };
        if (resp.status === 403 && json.error?.code === "forbidden") refused.push(label);
        else wrong.push(`${label} -> ${resp.status} ${json.error?.code ?? ""}`);
      }
    }
    expect(wrong).toEqual([]);
    expect(refused).toEqual(
      expect.arrayContaining([
        "GET /api/cursor/buckets",
        "GET /api/cursor/conflicts",
        "GET /api/cursor/context",
        "GET /api/cursor/self-check",
        "GET /api/cursor/tasks/[id]",
        "GET /api/cursor/checkouts",
        "POST /api/cursor/checkout",
        "POST /api/cursor/progress",
        "POST /api/cursor/complete",
        "POST /api/cursor/buckets",
        "PATCH /api/cursor/buckets",
        "POST /api/cursor/projects",
        "POST /api/cursor/agent-report",
        "POST /api/cursor/skills/submit",
      ])
    );
    expect(h.writes).toEqual([]);
  });
});
