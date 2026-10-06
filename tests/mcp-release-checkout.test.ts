// TASK-2326: mc_release_checkout / mc_release_checkouts. Every case runs on
// both agent paths: JSON-RPC tools/call on POST /api/cursor/mcp (the HTTP MCP
// server) and the /api/cursor/checkouts/release[-batch] REST routes the stdio
// client proxies to. The dispatch ledger is an in-memory fake with the same
// guards as the repo SQL (release only an unrevoked, unreleased lease), so the
// real action, authorization, ACL and audit logic run without a database.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Dispatch = {
  id: string;
  actorKind: "agent";
  runtime: string;
  taskId: string;
  accountableHuman: string;
  repo: string;
  revoked: boolean;
  expiresAt: string;
  releasedAt: string | null;
  releasedReason: string | null;
};

type Event = { kind: string; actor: string; repo?: string | null; taskId?: string | null; payload: Record<string, unknown> };

const h = vi.hoisted(() => ({
  dispatches: new Map<string, Dispatch>(),
  events: [] as Event[],
  patchTask: vi.fn(),
}));

vi.mock("@/lib/permissions/decision-log", () => ({
  recordPermissionDecision: vi.fn(async () => true),
}));

vi.mock("@/lib/mcp/audit", () => ({
  recordMcpToolCall: vi.fn(async () => "1"),
}));

vi.mock("@/lib/sync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sync")>()),
  patchTask: h.patchTask,
}));

vi.mock("@/lib/sync/repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sync/repo")>()),
  getEntity: vi.fn(async (_kind: string, id: string) => ({
    data: { id, stage: "progress", bucket: id === "TASK-SECRET" ? "BKT-SECRET" : "BKT-OPEN" },
  })),
  getBuckets: vi.fn(async () => [
    { id: "BKT-OPEN", name: "Open", project: null },
    { id: "BKT-SECRET", name: "Secret", project: "PRJ-SECRET" },
  ]),
  getProjects: vi.fn(async () => [
    { id: "PRJ-SECRET", name: "Secret", visibility: "restricted", members: ["someone-else@petrasoap.com"] },
  ]),
}));

vi.mock("@/lib/compliance/repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/compliance/repo")>()),
  getDispatch: vi.fn(async (id: string) => {
    const d = h.dispatches.get(id);
    return d ? { ...d } : null;
  }),
  findDispatchesBySuffix: vi.fn(async (taskId: string, suffix: string) =>
    [...h.dispatches.values()].filter((d) => d.taskId === taskId && d.id.endsWith(suffix)).map((d) => ({ ...d }))
  ),
  releaseDispatchManually: vi.fn(
    async (input: { id: string; releasedReason: string; actor: string; payload: Record<string, unknown> }) => {
      const d = h.dispatches.get(input.id);
      if (!d || d.revoked || d.releasedAt) return null;
      d.releasedAt = "2026-10-03T12:00:00.000Z";
      d.releasedReason = input.releasedReason;
      h.events.push({ kind: "checkout.released", actor: input.actor, repo: d.repo, taskId: d.taskId, payload: input.payload });
      return { releasedAt: d.releasedAt, eventSeq: String(h.events.length) };
    }
  ),
  appendEvent: vi.fn(async (e: Event) => {
    h.events.push({ ...e, payload: e.payload ?? {} });
    return String(h.events.length);
  }),
}));

import { POST as mcpPost } from "@/app/api/cursor/mcp/route";
import { POST as releaseRoute } from "@/app/api/cursor/checkouts/release/route";
import { POST as releaseBatchRoute } from "@/app/api/cursor/checkouts/release-batch/route";
import { authorizeCheckoutRelease } from "@/lib/mcp/checkout-release-actions";
import { recordPermissionDecision } from "@/lib/permissions/decision-log";

const FUTURE = new Date(Date.now() + 3_600_000).toISOString();
const PAST = new Date(Date.now() - 3_600_000).toISOString();

