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
  /** Service principal recorded on the checkout event (permissionActorId). */
  checkoutPrincipal: string | null;
};

type Event = {
  kind: string;
  actor: string;
  repo?: string | null;
  taskId?: string | null;
  pr?: string | null;
  payload: Record<string, unknown>;
};

// A PR as the task's events and GitHub see it (TASK-2965 open-PR guard).
type Pr = { number: number; taskId: string; open: boolean; checkoutIds: string[] };

const h = vi.hoisted(() => ({
  dispatches: new Map<string, Dispatch>(),
  events: [] as Event[],
  prs: [] as Pr[],
  githubDown: false,
  patchTask: vi.fn(),
}));

vi.mock("@/lib/compliance/github-pr", async (importOriginal) => {
  const { ApiError } = await import("@/lib/api/route");
  return {
    ...(await importOriginal<typeof import("@/lib/compliance/github-pr")>()),
    loadPrState: vi.fn(async (_repo: string, prNumber: number) => {
      if (h.githubDown) throw new ApiError("github_unavailable", "No GitHub auth configured.", 503);
      const pr = h.prs.find((p) => p.number === prNumber);
      if (!pr) throw new ApiError("not_found", "PR not found.", 404);
      return { open: pr.open, checkoutIds: pr.checkoutIds };
    }),
  };
});

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
    data: {
      id,
      stage: "progress",
      bucket: id === "TASK-SECRET" ? "BKT-SECRET" : id === "TASK-ROSS" ? "BKT-ROSS" : id === "TASK-CLAUDE" ? "BKT-CLAUDE" : "BKT-OPEN",
    },
  })),
  getBuckets: vi.fn(async () => [
    { id: "BKT-OPEN", name: "Open", project: null },
    { id: "BKT-SECRET", name: "Secret", project: "PRJ-SECRET" },
    { id: "BKT-ROSS", name: "Ross", project: "PRJ-ROSS" },
    { id: "BKT-CLAUDE", name: "Claude", project: "PRJ-CLAUDE" },
  ]),
  getProjects: vi.fn(async () => [
    { id: "PRJ-SECRET", name: "Secret", visibility: "restricted", members: ["someone-else@petrasoap.com"] },
    // A human member, by email and directory id: an MCP header naming them must not pass.
    { id: "PRJ-ROSS", name: "Ross", visibility: "restricted", members: ["ross@petrasoap.com", "ross"] },
    { id: "PRJ-CLAUDE", name: "Claude", visibility: "restricted", members: ["sp_mcp_claude_code"] },
  ]),
}));

vi.mock("@/lib/compliance/repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/compliance/repo")>()),
  getDispatchCheckoutPrincipal: vi.fn(async (id: string) => h.dispatches.get(id)?.checkoutPrincipal ?? null),
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
  openPrCandidatesForTask: vi.fn(async (taskId: string) =>
    h.prs.filter((p) => p.taskId === taskId).map((p) => p.number)
  ),
  appendEvent: vi.fn(async (e: Event) => {
    h.events.push({ ...e, payload: e.payload ?? {} });
    return String(h.events.length);
  }),
}));

import { POST as mcpPost } from "@/app/api/cursor/mcp/route";
import { POST as releaseRoute } from "@/app/api/cursor/checkouts/release/route";
import { POST as releaseBatchRoute } from "@/app/api/cursor/checkouts/release-batch/route";
import {
  authorizeCheckoutRelease,
  authorizeCheckoutReleaseByOperator,
  isExpiredReason,
} from "@/lib/mcp/checkout-release-actions";
import { recordPermissionDecision } from "@/lib/permissions/decision-log";
import * as complianceRepo from "@/lib/compliance/repo";

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
    // The shared test key authenticates sp_mcp_cursor, so by default the caller owns the lease.
    checkoutPrincipal: "sp_mcp_cursor",
    ...over,
  });
}

let workerHeader: string | null = "release-test";

const SHARED_KEY = "test-mcp-key";
const COS_KEY = "cos-key";
const LEDGER_KEY = "ledger-key";
const CLAUDE_KEY = "claude-key";

function headers(operator: string, key: string): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "x-api-key": key,
    "x-mc-operator-email": operator,
    "x-mc-repo": "petralabx/PLX_MC",
    "x-mc-runtime": "claude-code",
    ...(workerHeader === null ? {} : { "x-mc-worker-id": workerHeader }),
  };
}

