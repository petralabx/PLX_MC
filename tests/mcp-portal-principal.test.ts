// Fleet P8, decision CG-07b: sp_mcp_portal holds a least-privilege grant. It
// may create tasks (an agent: assignee included) and search tasks. It may not
// check out, report progress, complete, touch buckets or projects, or use any
// other write. Every other MCP principal keeps the full MCP bundle. Fleet P8b
// adds one read, agent_report.read, for GET /api/cursor/agent-reports.

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

vi.mock("@/lib/skills-directory", async () => {
  const actual = await vi.importActual<typeof import("@/lib/skills-directory")>(
    "@/lib/skills-directory"
  );
  return {
    ...actual,
    createSkillSubmission: vi.fn(async () => {
      h.writes.push("createSkillSubmission");
      return { id: "sub-1" };
    }),
  };
});

vi.mock("@/lib/compliance/approvals", () => ({
  requestApprovalGate: vi.fn(async () => {
    h.writes.push("requestApprovalGate");
    return {};
  }),
}));

vi.mock("@/lib/mcp/audit", () => ({
  recordMcpToolCall: vi.fn(async () => "1"),
}));

vi.mock("@/lib/permissions/decision-log", () => ({
  recordPermissionDecision: vi.fn(async () => true),
}));

import { POST as mcpPost } from "@/app/api/cursor/mcp/route";
import { POST as skillsSubmitPost } from "@/app/api/cursor/skills/submit/route";
import { verifyMcpRequest } from "@/lib/mcp/auth";
import {
  CAPABILITIES,
  MCP_AGENT_SERVICE_PRINCIPAL_IDS,
  PORTAL_MCP_SERVICE_PRINCIPAL_ID,
  authorize,
  capabilitiesForRole,
  capabilitiesForServicePrincipal,
} from "@/lib/permissions";

const PORTAL = "sp_mcp_portal";

// The MCP agent bundle at PLX_MC main 20fc262 (grants.ts). P8 must not change it.
const FULL_MCP_BUNDLE = [
  "task.read",
  "task.create",
  "task.checkout",
  "task.progress",
  "task.complete",
  "task.link",
  "bucket.create",
  "bucket.update",
  "project.create",
  "routing.suggest",
  "routing.propose",
  "routing.resolve",
  "approval.request",
  "telemetry.report",
  "sync.mutate",
];

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

describe("sp_mcp_portal grant", () => {
  it("is a reviewed MCP principal", () => {
    expect(PORTAL_MCP_SERVICE_PRINCIPAL_ID).toBe(PORTAL);
    expect(MCP_AGENT_SERVICE_PRINCIPAL_IDS).toContain(PORTAL);
  });

  it("holds exactly task.read, task.create and agent_report.read", () => {
    // Fleet P8b adds one read: agent reports, for the portal only.
    const granted = ["agent_report.read", "task.create", "task.read"];
    expect([...capabilitiesForServicePrincipal(PORTAL)].sort()).toEqual(granted);
    for (const capability of CAPABILITIES) {
      const allowed = authorize({
        actor: { kind: "service", id: PORTAL, status: "active" },
        capability,
      }).allowed;
      expect({ capability, allowed }).toEqual({
        capability,
        allowed: granted.includes(capability),
      });
    }
  });

  it("gives agent_report.read to no other principal and no human role", () => {
    for (const principalId of MCP_AGENT_SERVICE_PRINCIPAL_IDS.filter((id) => id !== PORTAL)) {
      expect(capabilitiesForServicePrincipal(principalId)).not.toContain("agent_report.read");
    }
    for (const id of [
      "sp_sync_inbound",
      "sp_routing_maintenance",
      "sp_github_actions_routing",
      "sp_compliance_projection",
    ]) {
      expect(capabilitiesForServicePrincipal(id)).not.toContain("agent_report.read");
    }
    for (const role of ["member", "admin", "owner"] as const) {
      expect(capabilitiesForRole(role)).not.toContain("agent_report.read");
    }
  });

  it("leaves every other MCP principal on the full MCP bundle", () => {
    const others = MCP_AGENT_SERVICE_PRINCIPAL_IDS.filter((id) => id !== PORTAL);
    expect(others).toHaveLength(MCP_AGENT_SERVICE_PRINCIPAL_IDS.length - 1);
    for (const principalId of others) {
      expect([...capabilitiesForServicePrincipal(principalId)].sort()).toEqual(
        [...FULL_MCP_BUNDLE].sort()
      );
    }
  });

  it("authenticates the portal key as sp_mcp_portal", async () => {
    const identity = await verifyMcpRequest(
      new Request("http://localhost/api/cursor/self-check", { headers: headers("portal-key") })
    );
    expect(identity.servicePrincipalId).toBe(PORTAL);
    expect(identity.actor).toEqual({ kind: "service", id: PORTAL, status: "active" });
  });
});