function seed(id: string, taskId: string, over: Partial<Dispatch> = {}): void {
  h.dispatches.set(id, {
    id,
    actorKind: "agent",
    runtime: "claude-code",
    taskId,
    accountableHuman: "ross@petrasoap.com",
    repo: "petralabx/PLX_MC",
    revoked: false,
    expiresAt: FUTURE,
    releasedAt: null,
    releasedReason: null,
    ...over,
  });
}

function headers(operator: string): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "x-api-key": "test-mcp-key",
    "x-mc-operator-email": operator,
    "x-mc-repo": "petralabx/PLX_MC",
    "x-mc-runtime": "claude-code",
    "x-mc-worker-id": "release-test",
  };
}

// Parsed tool JSON is asserted field by field below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
type Outcome = { ok: boolean; status: number | null; body: Body; text: string };

let rpcId = 0;

async function viaMcp(tool: string, args: Record<string, unknown>, operator: string): Promise<Outcome> {
  rpcId += 1;
  const res = await mcpPost(
    new Request("http://localhost/api/cursor/mcp", {
      method: "POST",
      headers: headers(operator),
      body: JSON.stringify({ jsonrpc: "2.0", id: rpcId, method: "tools/call", params: { name: tool, arguments: args } }),
    })
  );
  expect(res.status).toBe(200);
  const json = (await res.json()) as { result: { content: { text: string }[]; isError?: boolean } };
  const text = json.result.content[0].text;
  const body = JSON.parse(text) as Body;
  return { ok: json.result.isError !== true, status: null, body, text };
}

async function viaRest(tool: string, args: Record<string, unknown>, operator: string): Promise<Outcome> {
  const route = tool === "mc_release_checkouts" ? releaseBatchRoute : releaseRoute;
  const path = tool === "mc_release_checkouts" ? "release-batch" : "release";
  const res = await route(
    new Request(`http://localhost/api/cursor/checkouts/${path}`, {
      method: "POST",
      headers: headers(operator),
      body: JSON.stringify(args),
    }),
    { params: Promise.resolve({}) }
  );
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: JSON.parse(text) as Body, text };
}

const TRANSPORTS = [
  ["HTTP MCP", viaMcp],
  ["REST (stdio proxy)", viaRest],
] as const;

const releasedEvents = () => h.events.filter((e) => e.kind === "checkout.released");
const deniedEvents = () => h.events.filter((e) => e.kind === "checkout.release_denied");

beforeEach(() => {
  vi.stubEnv("PLX_MC_MCP_ENABLED", "1");
  vi.stubEnv("PLX_MC_MCP_API_KEY", "test-mcp-key");
  vi.stubEnv("PLX_MC_MCP_AGENT_KEYS", "");
  vi.stubEnv(
    "PLX_MC_ALLOWED_USERS",
    "vince@petrasoap.com,ross@petrasoap.com,stephen@petrasoap.com,cos@petrasoap.com"
  );
  vi.stubEnv("PLX_MC_PUBLIC_URL", "https://mc.plxcustomer.io");
  h.dispatches.clear();
  h.events.length = 0;
  h.patchTask.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("authorizeCheckoutRelease", () => {
  it("allows the accountable human, an admin, and a Ledger/CoS steward", () => {
    expect(authorizeCheckoutRelease("Ross@PetraSoap.com", { accountableHuman: "ross@petrasoap.com" })).toEqual({
      allowed: true,
      reasonCode: "accountable_human",
    });
    expect(authorizeCheckoutRelease("vince@petrasoap.com", { accountableHuman: "ross@petrasoap.com" })).toEqual({
      allowed: true,
      reasonCode: "admin",
    });
    expect(authorizeCheckoutRelease("cos@petrasoap.com", { accountableHuman: "ross@petrasoap.com" })).toEqual({
      allowed: true,
      reasonCode: "steward",
    });
  });

  it("denies everyone else with not_accountable", () => {
    // stephen is in the directory but holds no admin role.
    expect(authorizeCheckoutRelease("stephen@petrasoap.com", { accountableHuman: "ross@petrasoap.com" })).toEqual({
      allowed: false,
      reasonCode: "not_accountable",
    });
    expect(authorizeCheckoutRelease("", { accountableHuman: "" }).allowed).toBe(false);
  });
});

describe("tool registration", () => {
  it("lists both tools on the HTTP MCP server", async () => {
    const res = await mcpPost(
      new Request("http://localhost/api/cursor/mcp", {
        method: "POST",
        headers: headers("vince@petrasoap.com"),
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      })
    );
    const json = (await res.json()) as { result: { tools: { name: string }[] } };
    const names = json.result.tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["mc_release_checkout", "mc_release_checkouts"]));
  });
});