// Parsed tool JSON is asserted field by field below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
type Outcome = { ok: boolean; status: number | null; body: Body; text: string };

let rpcId = 0;

async function viaMcp(
  tool: string,
  args: Record<string, unknown>,
  operator: string,
  key: string = SHARED_KEY
): Promise<Outcome> {
  rpcId += 1;
  const res = await mcpPost(
    new Request("http://localhost/api/cursor/mcp", {
      method: "POST",
      headers: headers(operator, key),
      body: JSON.stringify({ jsonrpc: "2.0", id: rpcId, method: "tools/call", params: { name: tool, arguments: args } }),
    })
  );
  expect(res.status).toBe(200);
  const json = (await res.json()) as { result: { content: { text: string }[]; isError?: boolean } };
  const text = json.result.content[0].text;
  const body = JSON.parse(text) as Body;
  return { ok: json.result.isError !== true, status: null, body, text };
}

async function viaRest(
  tool: string,
  args: Record<string, unknown>,
  operator: string,
  key: string = SHARED_KEY
): Promise<Outcome> {
  const route = tool === "mc_release_checkouts" ? releaseBatchRoute : releaseRoute;
  const path = tool === "mc_release_checkouts" ? "release-batch" : "release";
  const res = await route(
    new Request(`http://localhost/api/cursor/checkouts/${path}`, {
      method: "POST",
      headers: headers(operator, key),
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
const refusedEvents = () => h.events.filter((e) => e.kind === "checkout.release_refused");

beforeEach(() => {
  vi.stubEnv("PLX_MC_MCP_ENABLED", "1");
  vi.stubEnv("PLX_MC_MCP_API_KEY", "test-mcp-key");
  vi.stubEnv(
    "PLX_MC_MCP_AGENT_KEYS",
    JSON.stringify({ sp_mcp_cos: COS_KEY, sp_mcp_ledger: LEDGER_KEY, sp_mcp_claude_code: CLAUDE_KEY })
  );
  vi.stubEnv(
    "PLX_MC_ALLOWED_USERS",
    "vince@petrasoap.com,ross@petrasoap.com,stephen@petrasoap.com,cos@petrasoap.com"
  );
  vi.stubEnv("PLX_MC_PUBLIC_URL", "https://mc.plxcustomer.io");
  // These cases pin the post-cutover rule; the shadow default has its own block below.
  vi.stubEnv("PLX_MC_MCP_PRINCIPAL_AUTHZ", "enforce");
  h.dispatches.clear();
  h.events.length = 0;
  h.prs.length = 0;
  h.githubDown = false;
  workerHeader = "release-test";
  h.patchTask.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("authorizeCheckoutRelease", () => {
  it("allows the principal that checked the lease out and the Ledger/CoS steward principals", () => {
    expect(authorizeCheckoutRelease("sp_mcp_claude_code", "sp_mcp_claude_code")).toEqual({
      allowed: true,
      reasonCode: "checkout_principal",
    });
    for (const steward of ["sp_mcp_cos", "sp_mcp_ledger"]) {
      expect(authorizeCheckoutRelease(steward, "sp_mcp_claude_code")).toEqual({ allowed: true, reasonCode: "steward" });
      expect(authorizeCheckoutRelease(steward, null)).toEqual({ allowed: true, reasonCode: "steward" });
    }
  });

  it("denies every other principal, and email strings, with not_accountable", () => {
    expect(authorizeCheckoutRelease("sp_mcp_cursor", "sp_mcp_claude_code")).toEqual({
      allowed: false,
      reasonCode: "not_accountable",
    });
    // A lease with no recorded principal is steward-only.
    expect(authorizeCheckoutRelease("sp_mcp_cursor", null).allowed).toBe(false);
    expect(authorizeCheckoutRelease("cos@petrasoap.com", "sp_mcp_claude_code").allowed).toBe(false);
    expect(authorizeCheckoutRelease("", null).allowed).toBe(false);
  });
});

describe("isExpiredReason", () => {
  it("matches reasons that claim the lease expired, and nothing else", () => {
    for (const reason of ["expired", "Expired", "lease expired", "expired, never released", "TTL expiry"]) {
      expect({ reason, hit: isExpiredReason(reason) }).toEqual({ reason, hit: true });
    }
    for (const reason of ["stray from a stopped run", "duplicate", "superseded by TASK-9", "expiresAt drift"]) {
      expect({ reason, hit: isExpiredReason(reason) }).toEqual({ reason, hit: false });
    }
  });
});

describe("tool registration", () => {
  it("lists both tools on the HTTP MCP server", async () => {
    const res = await mcpPost(
      new Request("http://localhost/api/cursor/mcp", {
        method: "POST",
        headers: headers("vince@petrasoap.com", SHARED_KEY),
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
    it.each(["branch push only", "Completed: BRANCH PUSH ONLY; no PR", "branch-push-only"])(
      "flags %s and keeps the lease active", async (reason) => {
        seed("dsp_abcdefgh1234", "TASK-2279");
        const out = await call("mc_release_checkout", { checkoutId: "dsp_abcdefgh1234", reason }, "ross@petrasoap.com");
        expect(out.ok).toBe(false);
        expect(out.body.error).toMatchObject({ code: "branch_push_only" });
        expect(h.dispatches.get("dsp_abcdefgh1234")).toMatchObject({ releasedAt: null, releasedReason: null });
        expect(h.events).toContainEqual(expect.objectContaining({
          kind: "checkout.release_refused", taskId: "TASK-2279",
          payload: expect.objectContaining({ code: "branch_push_only", checkoutRef: "dsp_…1234", reason }),
        }));
        expect(releasedEvents()).toHaveLength(0);
        expect(h.patchTask).not.toHaveBeenCalled();
      }
    );

    it("lets the checkout's own principal release by full id and audits checkout.released", async () => {
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
        authz: "checkout_principal",
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
            reasonCode: "checkout_principal",
            servicePrincipalId: "sp_mcp_cursor",
            wasExpired: false,
          }),
        },
      ]);
      expect(recordPermissionDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          site: "mcp.release-checkout",
          allowed: true,
          reasonCode: "checkout_principal",
        })
      );
      // Only the lease changes: the task stage and Verified are never written.
      expect(h.patchTask).not.toHaveBeenCalled();
    });

    it("forbids another principal's lease and audits the reasonCode", async () => {
      seed("dsp_abcdefgh1234", "TASK-2279", { checkoutPrincipal: "sp_mcp_claude_code" });
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

    it("refuses an 'expired' release while an open PR carries the stamp (TASK-2965)", async () => {
      seed("dsp_portalxx0326", "TASK-2897", { expiresAt: PAST });
      h.prs.push({ number: 326, taskId: "TASK-2897", open: true, checkoutIds: ["dsp_portalxx0326"] });
      const out = await call(
        "mc_release_checkout",
        { checkoutId: "dsp_portalxx0326", reason: "expired" },
        "cos@petrasoap.com"
      );
      expect(out.ok).toBe(false);
      if (out.status !== null) expect(out.status).toBe(409);
      expect(out.body.error).toMatchObject({ code: "open_pr_expiry_exception" });
      expect(out.body.error.message).toContain("#326");
      expect(out.text).not.toContain("dsp_portalxx0326");
      expect(h.dispatches.get("dsp_portalxx0326")).toMatchObject({ releasedAt: null, releasedReason: null });
      expect(releasedEvents()).toEqual([]);
      expect(refusedEvents()).toEqual([
        expect.objectContaining({
          actor: "claude-code:cos@petrasoap.com",
          taskId: "TASK-2897",
          pr: "326",
          payload: expect.objectContaining({
            checkoutRef: "dsp_…0326",
            code: "open_pr_expiry_exception",
            servicePrincipalId: "sp_mcp_cursor",
            workerId: "release-test",
          }),
        }),
      ]);
    });

    it("still releases with an open PR when the reason is not 'expired'", async () => {
      seed("dsp_portalxx0326", "TASK-2897", { expiresAt: PAST });
      h.prs.push({ number: 326, taskId: "TASK-2897", open: true, checkoutIds: ["dsp_portalxx0326"] });
      const out = await call(
        "mc_release_checkout",
        { checkoutId: "dsp_portalxx0326", reason: "stray from a stopped run" },
        "cos@petrasoap.com"
      );
      expect(out.ok).toBe(true);
      expect(releasedEvents()).toHaveLength(1);
      expect(refusedEvents()).toEqual([]);
    });

    it("releases as 'expired' when no open PR carries this stamp", async () => {
      seed("dsp_portalxx0326", "TASK-2897", { expiresAt: PAST });
      // A closed PR with the stamp, and an open PR stamped with another checkout.
      h.prs.push({ number: 300, taskId: "TASK-2897", open: false, checkoutIds: ["dsp_portalxx0326"] });
      h.prs.push({ number: 326, taskId: "TASK-2897", open: true, checkoutIds: ["dsp_portalnew9999"] });
      const out = await call(
        "mc_release_checkout",
        { checkoutId: "dsp_portalxx0326", reason: "expired" },
        "cos@petrasoap.com"
      );
      expect(out.ok).toBe(true);
      expect(h.dispatches.get("dsp_portalxx0326")?.releasedReason).toBe("manual: expired");
    });

    it("fails closed on an 'expired' release when GitHub cannot be read", async () => {
      seed("dsp_portalxx0326", "TASK-2897", { expiresAt: PAST });
      h.prs.push({ number: 326, taskId: "TASK-2897", open: true, checkoutIds: ["dsp_portalxx0326"] });
      h.githubDown = true;
      const out = await call(
        "mc_release_checkout",
        { checkoutId: "dsp_portalxx0326", reason: "expired" },
        "cos@petrasoap.com"
      );
      expect(out.ok).toBe(false);
      if (out.status !== null) expect(out.status).toBe(503);
      expect(out.body.error).toMatchObject({ code: "open_pr_check_unavailable" });
      expect(h.dispatches.get("dsp_portalxx0326")?.releasedAt).toBeNull();
      expect(releasedEvents()).toEqual([]);
    });

    it("records the caller's worker id on checkout.released", async () => {
      seed("dsp_aaaaaaaa0001", "TASK-1");
      await call("mc_release_checkout", { checkoutId: "dsp_aaaaaaaa0001", reason: "stray" }, "ross@petrasoap.com");
      expect(releasedEvents()[0].payload).toMatchObject({ workerId: "release-test" });
    });

    it("records unknown-worker when the worker id header is missing, and still releases", async () => {
      workerHeader = null;
      seed("dsp_aaaaaaaa0001", "TASK-1");
      const out = await call("mc_release_checkout", { checkoutId: "dsp_aaaaaaaa0001", reason: "stray" }, "ross@petrasoap.com");
      expect(out.ok).toBe(true);
      expect(releasedEvents()[0].payload).toMatchObject({ workerId: "unknown-worker" });
    });

    it("hides a lease on a restricted-project task", async () => {
      seed("dsp_secretxx0001", "TASK-SECRET");
      const out = await call("mc_release_checkout", { checkoutId: "dsp_secretxx0001", reason: "x" }, "vince@petrasoap.com");
      expect(out.ok).toBe(false);
      expect(h.dispatches.get("dsp_secretxx0001")?.releasedAt).toBeNull();
      expect(h.events).toEqual([]);
    });
  });

  describe(`operator email grants nothing over ${transport} (TASK-3008)`, () => {
    it.each([
      ["the owner", "vince@petrasoap.com"],
      ["the default agent operator cos@", "cos@petrasoap.com"],
      ["the lease's accountable human", "ross@petrasoap.com"],
    ])("refuses the shared key with the header set to %s", async (_label, operator) => {
      seed("dsp_otheragnt0001", "TASK-1", { checkoutPrincipal: "sp_mcp_claude_code" });
      const out = await call("mc_release_checkout", { checkoutId: "dsp_otheragnt0001", reason: "x" }, operator);
      expect(out.ok).toBe(false);
      if (out.status !== null) expect(out.status).toBe(403);
      expect(out.body.error.message).toContain("not_accountable");
      expect(h.dispatches.get("dsp_otheragnt0001")?.releasedAt).toBeNull();
      expect(releasedEvents()).toEqual([]);
    });

    it("lets the principal that checked the lease out release it, whatever the header", async () => {
      seed("dsp_claudeown0001", "TASK-1", { checkoutPrincipal: "sp_mcp_claude_code" });
      const out = await call(
        "mc_release_checkout",
        { checkoutId: "dsp_claudeown0001", reason: "x" },
        "stephen@petrasoap.com",
        CLAUDE_KEY
      );
      expect(out.ok).toBe(true);
      expect(out.body.data.authz).toBe("checkout_principal");
      expect(releasedEvents()[0]).toMatchObject({
        actor: "claude-code:stephen@petrasoap.com",
        payload: expect.objectContaining({ servicePrincipalId: "sp_mcp_claude_code" }),
      });
    });

    it("lets the steward principals sp_mcp_cos and sp_mcp_ledger release any lease", async () => {
      seed("dsp_stewardxx0001", "TASK-1");
      seed("dsp_stewardxx0002", "TASK-1", { checkoutPrincipal: null });
      const cos = await call("mc_release_checkout", { checkoutId: "dsp_stewardxx0001", reason: "x" }, "stephen@petrasoap.com", COS_KEY);
      const ledger = await call("mc_release_checkout", { checkoutId: "dsp_stewardxx0002", reason: "x" }, "stephen@petrasoap.com", LEDGER_KEY);
      expect(cos.body.data.authz).toBe("steward");
      expect(ledger.body.data.authz).toBe("steward");
    });

    it("hides a restricted-project lease when the header names a member", async () => {
      seed("dsp_rossprojx0001", "TASK-ROSS", { checkoutPrincipal: "sp_mcp_cursor" });
      const out = await call("mc_release_checkout", { checkoutId: "dsp_rossprojx0001", reason: "x" }, "ross@petrasoap.com");
      expect(out.ok).toBe(false);
      expect(h.dispatches.get("dsp_rossprojx0001")?.releasedAt).toBeNull();
      expect(h.events).toEqual([]);
    });

    it("admits a restricted-project lease when the service principal is a member", async () => {
      seed("dsp_claudeprj0001", "TASK-CLAUDE", { checkoutPrincipal: "sp_mcp_claude_code" });
      const out = await call("mc_release_checkout", { checkoutId: "dsp_claudeprj0001", reason: "x" }, "stephen@petrasoap.com", CLAUDE_KEY);
      expect(out.ok).toBe(true);
    });
  });

  describe(`mc_release_checkouts over ${transport}`, () => {
    it("reports branch push only in refused[] while releasing unrelated items", async () => {
      seed("dsp_abcdefgh1234", "TASK-2279");
      seed("dsp_abcdefgh5678", "TASK-2280");
      const out = await call("mc_release_checkouts", { items: [
        { checkoutId: "dsp_abcdefgh1234", reason: "branch push only" },
        { checkoutId: "dsp_abcdefgh5678", reason: "stray from a stopped run" },
      ] }, "ross@petrasoap.com");
      expect(out.body.data).toMatchObject({ released: 1, failed: 1, refused: [
        { index: 0, checkoutRef: "dsp_…1234", taskId: "TASK-2279", code: "branch_push_only" },
      ] });
      expect(h.dispatches.get("dsp_abcdefgh1234")?.releasedAt).toBeNull();
      expect(releasedEvents()).toHaveLength(1);
    });

    it("returns a per-item outcome and keeps going past a failed item", async () => {
      seed("dsp_cursorxxbn4y", "TASK-2279");
      seed("dsp_claudexx7px3", "TASK-2279");
      seed("dsp_notminexx0001", "TASK-1", { checkoutPrincipal: "sp_mcp_claude_code" });
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
      expect(out.body.data.refused).toEqual([
        {
          index: 1,
          checkoutRef: "dsp_…0001",
          taskId: "TASK-1",
          code: "forbidden",
          reason: expect.stringContaining("not_accountable"),
        },
        {
          index: 3,
          checkoutRef: "dsp_…7px3",
          taskId: "TASK-2279",
          code: "already_released",
          reason: expect.stringContaining("already released"),
        },
      ]);
      expect(releasedEvents()).toHaveLength(2);
      expect(deniedEvents()).toHaveLength(1);
      expect(h.patchTask).not.toHaveBeenCalled();
    });

    it("refuses 'expired' items held by an open PR and releases the rest (TASK-2965)", async () => {
      // The 2026-10-14 incident shape: a steward bulk-releases leases as expired.
      seed("dsp_portalxx0326", "TASK-2897", { expiresAt: PAST });
      seed("dsp_portalxx0327", "TASK-2935", { expiresAt: PAST });
      seed("dsp_staleexx0001", "TASK-2001", { expiresAt: PAST });
      seed("dsp_strayxxx0002", "TASK-2002", { expiresAt: PAST });
      h.prs.push({ number: 326, taskId: "TASK-2897", open: true, checkoutIds: ["dsp_portalxx0326"] });
      h.prs.push({ number: 327, taskId: "TASK-2935", open: true, checkoutIds: ["dsp_portalxx0327"] });
      h.prs.push({ number: 200, taskId: "TASK-2001", open: false, checkoutIds: ["dsp_staleexx0001"] });
      h.prs.push({ number: 201, taskId: "TASK-2002", open: true, checkoutIds: ["dsp_strayxxx0002"] });
      const out = await call(
        "mc_release_checkouts",
        {
          items: [
            { checkoutId: "dsp_portalxx0326", reason: "expired" },
            { checkoutId: "dsp_staleexx0001", reason: "expired" },
            { checkoutRef: "dsp_…0327", taskId: "TASK-2935", reason: "expired" },
            { checkoutId: "dsp_strayxxx0002", reason: "stray from a stopped run" },
            { checkoutId: "dsp_nosuchlease", reason: "expired" },
          ],
        },
        "cos@petrasoap.com"
      );
      expect(out.ok).toBe(true);
      expect(out.body.data).toMatchObject({ released: 2, failed: 3 });
      expect(out.body.data.results).toEqual([
        { index: 0, ok: false, error: expect.objectContaining({ code: "open_pr_expiry_exception" }) },
        { index: 1, ok: true, data: expect.objectContaining({ checkoutRef: "dsp_…0001" }) },
        { index: 2, ok: false, error: expect.objectContaining({ code: "open_pr_expiry_exception" }) },
        { index: 3, ok: true, data: expect.objectContaining({ checkoutRef: "dsp_…0002" }) },
        { index: 4, ok: false, error: expect.objectContaining({ code: "not_found" }) },
      ]);
      expect(out.body.data.refused).toEqual([
        {
          index: 0,
          checkoutRef: "dsp_…0326",
          taskId: "TASK-2897",
          code: "open_pr_expiry_exception",
          reason: expect.stringContaining("#326"),
        },
        {
          index: 2,
          checkoutRef: "dsp_…0327",
          taskId: "TASK-2935",
          code: "open_pr_expiry_exception",
          reason: expect.stringContaining("#327"),
        },
        { index: 4, checkoutRef: null, taskId: null, code: "not_found", reason: "Unknown checkout." },
      ]);
      expect(out.text).not.toMatch(/dsp_portalxx|dsp_staleexx|dsp_strayxxx/);
      expect(h.dispatches.get("dsp_portalxx0326")?.releasedAt).toBeNull();
      expect(h.dispatches.get("dsp_portalxx0327")?.releasedAt).toBeNull();
      expect(releasedEvents().map((e) => e.payload.checkoutRef)).toEqual(["dsp_…0001", "dsp_…0002"]);
      expect(releasedEvents().every((e) => e.payload.workerId === "release-test")).toBe(true);
      expect(refusedEvents()).toHaveLength(2);
    });
  });
}

// TASK-3008 shadow rollout: until PLX_MC_MCP_PRINCIPAL_AUTHZ=enforce, the
// operator-email rule still decides so agents on the shared key keep working,
// and every disagreement with the principal rule is logged.
describe("shadow rollout (PLX_MC_MCP_PRINCIPAL_AUTHZ unset)", () => {
  beforeEach(() => {
    vi.stubEnv("PLX_MC_MCP_PRINCIPAL_AUTHZ", "");
  });

  const mismatches = () => h.events.filter((e) => e.kind === "authz.shadow_mismatch");

  it("keeps the operator rule: the cos@ operator may still release another principal's lease, and the disagreement is logged", async () => {
    seed("dsp_shadowcos1", "TASK-OPEN", { checkoutPrincipal: "sp_mcp_claude_code" });
    const out = await viaRest("mc_release_checkout", { checkoutId: "dsp_shadowcos1", reason: "stray lease" }, "cos@petrasoap.com");
    expect(out.ok).toBe(true);
    expect(h.dispatches.get("dsp_shadowcos1")?.releasedAt).not.toBeNull();
    expect(mismatches()).toHaveLength(1);
    expect(mismatches()[0].payload).toMatchObject({
      site: "mcp.release-checkout",
      mode: "shadow",
      operatorAllowed: true,
      operatorReasonCode: "steward",
      principalAllowed: false,
      principalReasonCode: "not_accountable",
    });
  });

  it("keeps the operator rule's refusal, and logs it when the principal rule would allow", async () => {
    seed("dsp_shadowown1", "TASK-OPEN");
    const out = await viaRest("mc_release_checkout", { checkoutId: "dsp_shadowown1", reason: "stray lease" }, "stephen@petrasoap.com");
    expect(out.ok).toBe(false);
    expect(out.status).toBe(403);
    expect(h.dispatches.get("dsp_shadowown1")?.releasedAt).toBeNull();
    expect(mismatches()[0].payload).toMatchObject({ operatorAllowed: false, principalAllowed: true });
  });

  it("logs nothing when both rules agree", async () => {
    seed("dsp_shadowagr1", "TASK-OPEN");
    const out = await viaRest("mc_release_checkout", { checkoutId: "dsp_shadowagr1", reason: "stray lease" }, "ross@petrasoap.com");
    expect(out.ok).toBe(true);
    expect(mismatches()).toHaveLength(0);
  });

  it("keeps restricted-project access by operator email, and logs that the principal alone would be refused", async () => {
    seed("dsp_shadowacl1", "TASK-ROSS");
    const out = await viaRest("mc_release_checkout", { checkoutId: "dsp_shadowacl1", reason: "stray lease" }, "ross@petrasoap.com");
    expect(out.ok).toBe(true);
    expect(mismatches().map((e) => e.payload.site)).toContain("permissions.project-acl");
    expect(mismatches().find((e) => e.payload.site === "permissions.project-acl")?.payload).toMatchObject({
      projectId: "PRJ-ROSS",
      operatorAllowed: true,
      principalAllowed: false,
    });
  });

  // TASK-3026: the principal lookup only feeds the shadow comparison here.
  it("still releases when the checkout-principal lookup throws, comparing as an unknown principal", async () => {
    seed("dsp_shadowerr1", "TASK-OPEN");
    vi.mocked(complianceRepo.getDispatchCheckoutPrincipal).mockRejectedValueOnce(new Error("connection terminated"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const out = await viaRest("mc_release_checkout", { checkoutId: "dsp_shadowerr1", reason: "stray lease" }, "ross@petrasoap.com");
    expect(out.ok).toBe(true);
    expect(out.body.data.authz).toBe("accountable_human");
    expect(h.dispatches.get("dsp_shadowerr1")?.releasedAt).not.toBeNull();
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
    expect(mismatches()).toHaveLength(1);
    expect(mismatches()[0].payload).toMatchObject({
      site: "mcp.release-checkout",
      operatorAllowed: true,
      principalAllowed: false,
      principalLookupFailed: true,
    });
  });

  it("under enforce a failed lookup still fails the release closed", async () => {
    vi.stubEnv("PLX_MC_MCP_PRINCIPAL_AUTHZ", "enforce");
    seed("dsp_enforceerr1", "TASK-OPEN");
    vi.mocked(complianceRepo.getDispatchCheckoutPrincipal).mockRejectedValueOnce(new Error("connection terminated"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const out = await viaRest("mc_release_checkout", { checkoutId: "dsp_enforceerr1", reason: "stray lease" }, "ross@petrasoap.com");
    errors.mockRestore();
    expect(out.ok).toBe(false);
    expect(h.dispatches.get("dsp_enforceerr1")?.releasedAt).toBeNull();
  });

  it("authorizeCheckoutReleaseByOperator is the pre-TASK-3008 rule", () => {
    expect(authorizeCheckoutReleaseByOperator("ross@petrasoap.com", { accountableHuman: "ross@petrasoap.com" })).toEqual({
      allowed: true,
      reasonCode: "accountable_human",
    });
    expect(authorizeCheckoutReleaseByOperator("cos@petrasoap.com", { accountableHuman: "ross@petrasoap.com" })).toEqual({
      allowed: true,
      reasonCode: "steward",
    });
    expect(authorizeCheckoutReleaseByOperator("jesse@petrasoap.com", { accountableHuman: "ross@petrasoap.com" })).toEqual({
      allowed: false,
      reasonCode: "not_accountable",
    });
  });
});
