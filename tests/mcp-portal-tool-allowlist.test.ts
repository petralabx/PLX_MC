import { legacySearchFixture } from "./helpers/task-search-fixture";
// Fleet P8, decision CG-07b: sp_mcp_portal may call exactly two MC actions,
// mc_create_task and mc_search_tasks. Its task.read capability would also
// admit read tools such as mc_list_buckets, mc_list_conflicts and
// mc_get_context, so a per-principal tool allowlist refuses every other tool.
// These tests walk every HTTP MCP tool and every cursor REST route, so a new
// tool or route is refused to the portal unless this allowlist names it.
// Fleet P8b adds one route name, mc_list_agent_reports, for
// GET /api/cursor/agent-reports. It is a REST route, not an HTTP MCP tool.

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
  searchTaskPage: vi.fn(async (filter, hidden) => legacySearchFixture(h.tasks as unknown as Task[], filter, hidden)),
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
  getRegisterInboundCompletions: vi.fn(async () => ({})),
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
  listAgentReports: vi.fn(async () => []),
  eventsForTask: vi.fn(async () => []),
  listDispatches: vi.fn(async () => []),
}));

// mc_self_check probes Microsoft Graph for real (8 s timeout) when the shell
// holds the Graph secrets.
vi.mock("@/lib/sync/graph", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sync/graph")>()),
  probeGraphTokenOk: vi.fn(async () => false),
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
import { recordPermissionDecision } from "@/lib/permissions/decision-log";

const PORTAL = "sp_mcp_portal";
const ALLOWED_TOOLS = ["mc_create_task", "mc_search_tasks"];
// Allowlist names that are cursor REST routes only (fleet P8b).
const ALLOWED_ROUTE_NAMES = ["mc_list_agent_reports"];

// sp_mcp_workbench (PLX Agent Workbench) may call only these read tools.
const WORKBENCH = "sp_mcp_workbench";
const WORKBENCH_TOOLS = [
  "mc_self_check",
  "mc_get_context",
  "mc_list_buckets",
  "mc_search_knowledge",
  "mc_search_tasks",
  "mc_get_task",
];
// sp_mcp_infra (PLX Infra) has the same read-only allowlist as the Workbench.
const INFRA = "sp_mcp_infra";
// sp_mcp_cip_auto_undraft (PLX CIP Auto-Undraft) reads tasks only: four tools,
// without mc_list_buckets and mc_search_knowledge.
const CIP = "sp_mcp_cip_auto_undraft";
const CIP_TOOLS = ["mc_self_check", "mc_get_context", "mc_search_tasks", "mc_get_task"];
// sp_mcp_workbench_intake (PLX Workbench intake) creates and searches tasks, like the
// portal, without the agent-reports route.
const INTAKE = "sp_mcp_workbench_intake";

const KEYS: Record<string, string> = {
  sp_mcp_claude_code: "claude-key",
  sp_mcp_portal: "portal-key",
  sp_mcp_workbench: "workbench-key",
  sp_mcp_infra: "infra-key",
  sp_mcp_cip_auto_undraft: "cip-key",
  sp_mcp_workbench_intake: "intake-key",
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
  mc_upload_evidence: {
    checkoutId: "dsp_x",
    kind: "diagram",
    fileName: "flow.svg",
    contentType: "image/svg+xml",
    caption: "x",
    contentBase64: "PHN2Zy8+",
  },
  mc_create_bucket: { name: "New bucket" },
  mc_update_bucket: { id: "BKT-INFRA", name: "Renamed" },
  mc_create_project: { name: "New project" },
  mc_update_project: { projectId: "PRJ-PORTAL-GOLIVE", status: "closed" },
  mc_link_merged_pr: { taskId: "TASK-1", repo: "petralabx/PLX_MC", prNumber: 1, reason: "x" },
  mc_list_projects: {},
  mc_request_approval: { taskId: "TASK-1", reason: "please" },
  mc_get_approval_gate: { taskId: "TASK-1" },
  mc_update_task: { taskId: "TASK-1", patch: { addLabels: ["lane:codex"] } },
  mc_update_tasks: { items: [{ taskId: "TASK-1", patch: { addLabels: ["lane:codex"] } }] },
  mc_release_checkout: { checkoutId: "dsp_x", reason: "stray" },
  mc_release_checkouts: { items: [{ checkoutId: "dsp_x", reason: "stray" }] },
  mc_report_session_telemetry: { sessionId: "s1", tokensIn: 1, tokensOut: 1 },
  mc_suggest_work: { title: "x" },
  mc_create_routed_task: {
    proposalId: "rp_1",
    bucketId: "BKT-INFRA",
    title: "x",
    accountableOwnerId: "vince",
  },
  mc_confirm_existing: { proposalId: "rp_1", taskId: "TASK-1" },
  mc_attach_checkout: { proposalId: "rp_1", taskId: "TASK-1", checkoutId: "dsp_x" },
  mc_dismiss_conflict: { conflictId: "cf-1" },
  mc_dismiss_conflicts: { conflictIds: ["cf-1"] },
  mc_resolve_conflict: { conflictId: "cf-1", resolution: "keep_mc" },
  mc_resolve_conflicts: { conflictIds: ["cf-1"], resolution: "keep_mc" },
};

beforeEach(() => {
  vi.stubEnv("PLX_MC_MCP_ENABLED", "1");
  vi.stubEnv("PLX_MC_MCP_API_KEY", "");
  vi.stubEnv("PLX_MC_MCP_AGENT_KEYS", JSON.stringify(KEYS));
  vi.stubEnv("PLX_MC_ALLOWED_USERS", "vince@petrasoap.com");
  vi.stubEnv("PLX_MC_ROUTING_SUGGEST_ENABLED", "1");
  // mc_search_knowledge and mc_self_check call VMC whenever the shell has its key.
  vi.stubEnv("VMC_API_KEY", "");
  h.tasks.length = 0;
  h.writes.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("MCP tool allowlist", () => {
  it("lets sp_mcp_portal call only mc_create_task, mc_search_tasks and mc_list_agent_reports", () => {
    expect([...(MCP_TOOL_ALLOWLISTS[PORTAL] ?? [])].sort()).toEqual(
      [...ALLOWED_TOOLS, ...ALLOWED_ROUTE_NAMES].sort()
    );
    for (const tool of [...ALLOWED_TOOLS, ...ALLOWED_ROUTE_NAMES]) {
      expect(isMcpToolAllowed(PORTAL, tool)).toBe(true);
    }
    for (const tool of Object.keys(REFUSED_TOOL_ARGS)) {
      expect({ tool, allowed: isMcpToolAllowed(PORTAL, tool) }).toEqual({ tool, allowed: false });
    }
    expect(isMcpToolAllowed(PORTAL, "mc_tool_added_later")).toBe(false);
  });

  it("lets sp_mcp_workbench call only its six read tools", () => {
    expect([...(MCP_TOOL_ALLOWLISTS[WORKBENCH] ?? [])].sort()).toEqual([...WORKBENCH_TOOLS].sort());
    expect(isMcpToolAllowed(WORKBENCH, "mc_create_task")).toBe(false);
    expect(isMcpToolAllowed(WORKBENCH, "mc_tool_added_later")).toBe(false);
  });

  it("lets sp_mcp_infra call only the same six read tools", () => {
    expect([...(MCP_TOOL_ALLOWLISTS[INFRA] ?? [])].sort()).toEqual([...WORKBENCH_TOOLS].sort());
    for (const tool of WORKBENCH_TOOLS) {
      expect(isMcpToolAllowed(INFRA, tool)).toBe(true);
    }
    for (const tool of ["mc_create_task", ...Object.keys(REFUSED_TOOL_ARGS)]) {
      if (WORKBENCH_TOOLS.includes(tool)) continue;
      expect({ tool, allowed: isMcpToolAllowed(INFRA, tool) }).toEqual({ tool, allowed: false });
    }
    expect(isMcpToolAllowed(INFRA, "mc_tool_added_later")).toBe(false);
  });

  it("lets sp_mcp_cip_auto_undraft call only its four read tools", () => {
    expect([...(MCP_TOOL_ALLOWLISTS[CIP] ?? [])].sort()).toEqual([...CIP_TOOLS].sort());
    for (const tool of CIP_TOOLS) {
      expect(isMcpToolAllowed(CIP, tool)).toBe(true);
    }
    for (const tool of ["mc_create_task", ...Object.keys(REFUSED_TOOL_ARGS)]) {
      if (CIP_TOOLS.includes(tool)) continue;
      expect({ tool, allowed: isMcpToolAllowed(CIP, tool) }).toEqual({ tool, allowed: false });
    }
    expect(isMcpToolAllowed(CIP, "mc_list_buckets")).toBe(false);
    expect(isMcpToolAllowed(CIP, "mc_search_knowledge")).toBe(false);
    expect(isMcpToolAllowed(CIP, "mc_tool_added_later")).toBe(false);
  });

  it("lets sp_mcp_workbench_intake call only mc_create_task and mc_search_tasks", () => {
    expect([...(MCP_TOOL_ALLOWLISTS[INTAKE] ?? [])].sort()).toEqual([...ALLOWED_TOOLS].sort());
    for (const tool of ALLOWED_TOOLS) {
      expect(isMcpToolAllowed(INTAKE, tool)).toBe(true);
    }
    for (const tool of [...ALLOWED_ROUTE_NAMES, ...Object.keys(REFUSED_TOOL_ARGS)]) {
      expect({ tool, allowed: isMcpToolAllowed(INTAKE, tool) }).toEqual({ tool, allowed: false });
    }
    expect(isMcpToolAllowed(INTAKE, "mc_tool_added_later")).toBe(false);
  });

  it("leaves every other MCP principal without a tool allowlist", () => {
    const others = MCP_AGENT_SERVICE_PRINCIPAL_IDS.filter(
      (id) => id !== PORTAL && id !== WORKBENCH && id !== INFRA && id !== CIP && id !== INTAKE
    );
    expect(others).toHaveLength(MCP_AGENT_SERVICE_PRINCIPAL_IDS.length - 5);
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

  it("reports its principal in the search metadata for the key-rotation check", async () => {
    const result = await callTool("portal-key", "mc_search_tasks", { limit: 1 });
    expect(result.isError).toBe(false);
    expect(result.body.meta).toMatchObject({ actor: { servicePrincipalId: PORTAL } });
    const selfCheck = await callTool("portal-key", "mc_self_check", {});
    expect(selfCheck.body).toMatchObject({ error: { code: "forbidden" } });
  });

  it("reports a full MCP principal in the search metadata too", async () => {
    const result = await callTool("claude-key", "mc_search_tasks", { limit: 1 });
    expect(result.body.meta).toMatchObject({
      actor: { servicePrincipalId: "sp_mcp_claude_code" },
    });
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

describe("sp_mcp_workbench through HTTP MCP and the cursor REST routes", () => {
  it("initializes and lists tools", async () => {
    const init = await rpc("workbench-key", "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "plx-agent-workbench", version: "0" },
    });
    expect(init.result).toMatchObject({ serverInfo: { name: "PLX-MC" } });
    const list = await rpc("workbench-key", "tools/list", {});
    const names = (list.result.tools as { name: string }[]).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(WORKBENCH_TOOLS));
  });

  it("calls its allowlisted read tools", async () => {
    h.tasks.push({ id: "TASK-1", title: "Ontology", stage: "backlog", bucket: "BKT-INFRA" });
    const search = await callTool("workbench-key", "mc_search_tasks", { q: "ontology" });
    expect(search.isError).toBe(false);
    expect(search.body).toMatchObject({
      data: { total: 1 },
      meta: { actor: { servicePrincipalId: WORKBENCH } },
    });
    for (const tool of ["mc_get_context", "mc_list_buckets"]) {
      const result = await callTool("workbench-key", tool, REFUSED_TOOL_ARGS[tool]);
      expect({ tool, isError: result.isError }).toEqual({ tool, isError: false });
    }
    // The allowlist never refuses the other read tools; their own result may vary here.
    for (const tool of ["mc_self_check", "mc_search_knowledge", "mc_get_task"]) {
      const result = await callTool("workbench-key", tool, REFUSED_TOOL_ARGS[tool]);
      expect({ tool, body: result.body }).not.toMatchObject({ tool, body: { error: { code: "forbidden" } } });
    }
    expect(h.writes).toEqual([]);
  });

  it("refuses mc_create_task and every other non-read tool with forbidden", async () => {
    const args: Record<string, Record<string, unknown>> = {
      ...REFUSED_TOOL_ARGS,
      mc_create_task: { title: "Should not exist", bucket: "BKT-INFRA", reporter: "cos@petrasoap.com" },
    };
    for (const [tool, toolArgs] of Object.entries(args)) {
      if (WORKBENCH_TOOLS.includes(tool)) continue;
      const result = await callTool("workbench-key", tool, toolArgs);
      expect({ tool, isError: result.isError, body: result.body }).toMatchObject({
        tool,
        isError: true,
        body: { error: { code: "forbidden" } },
      });
    }
    expect(h.writes).toEqual([]);
  });

  it("searches through GET /api/cursor/tasks and gets 403 on POST /api/cursor/tasks", async () => {
    const search = await cursorTasksGet(
      new Request("http://localhost/api/cursor/tasks?limit=1", { headers: headers("workbench-key") }),
      { params: Promise.resolve({}) }
    );
    expect(search.status).toBe(200);
    const create = await cursorTasksPost(
      new Request("http://localhost/api/cursor/tasks", {
        method: "POST",
        headers: headers("workbench-key"),
        body: JSON.stringify({ title: "Should not exist", bucket: "BKT-INFRA" }),
      }),
      { params: Promise.resolve({}) }
    );
    expect(create.status).toBe(403);
    expect(((await create.json()) as { error: { code: string } }).error.code).toBe("forbidden");
    expect(h.writes).toEqual([]);
  });
});

describe("sp_mcp_infra through HTTP MCP and the cursor REST routes", () => {
  it("lists tools and searches tasks as sp_mcp_infra", async () => {
    const list = await rpc("infra-key", "tools/list", {});
    const names = (list.result.tools as { name: string }[]).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(WORKBENCH_TOOLS));
    h.tasks.push({ id: "TASK-1", title: "Infra", stage: "backlog", bucket: "BKT-INFRA" });
    const search = await callTool("infra-key", "mc_search_tasks", { q: "infra" });
    expect(search.isError).toBe(false);
    expect(search.body).toMatchObject({
      data: { total: 1 },
      meta: { actor: { servicePrincipalId: INFRA } },
    });
    expect(h.writes).toEqual([]);
  });

  it("refuses mc_create_task and every other non-read tool with forbidden", async () => {
    const args: Record<string, Record<string, unknown>> = {
      ...REFUSED_TOOL_ARGS,
      mc_create_task: { title: "Should not exist", bucket: "BKT-INFRA", reporter: "cos@petrasoap.com" },
    };
    for (const [tool, toolArgs] of Object.entries(args)) {
      if (WORKBENCH_TOOLS.includes(tool)) continue;
      const result = await callTool("infra-key", tool, toolArgs);
      expect({ tool, isError: result.isError, body: result.body }).toMatchObject({
        tool,
        isError: true,
        body: { error: { code: "forbidden" } },
      });
    }
    expect(h.writes).toEqual([]);
  });

  it("searches through GET /api/cursor/tasks and gets 403 on POST /api/cursor/tasks", async () => {
    const search = await cursorTasksGet(
      new Request("http://localhost/api/cursor/tasks?limit=1", { headers: headers("infra-key") }),
      { params: Promise.resolve({}) }
    );
    expect(search.status).toBe(200);
    const create = await cursorTasksPost(
      new Request("http://localhost/api/cursor/tasks", {
        method: "POST",
        headers: headers("infra-key"),
        body: JSON.stringify({ title: "Should not exist", bucket: "BKT-INFRA" }),
      }),
      { params: Promise.resolve({}) }
    );
    expect(create.status).toBe(403);
    expect(((await create.json()) as { error: { code: string } }).error.code).toBe("forbidden");
    expect(h.writes).toEqual([]);
  });
});

describe("sp_mcp_cip_auto_undraft through HTTP MCP and the cursor REST routes", () => {
  it("lists every registered tool and calls its four read tools", async () => {
    const list = await rpc("cip-key", "tools/list", {});
    const names = (list.result.tools as { name: string }[]).map((t) => t.name).sort();
    expect(names).toEqual([...ALLOWED_TOOLS, ...Object.keys(REFUSED_TOOL_ARGS)].sort());
    h.tasks.push({ id: "TASK-1", title: "Undraft", stage: "backlog", bucket: "BKT-INFRA" });
    const search = await callTool("cip-key", "mc_search_tasks", { q: "undraft" });
    expect(search.isError).toBe(false);
    expect(search.body).toMatchObject({
      data: { total: 1 },
      meta: { actor: { servicePrincipalId: CIP } },
    });
    const context = await callTool("cip-key", "mc_get_context", REFUSED_TOOL_ARGS.mc_get_context);
    expect(context.isError).toBe(false);
    // The allowlist never refuses the other read tools; their own result may vary here.
    for (const tool of ["mc_self_check", "mc_get_task"]) {
      const result = await callTool("cip-key", tool, REFUSED_TOOL_ARGS[tool]);
      expect({ tool, body: result.body }).not.toMatchObject({ tool, body: { error: { code: "forbidden" } } });
    }
    expect(h.writes).toEqual([]);
  });

  it("refuses every other registered tool with forbidden and logs a deny", async () => {
    const args: Record<string, Record<string, unknown>> = {
      ...REFUSED_TOOL_ARGS,
      mc_create_task: { title: "Should not exist", bucket: "BKT-INFRA", reporter: "cos@petrasoap.com" },
    };
    const refused = Object.keys(args).filter((tool) => !CIP_TOOLS.includes(tool));
    expect(refused).toEqual(expect.arrayContaining(["mc_list_buckets", "mc_search_knowledge", "mc_create_task"]));
    for (const tool of refused) {
      vi.mocked(recordPermissionDecision).mockClear();
      const result = await callTool("cip-key", tool, args[tool]);
      expect({ tool, isError: result.isError, body: result.body }).toMatchObject({
        tool,
        isError: true,
        body: { error: { code: "forbidden" } },
      });
      expect(recordPermissionDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          site: "mcp.tool-allowlist",
          actorId: CIP,
          capability: tool,
          allowed: false,
          reasonCode: "tool_not_allowlisted",
        })
      );
    }
    expect(h.writes).toEqual([]);
  });

  it("searches through GET /api/cursor/tasks and gets 403 on POST /api/cursor/tasks", async () => {
    const search = await cursorTasksGet(
      new Request("http://localhost/api/cursor/tasks?limit=1", { headers: headers("cip-key") }),
      { params: Promise.resolve({}) }
    );
    expect(search.status).toBe(200);
    vi.mocked(recordPermissionDecision).mockClear();
    const create = await cursorTasksPost(
      new Request("http://localhost/api/cursor/tasks", {
        method: "POST",
        headers: headers("cip-key"),
        body: JSON.stringify({ title: "Should not exist", bucket: "BKT-INFRA" }),
      }),
      { params: Promise.resolve({}) }
    );
    expect(create.status).toBe(403);
    expect(((await create.json()) as { error: { code: string } }).error.code).toBe("forbidden");
    expect(recordPermissionDecision).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: CIP, capability: "mc_create_task", allowed: false })
    );
    expect(h.writes).toEqual([]);
  });
});

describe("sp_mcp_workbench_intake through HTTP MCP and the cursor REST routes", () => {
  it("lists every registered tool, creates a task and searches as sp_mcp_workbench_intake", async () => {
    const list = await rpc("intake-key", "tools/list", {});
    const names = (list.result.tools as { name: string }[]).map((t) => t.name).sort();
    expect(names).toEqual([...ALLOWED_TOOLS, ...Object.keys(REFUSED_TOOL_ARGS)].sort());
    const create = await callTool("intake-key", "mc_create_task", {
      title: "Workbench intake",
      bucket: "BKT-INFRA",
      reporter: "cos@petrasoap.com",
    });
    expect(create.isError).toBe(false);
    expect(create.body).toMatchObject({ taskId: "TASK-900" });
    expect(h.writes).toEqual(["createTask"]);
    const search = await callTool("intake-key", "mc_search_tasks", { limit: 1 });
    expect(search.isError).toBe(false);
    expect(search.body.meta).toMatchObject({ actor: { servicePrincipalId: INTAKE } });
  });

  it("refuses every other registered tool with forbidden and logs a deny", async () => {
    for (const [tool, args] of Object.entries(REFUSED_TOOL_ARGS)) {
      vi.mocked(recordPermissionDecision).mockClear();
      const result = await callTool("intake-key", tool, args);
      expect({ tool, isError: result.isError, body: result.body }).toMatchObject({
        tool,
        isError: true,
        body: { error: { code: "forbidden" } },
      });
      expect(recordPermissionDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          site: "mcp.tool-allowlist",
          actorId: INTAKE,
          capability: tool,
          allowed: false,
          reasonCode: "tool_not_allowlisted",
        })
      );
    }
    expect(h.writes).toEqual([]);
  });

  it("creates through POST /api/cursor/tasks and searches through GET /api/cursor/tasks", async () => {
    const create = await cursorTasksPost(
      new Request("http://localhost/api/cursor/tasks", {
        method: "POST",
        headers: headers("intake-key"),
        body: JSON.stringify({ title: "Workbench intake", bucket: "BKT-INFRA" }),
      }),
      { params: Promise.resolve({}) }
    );
    expect(create.status).toBe(200);
    expect(h.writes).toEqual(["createTask"]);
    const search = await cursorTasksGet(
      new Request("http://localhost/api/cursor/tasks?limit=1", { headers: headers("intake-key") }),
      { params: Promise.resolve({}) }
    );
    expect(search.status).toBe(200);
    const json = (await search.json()) as { meta: { actor: { servicePrincipalId: string } } };
    expect(json.meta.actor.servicePrincipalId).toBe(INTAKE);
  });

  it("refuses every other cursor route with 403 forbidden, agent reports included", async () => {
    const refused: string[] = [];
    const wrong: string[] = [];
    for (const file of cursorRouteFiles()) {
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
            headers: headers("intake-key"),
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
        "GET /api/cursor/agent-reports",
        "POST /api/cursor/checkout",
        "POST /api/cursor/progress",
        "POST /api/cursor/complete",
        "POST /api/cursor/tasks/update",
        "POST /api/cursor/buckets",
        "POST /api/cursor/projects",
      ])
    );
    expect(h.writes).toEqual([]);
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

  it("verifies the portal key through GET /api/cursor/tasks?limit=1, as the key sync does", async () => {
    const resp = await cursorTasksGet(
      new Request("http://localhost/api/cursor/tasks?limit=1", {
        headers: headers("portal-key"),
      }),
      { params: Promise.resolve({}) }
    );
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as {
      data: { tasks: unknown[] };
      meta: { actor: { servicePrincipalId: string } };
    };
    expect(Array.isArray(json.data.tasks)).toBe(true);
    expect(json.meta.actor.servicePrincipalId).toBe(PORTAL);
  });

  it("reads agent reports through GET /api/cursor/agent-reports (fleet P8b)", async () => {
    const mod = (await import(join(CURSOR_API_DIR, "agent-reports", "route.ts"))) as {
      GET: RouteHandler;
    };
    const resp = await mod.GET(
      new Request("http://localhost/api/cursor/agent-reports?limit=1", {
        headers: headers("portal-key"),
      }),
      { params: Promise.resolve({}) }
    );
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as { data: { reports: unknown[]; hasMore: boolean } };
    expect(json.data).toEqual({ reports: [], nextCursor: null, hasMore: false });
    expect(h.writes).toEqual([]);
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
        if (dir === "agent-reports" && method === "GET") continue;
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
        "POST /api/cursor/tasks/update",
        "POST /api/cursor/tasks/update-batch",
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


describe("task-search additive transport contract", () => {
  it("REST forwards search controls and returns nextCursor", async () => {
    const { searchTaskPage } = await import("@/lib/sync");
    const response = await cursorTasksGet(new Request(
      "http://localhost/api/cursor/tasks?label=odd&limit=200&cursor=opaque&fields=compact&searchComments=true&in=comments,notes",
      { headers: headers("portal-key") }
    ), { params: Promise.resolve({}) });
    expect(response.status).toBe(200);
    expect(vi.mocked(searchTaskPage).mock.calls.at(-1)?.[0]).toEqual({
      label: "odd", limit: 200, cursor: "opaque", fields: "compact", searchComments: true, in: ["comments", "notes"],
    });
    expect((await response.json()).data).toHaveProperty("nextCursor", null);
  });
  it("HTTP MCP forwards the same controls and returns nextCursor", async () => {
    const { searchTaskPage } = await import("@/lib/sync");
    const result = await callTool("portal-key", "mc_search_tasks", {
      label: "odd", limit: 200, cursor: "opaque", fields: "compact", searchComments: true, in: ["comments", "notes"],
    });
    expect(result.isError).not.toBe(true);
    expect(vi.mocked(searchTaskPage).mock.calls.at(-1)?.[0]).toEqual({
      label: "odd", limit: 200, cursor: "opaque", fields: "compact", searchComments: true, in: ["comments", "notes"],
    });
    const data = result.body.data;
    expect(data).toHaveProperty("nextCursor", null);
  });
  it("REST rejects malformed additive parameters", async () => {
    for (const qs of ["limit=0", "limit=201", "limit=NaN", "limit=1.5", "fields=nope", "searchComments=1", "in=activity", "cursor="]) {
      const response = await cursorTasksGet(new Request(`http://localhost/api/cursor/tasks?${qs}`, {
        headers: headers("portal-key"),
      }), { params: Promise.resolve({}) });
      expect(response.status, qs).toBe(400);
      expect((await response.json()).error.code).toBe("invalid_request");
    }
  });
  it("HTTP MCP rejects malformed additive parameters", async () => {
    for (const args of [{ limit: 201 }, { fields: "nope" }, { searchComments: "true" }, { in: ["activity"] }]) {
      expect((await callTool("portal-key", "mc_search_tasks", args)).isError).toBe(true);
    }
  });
});
