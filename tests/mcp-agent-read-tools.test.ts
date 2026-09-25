// Wave 4 agent read tools (mc_get_task, mc_list_checkouts, mc_search_knowledge,
// mc_verify_pr) + mc_request_approval. Every tool is driven through the paths an
// agent uses: JSON-RPC tools/call on POST /api/cursor/mcp (the remote HTTP MCP
// server) and the /api/cursor/* REST routes the stdio client proxies to. The
// data layer (sync snapshot, compliance ledger, brain-ask, GitHub) is mocked so
// the real actions, authorization, and ACL filtering run without a database.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("PLX_MC_MCP_ENABLED", "1");
vi.stubEnv("PLX_MC_MCP_API_KEY", "test-mcp-key");
vi.stubEnv("PLX_MC_MCP_AGENT_KEYS", "");
vi.stubEnv("PLX_MC_ALLOWED_USERS", "vince@petrasoap.com");
vi.stubEnv("PLX_MC_PUBLIC_URL", "https://mc.plxcustomer.io");

const m = vi.hoisted(() => ({
  snapshot: vi.fn(),
  eventsForTask: vi.fn(),
  listDispatches: vi.fn(),
  getDispatch: vi.fn(),
  recordCheck: vi.fn(),
  appendEvent: vi.fn(),
  enqueueReconcile: vi.fn(),
  getEntity: vi.fn(),
  getBuckets: vi.fn(),
  getProjects: vi.fn(),
  searchBrainAsk: vi.fn(),
  requestApprovalGate: vi.fn(),
  resolveGithubToken: vi.fn(),
}));

vi.mock("@/lib/permissions/decision-log", () => ({
  recordPermissionDecision: vi.fn(async () => true),
}));

vi.mock("@/lib/mcp/audit", () => ({
  recordMcpToolCall: vi.fn(async () => "1"),
}));

vi.mock("@/lib/sync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sync")>()),
  snapshot: m.snapshot,
}));

vi.mock("@/lib/sync/repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sync/repo")>()),
  getEntity: m.getEntity,
  getBuckets: m.getBuckets,
  getProjects: m.getProjects,
}));

vi.mock("@/lib/compliance/repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/compliance/repo")>()),
  eventsForTask: m.eventsForTask,
  listDispatches: m.listDispatches,
  getDispatch: m.getDispatch,
  recordCheck: m.recordCheck,
  appendEvent: m.appendEvent,
  enqueueReconcile: m.enqueueReconcile,
}));

vi.mock("@/lib/brain-ask", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/brain-ask")>()),
  searchBrainAsk: m.searchBrainAsk,
}));

vi.mock("@/lib/compliance/approvals", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/compliance/approvals")>()),
  requestApprovalGate: m.requestApprovalGate,
}));

vi.mock("@/lib/github-app", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/github-app")>()),
  resolveGithubToken: m.resolveGithubToken,
}));

import { POST as mcpPost } from "@/app/api/cursor/mcp/route";
import { GET as getTaskRoute } from "@/app/api/cursor/tasks/[id]/route";
import { GET as listCheckoutsRoute } from "@/app/api/cursor/checkouts/route";
import { GET as searchKnowledgeRoute } from "@/app/api/cursor/knowledge/search/route";
import { GET as verifyRoute } from "@/app/api/cursor/verify/route";
import { POST as requestApprovalRoute } from "@/app/api/cursor/request-approval/route";
import { actionListBuckets } from "@/lib/mcp/actions";
import { actionRequestApproval } from "@/lib/mcp/approval-actions";
import type { McpIdentity } from "@/lib/mcp/auth";
import { actionGetTask } from "@/lib/mcp/read-actions";

const HEADERS: Record<string, string> = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  "x-api-key": "test-mcp-key",
  "x-mc-operator-email": "vince@petrasoap.com",
  "x-mc-repo": "petralabx/PLX_MC",
  "x-mc-runtime": "cursor",
  "x-mc-worker-id": "wave4-test",
};

let rpcId = 0;

async function rpc(method: string, params: unknown): Promise<Record<string, unknown>> {
  rpcId += 1;
  const res = await mcpPost(
    new Request("http://localhost/api/cursor/mcp", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ jsonrpc: "2.0", id: rpcId, method, params }),
    })
  );
  expect(res.status).toBe(200);
  const json = (await res.json()) as { result: Record<string, unknown> };
  return json.result;
}