describe("sp_mcp_portal through the MCP tools", () => {
  it("creates a task", async () => {
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

  const forbidden: [string, Record<string, unknown>][] = [
    ["mc_checkout_task", { taskId: "TASK-1", repo: "petralabx/PLX_MC" }],
    ["mc_report_progress", { taskId: "TASK-1", stage: "progress", notes: "x" }],
    [
      "mc_complete_task",
      {
        checkoutId: "dsp_x",
        summary: "done",
        verificationCommands: ["npm test"],
        rollback: "revert",
      },
    ],
    ["mc_create_bucket", { name: "New bucket" }],
    ["mc_update_bucket", { id: "BKT-INFRA", name: "Renamed" }],
    ["mc_create_project", { name: "New project" }],
    ["mc_request_approval", { taskId: "TASK-1", reason: "please" }],
    ["mc_suggest_work", { title: "x" }],
    [
      "mc_create_routed_task",
      { proposalId: "rp_1", bucketId: "BKT-INFRA", title: "x", accountableOwnerId: "vince" },
    ],
    ["mc_confirm_existing", { proposalId: "rp_1", taskId: "TASK-1" }],
    ["mc_attach_checkout", { proposalId: "rp_1", taskId: "TASK-1", checkoutId: "dsp_x" }],
    ["mc_dismiss_conflict", { conflictId: "cf-1" }],
    ["mc_dismiss_conflicts", { conflictIds: ["cf-1"] }],
    ["mc_resolve_conflict", { conflictId: "cf-1", resolution: "keep_mc" }],
    [
      "mc_submit_skill",
      { id: "portal-skill", name: "x", description: "x", skillMd: "# x" },
    ],
  ];

  for (const [tool, args] of forbidden) {
    it(`refuses ${tool}`, async () => {
      const result = await callTool("portal-key", tool, args);
      expect(result.isError).toBe(true);
      expect(result.body).toMatchObject({ error: { code: "forbidden" } });
      expect(h.writes).toEqual([]);
    });
  }

  it("keeps mc_checkout_task open to a full MCP principal", async () => {
    const result = await callTool("claude-key", "mc_checkout_task", {
      taskId: "TASK-1",
      repo: "petralabx/PLX_MC",
    });
    expect(result.isError).toBe(false);
    expect(h.writes).toEqual(["checkout"]);
  });
});

describe("sp_mcp_portal through POST /api/cursor/skills/submit", () => {
  it("refuses the legacy submission shape too", async () => {
    const resp = await skillsSubmitPost(
      new Request("http://localhost/api/cursor/skills/submit", {
        method: "POST",
        headers: headers("portal-key"),
        body: JSON.stringify({
          skillId: "portal-skill",
          title: "x",
          submitterEmail: "vince@petrasoap.com",
        }),
      }),
      { params: Promise.resolve({}) }
    );
    expect(resp.status).toBe(403);
    expect(h.writes).toEqual([]);
  });
});