for (const [transport, call] of TRANSPORTS) {
  describe(`mc_release_checkout over ${transport}`, () => {
    it("lets the accountable human release by full id and audits checkout.released", async () => {
      seed("dsp_abcdefgh1234", "TASK-2279");
      const out = await call(
        "mc_release_checkout",
        { checkoutId: "dsp_abcdefgh1234", reason: "stray from a stopped run" },
        "ross@petrasoap.com"
      );
      expect(out.ok).toBe(true);
      expect(out.body.data).toMatchObject({
        taskId: "TASK-2279",
        checkoutRef: "dsp_…1234",
        releasedReason: "manual: stray from a stopped run",
        authz: "accountable_human",
      });
      // The usable credential never comes back.
      expect(out.text).not.toContain("dsp_abcdefgh1234");
      expect(h.dispatches.get("dsp_abcdefgh1234")).toMatchObject({
        releasedAt: expect.any(String),
        releasedReason: "manual: stray from a stopped run",
        revoked: false,
      });
      expect(releasedEvents()).toEqual([
        {
          kind: "checkout.released",
          actor: "claude-code:ross@petrasoap.com",
          repo: "petralabx/PLX_MC",
          taskId: "TASK-2279",
          payload: expect.objectContaining({
            checkoutRef: "dsp_…1234",
            reason: "stray from a stopped run",
            reasonCode: "accountable_human",
            servicePrincipalId: "sp_mcp_cursor",
            wasExpired: false,
          }),
        },
      ]);
      expect(recordPermissionDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          site: "mcp.release-checkout",
          allowed: true,
          reasonCode: "accountable_human",
        })
      );
      // Only the lease changes: the task stage and Verified are never written.
      expect(h.patchTask).not.toHaveBeenCalled();
    });

    it("lets an admin and a Ledger/CoS steward release another person's lease", async () => {
      seed("dsp_aaaaaaaa0001", "TASK-1");
      seed("dsp_aaaaaaaa0002", "TASK-1");
      const admin = await call("mc_release_checkout", { checkoutId: "dsp_aaaaaaaa0001", reason: "x" }, "vince@petrasoap.com");
      const steward = await call("mc_release_checkout", { checkoutId: "dsp_aaaaaaaa0002", reason: "x" }, "cos@petrasoap.com");
      expect(admin.body.data.authz).toBe("admin");
      expect(steward.body.data.authz).toBe("steward");
      expect(releasedEvents()).toHaveLength(2);
    });

    it("forbids anyone else and audits the reasonCode", async () => {
      seed("dsp_abcdefgh1234", "TASK-2279");
      const out = await call(
        "mc_release_checkout",
        { checkoutId: "dsp_abcdefgh1234", reason: "not mine" },
        "stephen@petrasoap.com"
      );
      expect(out.ok).toBe(false);
      if (out.status !== null) expect(out.status).toBe(403);
      expect(out.body.error).toMatchObject({ code: "forbidden" });
      expect(out.body.error.message).toContain("not_accountable");
      expect(h.dispatches.get("dsp_abcdefgh1234")?.releasedAt).toBeNull();
      expect(releasedEvents()).toEqual([]);
      expect(deniedEvents()).toEqual([
        expect.objectContaining({
          actor: "claude-code:stephen@petrasoap.com",
          taskId: "TASK-2279",
          payload: expect.objectContaining({ checkoutRef: "dsp_…1234", reasonCode: "not_accountable" }),
        }),
      ]);
      expect(recordPermissionDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          site: "mcp.release-checkout",
          allowed: false,
          reasonCode: "not_accountable",
        })
      );
    });

    it("refuses an already-released lease without a second event", async () => {
      seed("dsp_abcdefgh1234", "TASK-2279");
      await call("mc_release_checkout", { checkoutId: "dsp_abcdefgh1234", reason: "first" }, "ross@petrasoap.com");
      const again = await call("mc_release_checkout", { checkoutId: "dsp_abcdefgh1234", reason: "again" }, "ross@petrasoap.com");
      expect(again.ok).toBe(false);
      if (again.status !== null) expect(again.status).toBe(409);
      expect(again.body.error).toMatchObject({ code: "already_released" });
      expect(releasedEvents()).toHaveLength(1);
      expect(h.dispatches.get("dsp_abcdefgh1234")?.releasedReason).toBe("manual: first");
    });

    it("refuses a lease released by a PR merge/close the same way", async () => {
      seed("dsp_abcdefgh1234", "TASK-2279", { releasedAt: PAST, releasedReason: "merged" });
      const out = await call("mc_release_checkout", { checkoutId: "dsp_abcdefgh1234", reason: "x" }, "ross@petrasoap.com");
      expect(out.body.error).toMatchObject({ code: "already_released" });
      expect(releasedEvents()).toEqual([]);
    });

    it("refuses a revoked lease", async () => {
      seed("dsp_abcdefgh1234", "TASK-2279", { revoked: true });
      const out = await call("mc_release_checkout", { checkoutId: "dsp_abcdefgh1234", reason: "x" }, "ross@petrasoap.com");
      expect(out.body.error).toMatchObject({ code: "checkout_revoked" });
      expect(releasedEvents()).toEqual([]);
    });

    it("releases an expired but unreleased lease", async () => {
      seed("dsp_expiredx9cv2", "TASK-2206", { expiresAt: PAST });
      const out = await call(
        "mc_release_checkout",
        { checkoutRef: "dsp_…9cv2", taskId: "TASK-2206", reason: "expired, never released" },
        "cos@petrasoap.com"
      );
      expect(out.ok).toBe(true);
      expect(releasedEvents()[0].payload).toMatchObject({ checkoutRef: "dsp_…9cv2", wasExpired: true });
    });

    it("resolves a redacted ref plus taskId to the one matching lease", async () => {
      seed("dsp_cursorxxbn4y", "TASK-2279", { runtime: "cursor" });
      seed("dsp_claudexx7px3", "TASK-2279");
      seed("dsp_othertasbn4y", "TASK-9999");
      const out = await call(
        "mc_release_checkout",
        { checkoutRef: "dsp_…bn4y", taskId: "TASK-2279", reason: "stray cursor lease" },
        "ross@petrasoap.com"
      );
      expect(out.ok).toBe(true);
      expect(out.body.data).toMatchObject({ checkoutRef: "dsp_…bn4y", runtime: "cursor" });
      expect(h.dispatches.get("dsp_cursorxxbn4y")?.releasedAt).not.toBeNull();
      expect(h.dispatches.get("dsp_claudexx7px3")?.releasedAt).toBeNull();
      expect(h.dispatches.get("dsp_othertasbn4y")?.releasedAt).toBeNull();
      // ASCII dots work too.
      const ascii = await call(
        "mc_release_checkout",
        { checkoutRef: "dsp_...7px3", taskId: "TASK-2279", reason: "stray claude lease" },
        "ross@petrasoap.com"
      );
      expect(ascii.ok).toBe(true);
    });

    it("refuses an ambiguous ref plus taskId and releases nothing", async () => {
      seed("dsp_firstxxxbn4y", "TASK-2279");
      seed("dsp_secondxxbn4y", "TASK-2279");
      const out = await call(
        "mc_release_checkout",
        { checkoutRef: "dsp_…bn4y", taskId: "TASK-2279", reason: "x" },
        "ross@petrasoap.com"
      );
      expect(out.ok).toBe(false);
      if (out.status !== null) expect(out.status).toBe(409);
      expect(out.body.error).toMatchObject({ code: "ambiguous_checkout_ref" });
      expect([...h.dispatches.values()].every((d) => d.releasedAt === null)).toBe(true);
      expect(h.events).toEqual([]);
    });

    it("rejects a bad target: ref without taskId, ref as checkoutId, both, neither, unknown", async () => {
      seed("dsp_abcdefgh1234", "TASK-2279");
      const cases: [Record<string, unknown>, string][] = [
        [{ checkoutRef: "dsp_…1234", reason: "x" }, "invalid_request"],
        [{ checkoutId: "dsp_…1234", reason: "x" }, "invalid_request"],
        [{ checkoutId: "dsp_abcdefgh1234", checkoutRef: "dsp_…1234", taskId: "TASK-2279", reason: "x" }, "invalid_request"],
        [{ reason: "x" }, "invalid_request"],
        [{ checkoutId: "dsp_nosuchlease", reason: "x" }, "not_found"],
        [{ checkoutId: "dsp_abcdefgh1234", taskId: "TASK-OTHER", reason: "x" }, "not_found"],
        [{ checkoutRef: "dsp_…zzzz", taskId: "TASK-2279", reason: "x" }, "not_found"],
      ];
      for (const [args, code] of cases) {
        const out = await call("mc_release_checkout", args, "ross@petrasoap.com");
        expect({ args, ok: out.ok, code: out.body.error?.code }).toEqual({ args, ok: false, code });
      }
      expect(h.events).toEqual([]);
    });

    it("hides a lease on a restricted-project task", async () => {
      seed("dsp_secretxx0001", "TASK-SECRET");
      const out = await call("mc_release_checkout", { checkoutId: "dsp_secretxx0001", reason: "x" }, "vince@petrasoap.com");
      expect(out.ok).toBe(false);
      expect(h.dispatches.get("dsp_secretxx0001")?.releasedAt).toBeNull();
      expect(h.events).toEqual([]);
    });
  });

  describe(`mc_release_checkouts over ${transport}`, () => {
    it("returns a per-item outcome and keeps going past a failed item", async () => {
      seed("dsp_cursorxxbn4y", "TASK-2279");
      seed("dsp_claudexx7px3", "TASK-2279");
      seed("dsp_notminexx0001", "TASK-1", { accountableHuman: "greg.m@petrasoap.com" });
      const out = await call(
        "mc_release_checkouts",
        {
          items: [
            { checkoutRef: "dsp_…bn4y", taskId: "TASK-2279", reason: "stray" },
            { checkoutId: "dsp_notminexx0001", reason: "not mine" },
            { checkoutId: "dsp_claudexx7px3", reason: "stray" },
            { checkoutId: "dsp_claudexx7px3", reason: "duplicate" },
          ],
        },
        "ross@petrasoap.com"
      );
      expect(out.ok).toBe(true);
      expect(out.body.data).toMatchObject({ released: 2, failed: 2 });
      expect(out.body.data.results).toEqual([
        { index: 0, ok: true, data: expect.objectContaining({ checkoutRef: "dsp_…bn4y" }) },
        { index: 1, ok: false, error: expect.objectContaining({ code: "forbidden" }) },
        { index: 2, ok: true, data: expect.objectContaining({ checkoutRef: "dsp_…7px3" }) },
        { index: 3, ok: false, error: expect.objectContaining({ code: "already_released" }) },
      ]);
      expect(releasedEvents()).toHaveLength(2);
      expect(deniedEvents()).toHaveLength(1);
      expect(h.patchTask).not.toHaveBeenCalled();
    });
  });
}