// Parsed tool JSON is asserted field by field below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolBody = Record<string, any>;

async function callTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ isError: boolean; body: ToolBody }> {
  const result = (await rpc("tools/call", { name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  return { isError: result.isError === true, body: JSON.parse(result.content[0].text) };
}

function rest(path: string, init: RequestInit = {}): Request {
  return new Request(`http://localhost${path}`, { ...init, headers: HEADERS });
}

const noParams = { params: Promise.resolve({} as Record<string, string>) };

const OPEN_TASK = {
  id: "TASK-100",
  title: "Wave 4 read tools",
  bucket: "BKT-OPEN",
  stage: "progress",
  priority: "high",
  assignee: "claude",
  coassignees: [],
  reporter: "vince",
  accountableOwner: "greg",
  reqs: [],
  repos: ["plx-mc"],
  estimate: "M",
  labels: [],
  prs: [],
  due: "—",
  sync: { state: "synced", ts: "—", sp: "—" },
  subtasks: [],
  activity: [],
  evidence: {
    summary: "Added read tools",
    items: [
      { key: "summary", label: "Summary", done: true },
      { key: "verification", label: "Verification commands run", done: true },
      { key: "rollback", label: "Rollback plan", done: true },
    ],
    rollback: "Revert the PR",
  },
};

const HIDDEN_TASK = { ...OPEN_TASK, id: "TASK-200", title: "Secret work", bucket: "BKT-SECRET" };

const BUCKETS = [
  { id: "BKT-OPEN", name: "Open", owner: "vince", health: "track", project: null, prd: null },
  { id: "BKT-SECRET", name: "Secret", owner: "vince", health: "track", project: "PRJ-SECRET", prd: null },
];

const PROJECTS = [
  { id: "PRJ-SECRET", name: "Secret", visibility: "restricted", members: ["someone-else@petrasoap.com"] },
];

const FUTURE = new Date(Date.now() + 3_600_000).toISOString();

function dispatch(id: string, taskId: string, over: Record<string, unknown> = {}) {
  return {
    id,
    actorKind: "agent",
    runtime: "cursor",
    taskId,
    accountableHuman: "vince@petrasoap.com",
    repo: "petralabx/PLX_MC",
    revoked: false,
    issuedAt: "2026-09-25T10:00:00.000Z",
    expiresAt: FUTURE,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.snapshot.mockResolvedValue({
    tasks: [OPEN_TASK, HIDDEN_TASK],
    buckets: BUCKETS,
    projects: PROJECTS,
    conflicts: [],
    errors: [],
    lastSweep: null,
    repos: [],
  });
  m.getBuckets.mockResolvedValue(BUCKETS);
  m.getProjects.mockResolvedValue(PROJECTS);
  m.eventsForTask.mockResolvedValue([
    {
      seq: "42",
      ts: "2026-09-25T10:00:00.000Z",
      kind: "checkout",
      actor: "cursor",
      repo: "petralabx/PLX_MC",
      taskId: "TASK-100",
      pr: null,
      payload: { checkoutId: "dsp_abc123" },
    },
  ]);
  // The SQL applies the taskId filter; the mock mirrors that one predicate.
  m.listDispatches.mockImplementation(async (filter: { taskId?: string }) =>
    [dispatch("dsp_abc123", "TASK-100"), dispatch("dsp_secret1", "TASK-200")].filter(
      (row) => !filter.taskId || row.taskId === filter.taskId
    )
  );
  m.appendEvent.mockResolvedValue(undefined);
  m.recordCheck.mockResolvedValue(undefined);
  m.searchBrainAsk.mockResolvedValue({
    query: "wave 4",
    configured: true,
    status: "ok",
    hits: [
      {
        id: "graph:doc-1",
        title: "Agent PR SOP",
        snippet: "Checkout before edit.",
        score: 0.9,
        namespace: "company/",
        source: "vmc",
      },
    ],
  });
  m.requestApprovalGate.mockResolvedValue({
    gate: { id: "apg_0123456789abcdef", status: "pending" },
    task: OPEN_TASK,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tool registry", () => {
  it("registers the wave 4 tools on the HTTP MCP server", async () => {
    const result = (await rpc("tools/list", {})) as { tools: { name: string }[] };
    const names = result.tools.map((tool) => tool.name);
    for (const tool of [
      "mc_get_task",
      "mc_list_checkouts",
      "mc_search_knowledge",
      "mc_verify_pr",
      "mc_request_approval",
      "mc_list_buckets",
    ]) {
      expect(names).toContain(tool);
    }
    expect(names).toHaveLength(27);
  });
});

describe("mc_get_task", () => {
  it("returns the task with events, checkouts, accountable owner and evidence", async () => {
    const { isError, body } = await callTool("mc_get_task", { id: "TASK-100" });
    expect(isError).toBe(false);
    expect(body.data).toMatchObject({
      taskId: "TASK-100",
      task: { id: "TASK-100", title: "Wave 4 read tools" },
      accountableOwner: "greg",
      evidence: { summary: "Added read tools", rollback: "Revert the PR" },
      link: "https://mc.plxcustomer.io/tasks/TASK-100",
      events: [{ seq: "42", kind: "checkout" }],
      checkouts: [
        {
          checkoutId: "dsp_abc123",
          taskId: "TASK-100",
          repo: "petralabx/PLX_MC",
          active: true,
          revoked: false,
        },
      ],
    });
    // Audit rows of agent reads must not crowd out the task's own history.
    expect(m.eventsForTask).toHaveBeenCalledWith(
      "TASK-100",
      expect.objectContaining({ excludeKinds: ["mcp.tool.invoked"] })
    );
    expect(m.listDispatches).toHaveBeenCalledWith(expect.objectContaining({ taskId: "TASK-100" }));
  });

  it("fails closed with a structured not_found for a restricted-project task", async () => {
    const { isError, body } = await callTool("mc_get_task", { id: "TASK-200" });
    expect(isError).toBe(true);
    expect(body).toEqual({ error: { code: "not_found", message: "unknown task TASK-200" } });
    expect(m.eventsForTask).not.toHaveBeenCalled();
  });

  it("serves the same payload on GET /api/cursor/tasks/{id}", async () => {
    const res = await getTaskRoute(rest("/api/cursor/tasks/TASK-100"), {
      params: Promise.resolve({ id: "TASK-100" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toMatchObject({ taskId: "TASK-100", accountableOwner: "greg" });
    expect(json.meta.audit.kinds).toEqual(["mc_get_task", "mcp.tool.invoked"]);
  });

  it("is allowed for a principal holding task.read without any write capability", async () => {
    const readOnly: McpIdentity = {
      operatorEmail: "vince@petrasoap.com",
      runtime: "cursor",
      workerId: "w",
      repo: "petralabx/PLX_MC",
      servicePrincipalId: "sp_mcp_cursor",
      actor: { kind: "service", id: "sp_sync_inbound", status: "active" },
    };
    await expect(actionGetTask(readOnly, "TASK-100")).resolves.toMatchObject({ taskId: "TASK-100" });
  });
});

describe("mc_list_checkouts", () => {
  it("filters by repo slug, taskId and active, and drops ACL-hidden tasks", async () => {
    const { isError, body } = await callTool("mc_list_checkouts", {
      repo: "petralabx/PLX_MC",
      active: true,
    });
    expect(isError).toBe(false);
    expect(m.listDispatches).toHaveBeenCalledWith({
      repo: "petralabx/PLX_MC",
      taskId: undefined,
      active: true,
      limit: 50,
    });
    expect(body.data.checkouts.map((c: { checkoutId: string }) => c.checkoutId)).toEqual([
      "dsp_abc123",
    ]);
    expect(body.data.count).toBe(1);
    expect(body.meta.filter).toEqual({ repo: "petralabx/PLX_MC", active: true, limit: 50 });
  });

  it("rejects a bare repo name with a structured invalid_repo error", async () => {
    const { isError, body } = await callTool("mc_list_checkouts", { repo: "PLX_MC" });
    expect(isError).toBe(true);
    expect(body.error.code).toBe("invalid_repo");
    expect(m.listDispatches).not.toHaveBeenCalled();
  });

  it("serves GET /api/cursor/checkouts with query filters", async () => {
    const res = await listCheckoutsRoute(
      rest("/api/cursor/checkouts?taskId=TASK-100&active=false&limit=10"),
      noParams
    );
    expect(res.status).toBe(200);
    expect(m.listDispatches).toHaveBeenCalledWith({
      repo: undefined,
      taskId: "TASK-100",
      active: false,
      limit: 10,
    });
    const json = await res.json();
    expect(json.meta.filter).toEqual({ taskId: "TASK-100", active: false, limit: 10 });
  });
});

describe("mc_search_knowledge", () => {
  it("searches Ask the Brain through the brain-ask client and keeps hit provenance", async () => {
    const { isError, body } = await callTool("mc_search_knowledge", { q: "wave 4", limit: 5 });
    expect(isError).toBe(false);
    expect(m.searchBrainAsk).toHaveBeenCalledWith("wave 4", 5);
    expect(body.data).toMatchObject({
      query: "wave 4",
      status: "ok",
      configured: true,
      message: null,
      hits: [{ id: "graph:doc-1", source: "vmc", namespace: "company/", score: 0.9 }],
    });
  });

  it("reports not_configured honestly instead of pretending there are no hits", async () => {
    m.searchBrainAsk.mockResolvedValueOnce({
      query: "x",
      configured: false,
      status: "not_configured",
      hits: [],
    });
    const { isError, body } = await callTool("mc_search_knowledge", { q: "x" });
    expect(isError).toBe(false);
    expect(m.searchBrainAsk).toHaveBeenCalledWith("x", 8);
    expect(body.data.status).toBe("not_configured");
    expect(body.data.message).toMatch(/not configured/i);
  });

  it("rejects an empty query with invalid_query on MCP and REST", async () => {
    const { isError, body } = await callTool("mc_search_knowledge", { q: "   " });
    expect(isError).toBe(true);
    expect(body.error.code).toBe("invalid_query");
    const res = await searchKnowledgeRoute(rest("/api/cursor/knowledge/search?q="), noParams);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_query");
    expect(m.searchBrainAsk).not.toHaveBeenCalled();
  });
});

describe("mc_verify_pr", () => {
  function stubGithub() {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/repos/petralabx/PLX_MC/pulls/42")) {
        return Response.json({
          number: 42,
          body: "Adds tools.\n\nMC-Checkout: dsp_abc123\n",
          labels: [{ name: "agent" }],
          head: { sha: "headsha42", ref: "claude/wave4" },
          base: { ref: "main", repo: { id: 7, name: "PLX_MC", full_name: "petralabx/PLX_MC" } },
          user: { login: "claude" },
        });
      }
      if (url.includes("/repos/petralabx/PLX_MC/pulls/42/files")) {
        return Response.json([{ filename: "src/lib/mcp/read-actions.ts" }]);
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  beforeEach(() => {
    m.resolveGithubToken.mockResolvedValue("gh-test-token");
    m.getDispatch.mockResolvedValue(dispatch("dsp_abc123", "TASK-100"));
    m.getEntity.mockImplementation(async (type: string, id: string) =>
      type === "task" && id === "TASK-100" ? { id, data: OPEN_TASK } : null
    );
  });

  it("returns the gate verdict from the PR's stamps and diff without recording it", async () => {
    const fetchMock = stubGithub();
    const { isError, body } = await callTool("mc_verify_pr", { repo: "petralabx/PLX_MC", pr: 42 });
    expect(isError).toBe(false);
    expect(body.data).toMatchObject({
      repo: "petralabx/PLX_MC",
      pr: 42,
      headSha: "headsha42",
      checkoutIds: ["dsp_abc123"],
      changedPathCount: 1,
      verdict: "pass",
      tier: "standard",
      actorKind: "agent",
      taskId: "TASK-100",
      recorded: false,
    });
    // Read-only: the check ledger, gate events and reconcile queue stay untouched.
    expect(m.recordCheck).not.toHaveBeenCalled();
    expect(m.appendEvent).not.toHaveBeenCalled();
    expect(m.enqueueReconcile).not.toHaveBeenCalled();
    expect(m.resolveGithubToken).toHaveBeenCalledWith({ repoOwner: "petralabx" });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer gh-test-token");
  });

  it("blocks when the stamped task's evidence is incomplete", async () => {
    stubGithub();
    m.getEntity.mockResolvedValue({ id: "TASK-100", data: { ...OPEN_TASK, evidence: undefined } });
    const { body } = await callTool("mc_verify_pr", { repo: "petralabx/PLX_MC", pr: 42 });
    expect(body.data.verdict).toBe("block");
    expect(body.data.reasons.join(" ")).toMatch(/evidence summary/);
  });

  it("serves GET /api/cursor/verify?repo=&pr=", async () => {
    stubGithub();
    const res = await verifyRoute(rest("/api/cursor/verify?repo=petralabx/PLX_MC&pr=42"), noParams);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toMatchObject({ verdict: "pass", recorded: false });
    expect(m.recordCheck).not.toHaveBeenCalled();
  });

  it("surfaces a missing GitHub credential as github_unavailable", async () => {
    m.resolveGithubToken.mockResolvedValueOnce(null);
    const { isError, body } = await callTool("mc_verify_pr", { repo: "petralabx/PLX_MC", pr: 42 });
    expect(isError).toBe(true);
    expect(body.error.code).toBe("github_unavailable");
  });
});

describe("mc_request_approval", () => {
  it("raises the approval gate through the shared approvals service", async () => {
    const { isError, body } = await callTool("mc_request_approval", {
      taskId: "TASK-100",
      reason: "Needs a human to approve the prod migration",
    });
    expect(isError).toBe(false);
    expect(m.requestApprovalGate).toHaveBeenCalledWith({
      taskId: "TASK-100",
      reason: "Needs a human to approve the prod migration",
      requestedBy: "vince@petrasoap.com",
      runtime: "cursor",
    });
    expect(body.data).toMatchObject({
      taskId: "TASK-100",
      gateId: "apg_0123456789abcdef",
      status: "pending",
      inputRequired: true,
    });
  });

  it("keeps POST /api/cursor/request-approval on the same action", async () => {
    const res = await requestApprovalRoute(
      rest("/api/cursor/request-approval", {
        method: "POST",
        body: JSON.stringify({ taskId: "TASK-100", reason: "ship it?" }),
      }),
      noParams
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toMatchObject({ gateId: "apg_0123456789abcdef", inputRequired: true });
    expect(json.meta.links.task).toBe("https://mc.plxcustomer.io/tasks/TASK-100");
  });

  it("requires approval.request — a read-only principal is refused before the gate is raised", async () => {
    const readOnly: McpIdentity = {
      operatorEmail: "vince@petrasoap.com",
      runtime: "cursor",
      workerId: "w",
      repo: "petralabx/PLX_MC",
      servicePrincipalId: "sp_mcp_cursor",
      actor: { kind: "service", id: "sp_sync_inbound", status: "active" },
    };
    await expect(
      actionRequestApproval(readOnly, { taskId: "TASK-100", reason: "x" })
    ).rejects.toMatchObject({ code: "forbidden", status: 403 });
    expect(m.requestApprovalGate).not.toHaveBeenCalled();
  });
});

describe("mc_list_buckets read access", () => {
  it("lets a task.read principal without bucket.create discover buckets", async () => {
    const readOnly: McpIdentity = {
      operatorEmail: "vince@petrasoap.com",
      runtime: "swarm",
      workerId: "w",
      repo: "petralabx/agentic-swarm",
      servicePrincipalId: "sp_mcp_swarm",
      actor: { kind: "service", id: "sp_sync_inbound", status: "active" },
    };
    const result = await actionListBuckets(readOnly, {});
    expect(result.buckets.map((bucket) => bucket.id)).toEqual(["BKT-OPEN"]);
  });

  it("still denies a principal with no read grant", async () => {
    const none: McpIdentity = {
      operatorEmail: "vince@petrasoap.com",
      runtime: "cursor",
      workerId: "w",
      repo: "petralabx/PLX_MC",
      servicePrincipalId: "sp_mcp_cursor",
      actor: { kind: "service", id: "sp_unknown_no_grants", status: "active" },
    };
    await expect(actionListBuckets(none, {})).rejects.toMatchObject({ code: "forbidden" });
  });
});
