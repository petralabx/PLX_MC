// P5 — both checkout doors invoke the shared checkout() core with equivalent
// verification guarantees; fallback script banners prefer MCP checkout.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  checkout: vi.fn(async () => ({ checkoutId: "dsp_shared" })),
  requireSessionActor: vi.fn(),
  requireMcpActor: vi.fn(),
  verifyMcpRequest: vi.fn(),
}));

vi.mock("@/lib/compliance/service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/compliance/service")>(
    "@/lib/compliance/service"
  );
  return {
    ...actual,
    checkout: mocks.checkout,
  };
});

vi.mock("@/lib/routing/mutations/actors", () => ({
  requireSessionActor: mocks.requireSessionActor,
  requireMcpActor: mocks.requireMcpActor,
}));

vi.mock("@/lib/mcp/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mcp/auth")>("@/lib/mcp/auth");
  return {
    ...actual,
    verifyMcpRequest: mocks.verifyMcpRequest,
  };
});

vi.mock("@/lib/mcp/audit", () => ({
  recordMcpToolCall: vi.fn(async () => "1"),
}));

vi.mock("@/lib/mcp/sync-meta", () => ({
  syncMetaForTask: vi.fn(async () => ({ status: "queued" })),
}));

vi.mock("@/lib/api/route", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/route")>("@/lib/api/route");
  return {
    ...actual,
    route: (handler: (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<unknown>) =>
      handler,
  };
});

const sessionActor = {
  kind: "human" as const,
  id: "oid-1",
  role: "member" as const,
  status: "active" as const,
};

const mcpIdentity = {
  operatorEmail: "vince@petrasoap.com",
  runtime: "cursor",
  workerId: "w1",
  repo: "petralabx/PLX_MC",
  servicePrincipalId: "sp_mcp_cursor",
  actor: { kind: "service" as const, id: "sp_mcp_cursor", status: "active" as const },
};

describe("checkout doors → shared checkout() core", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkout.mockResolvedValue({ checkoutId: "dsp_shared" });
    mocks.requireSessionActor.mockResolvedValue({
      actor: sessionActor,
      actorId: "oid-1",
      actorKind: "human",
      auditLabel: "vince@petrasoap.com",
    });
    mocks.requireMcpActor.mockReturnValue({
      actor: mcpIdentity.actor,
      actorId: "sp_mcp_cursor",
      actorKind: "service",
      auditLabel: "vince@petrasoap.com",
    });
    mocks.verifyMcpRequest.mockResolvedValue(mcpIdentity);
  });

  it("POST /api/cursor/checkout and POST /api/compliance/checkout both call checkout()", async () => {
    const { POST: cursorCheckout } = await import("@/app/api/cursor/checkout/route");
    const { POST: complianceCheckout } = await import("@/app/api/compliance/checkout/route");

    await cursorCheckout(
      new Request("http://localhost/api/cursor/checkout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": "k",
          "x-mc-operator-email": "vince@petrasoap.com",
          "x-mc-repo": "petralabx/PLX_MC",
        },
        body: JSON.stringify({ taskId: "TASK-490" }),
      }),
      { params: Promise.resolve({}) }
    );

    await complianceCheckout(
      new Request("http://localhost/api/compliance/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskId: "TASK-490",
          runtime: "cursor",
          accountableHuman: "vince@petrasoap.com",
          repo: "petralabx/PLX_MC",
        }),
      }),
      { params: Promise.resolve({}) }
    );

    expect(mocks.checkout).toHaveBeenCalledTimes(2);

    const checkoutCalls = mocks.checkout.mock.calls as unknown as Array<[Record<string, unknown>]>;
    const mcpCall = checkoutCalls[0][0];
    const complianceCall = checkoutCalls[1][0];

    // Equivalent verification guarantees: same task + repo + authorized actor.
    expect(mcpCall).toMatchObject({
      taskId: "TASK-490",
      repo: "petralabx/PLX_MC",
      accountableHuman: "vince@petrasoap.com",
      runtime: "cursor",
      actor: expect.objectContaining({ id: "sp_mcp_cursor" }),
      door: "mcp",
    });
    expect(complianceCall).toMatchObject({
      taskId: "TASK-490",
      repo: "petralabx/PLX_MC",
      accountableHuman: "vince@petrasoap.com",
      runtime: "cursor",
      actor: expect.objectContaining({ id: "oid-1" }),
      door: "compliance",
    });

    expect(mocks.requireMcpActor).toHaveBeenCalledWith(
      mcpIdentity,
      "task.checkout",
      expect.objectContaining({ type: "task", id: "TASK-490" }),
      expect.objectContaining({ repositoryId: "petralabx/PLX_MC" })
    );
    expect(mocks.requireSessionActor).toHaveBeenCalledWith(
      "task.checkout",
      expect.objectContaining({ type: "task", id: "TASK-490" }),
      expect.objectContaining({ repositoryId: "petralabx/PLX_MC" })
    );
  });
});

describe("compliance-checkout fallback banner", () => {
  it("prints prefer-MCP banner when capture is enabled", async () => {
    const scriptPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../scripts/compliance-checkout.mjs"
    );
    let pathname = path.resolve(scriptPath).replace(/\\/g, "/");
    if (!pathname.startsWith("/")) pathname = `/${pathname}`;
    pathname = pathname.replace(/ /g, "%20");
    const { capture } = await import(`file://${pathname}`);

    const logs: string[] = [];
    const fetch = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ data: { checkoutId: "dsp_banner" } }),
      }) as unknown as Response) as typeof globalThis.fetch;

    await capture({
      env: {
        COMPLIANCE_CAPTURE: "1",
        MC_BASE_URL: "http://mc",
        MC_ACCOUNTABLE: "vince",
        MC_REPO: "petralabx/PLX_MC",
        MC_TASK_ID: "TASK-1",
      },
      fetch,
      log: (m: string) => logs.push(m),
    });

    expect(logs[0]).toBe("[compliance-capture] fallback path — prefer MCP checkout");
  });
});
