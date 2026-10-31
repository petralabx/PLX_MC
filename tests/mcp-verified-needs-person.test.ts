// W02: only a person marks a task Verified, in Mission Control. Every MCP and
// cursor-API caller is a service principal, so each door that could set stage
// verified refuses with 403 verified_needs_person and writes nothing. People
// keep the web PATCH (tests/uat-ticket-web-verified.test.ts) and the portal
// keeps mc_update_task verify for UAT ticket tasks (tests/mcp-update-task.test.ts).
// Real per-agent key auth and real grants run here; only storage seams are faked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  task: {} as Record<string, unknown>,
  created: [] as Record<string, unknown>[],
  patched: [] as Record<string, unknown>[],
  events: [] as { kind: string }[],
}));

vi.mock("@/lib/permissions/decision-log", () => ({ recordPermissionDecision: vi.fn(async () => true) }));
vi.mock("@/lib/permissions/project-acl-guard", () => ({
  assertTaskProjectAccess: vi.fn(async () => undefined),
  assertBucketProjectAccess: vi.fn(async () => undefined),
  assertProjectIdAccess: vi.fn(async () => undefined),
  loadProjectAclMaps: vi.fn(async () => ({})),
}));
vi.mock("@/lib/mcp/sync-meta", () => ({ syncMetaForTask: vi.fn(async () => ({ status: "queued" })) }));
vi.mock("@/lib/mcp/audit", () => ({ recordMcpToolCall: vi.fn(async () => "1") }));
// A progress write runs in a row-locked transaction; the repo seam is mocked,
// so the transaction only needs to hand through a query function.
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  withTransaction: async <T,>(fn: (q: never) => Promise<T>) => fn((async () => []) as never),
}));
vi.mock("@/lib/sync/repo", () => ({
  getEntity: vi.fn(async (_type: string, id: string) => (id === h.task.id ? { data: structuredClone(h.task) } : null)),
}));
vi.mock("@/lib/sync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sync")>()),
  createTask: vi.fn(async (input: Record<string, unknown>) => {
    h.created.push(input);
    return { id: "TASK-900", stage: "backlog", ...input };
  }),
  patchTask: vi.fn(async (_id: string, patch: Record<string, unknown>) => {
    h.patched.push(patch);
    return { ...h.task, ...patch };
  }),
}));
vi.mock("@/lib/compliance/repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/compliance/repo")>()),
  // The caller holds a live checkout: the refusal is about who verifies, not the lease.
  hasActiveCheckoutForPrincipal: vi.fn(async () => true),
  appendEvent: vi.fn(async (e: { kind: string }) => {
    h.events.push(e);
    return "1";
  }),
}));

import { POST as mcpPost } from "@/app/api/cursor/mcp/route";
import { POST as cursorProgressPost } from "@/app/api/cursor/progress/route";
import { POST as cursorTasksPost } from "@/app/api/cursor/tasks/route";
import type { McpIdentity } from "@/lib/mcp/auth";
import { actionCreateTask } from "@/lib/mcp/actions";
import { reopenPatchSchema } from "@/lib/mcp/task-cancel-actions";

const KEYS: Record<string, string> = { sp_mcp_claude_code: "claude-key", sp_mcp_portal: "portal-key" };
const MESSAGE = "Only a person marks a task Verified, in Mission Control.";

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
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    })
  );
  expect(res.status).toBe(200);
  const json = (await res.json()) as { result: { content: { text: string }[]; isError?: boolean } };
  return { isError: json.result.isError === true, body: JSON.parse(json.result.content[0].text) as Record<string, unknown> };
}

async function rest(handler: typeof cursorTasksPost, path: string, key: string, body: Record<string, unknown>) {
  const res = await handler(
    new Request(`http://localhost${path}`, { method: "POST", headers: headers(key), body: JSON.stringify(body) }),
    { params: Promise.resolve({}) }
  );
  return { status: res.status, body: (await res.json()) as { error?: { code: string; message: string } } };
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
  h.task = { id: "TASK-1", stage: "merged", labels: ["kind:code", "lane:claude-code"], comments: [], accountableOwner: "vince" };
  h.created.length = 0;
  h.patched.length = 0;
  h.events.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("mc_report_progress refuses stage verified (W02)", () => {
  it("through the MCP tool", async () => {
    const result = await callTool("claude-key", "mc_report_progress", { taskId: "TASK-1", stage: "verified" });
    expect(result.isError).toBe(true);
    expect(result.body).toMatchObject({ error: { code: "verified_needs_person", message: MESSAGE } });
    expect(h.patched).toEqual([]);
    expect(h.events).toEqual([]);
  });

  it("through POST /api/cursor/progress", async () => {
    const result = await rest(cursorProgressPost, "/api/cursor/progress", "claude-key", { taskId: "TASK-1", stage: "verified" });
    expect(result.status).toBe(403);
    expect(result.body.error).toMatchObject({ code: "verified_needs_person", message: MESSAGE });
    expect(h.patched).toEqual([]);
  });

  it("still moves a task to any other stage", async () => {
    const result = await callTool("claude-key", "mc_report_progress", { taskId: "TASK-1", stage: "progress", notes: "x" });
    expect(result.body).toMatchObject({ error: { code: "stage_regression" } });
    h.task = { ...h.task, stage: "progress" };
    const forward = await callTool("claude-key", "mc_report_progress", { taskId: "TASK-1", stage: "review" });
    expect(forward.isError).toBe(false);
    expect(forward.body).toMatchObject({ ok: true, stage: "review" });
  });
});

describe("task create refuses stage verified (W02)", () => {
  it("through POST /api/cursor/tasks, and creates nothing", async () => {
    const result = await rest(cursorTasksPost, "/api/cursor/tasks", "claude-key", {
      title: "Born verified",
      bucket: "BKT-INFRA",
      kind: "code",
      stage: "verified",
    });
    expect(result.status).toBe(403);
    expect(result.body.error).toMatchObject({ code: "verified_needs_person", message: MESSAGE });
    expect(h.created).toEqual([]);
  });

  it("for every service principal, the portal included", async () => {
    await expect(
      actionCreateTask(identityFor("sp_mcp_portal"), {
        title: "Born verified",
        bucket: "BKT-INFRA",
        reporter: "vince@petrasoap.com",
        stage: "verified",
      })
    ).rejects.toMatchObject({ status: 403, code: "verified_needs_person" });
    expect(h.created).toEqual([]);
  });

  it("still creates a task in an ordinary stage", async () => {
    const result = await rest(cursorTasksPost, "/api/cursor/tasks", "claude-key", {
      title: "Ordinary",
      bucket: "BKT-INFRA",
      kind: "code",
      stage: "planned",
    });
    expect(result.status).toBe(200);
    expect(h.created).toHaveLength(1);
  });
});

describe("mc_update_task and mc_update_tasks reopen cannot reach verified (W02)", () => {
  it("rejects a reopen into verified or merged", () => {
    expect(reopenPatchSchema.safeParse({ stage: "verified" }).success).toBe(false);
    expect(reopenPatchSchema.safeParse({ stage: "merged" }).success).toBe(false);
    expect(reopenPatchSchema.safeParse({ stage: "review" }).success).toBe(true);
  });
});
