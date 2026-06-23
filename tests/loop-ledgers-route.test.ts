// Route tests for GET /api/loop-ledgers and GET /api/loop-ledgers/[ref].
// Stubs node:fs and @/lib/loop-ledgers — no filesystem or network calls.
// Covers: envelope contract, degraded-source passthrough, read-only contract,
// detail route happy path and degraded path.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Hoisted mocks (must precede all imports) ─────────────────────────────────

const m = vi.hoisted(() => ({
  readFileSync: vi.fn<() => string>(),
  listLedgerSummaries: vi.fn(),
  getLedgerDetail: vi.fn(),
  createSource: vi.fn(),
  parseRegistryJson: vi.fn(),
}));

vi.mock("node:fs", () => ({ readFileSync: m.readFileSync }));

vi.mock("@/lib/loop-ledgers", () => ({
  createSource: m.createSource,
  listLedgerSummaries: m.listLedgerSummaries,
  getLedgerDetail: m.getLedgerDetail,
  parseRegistryJson: m.parseRegistryJson,
}));

// ─── Imports (resolved after mocks) ──────────────────────────────────────────

import * as listRouteModule from "@/app/api/loop-ledgers/route";
import * as detailRouteModule from "@/app/api/loop-ledgers/[ref]/route";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const REGISTRY_JSON = JSON.stringify({
  schema_version: "plx-loop-ledger-registry/v1",
  freshness: { warn_after_days: 7, stale_after_days: 30 },
  repos: [
    {
      repo: "taylorvalton/agentic-swarm",
      display_name: "Agentic Swarm",
      default_branch: "main",
      ledger_glob: "docs/vmc/quality-ledger/*.artifacts.json",
    },
  ],
});

const MOCK_REGISTRY = {
  schema_version: "plx-loop-ledger-registry/v1" as const,
  freshness: { warn_after_days: 7, stale_after_days: 30 },
  repos: [
    {
      repo: "taylorvalton/agentic-swarm",
      display_name: "Agentic Swarm",
      default_branch: "main",
      ledger_glob: "docs/vmc/quality-ledger/*.artifacts.json",
    },
  ],
};

const MOCK_LEDGER_ROW = {
  kind: "ledger" as const,
  ref: {
    repo: "taylorvalton/agentic-swarm",
    branch: "main",
    path: "docs/vmc/quality-ledger/loop-ledgers.artifacts.json",
  },
  repo: "taylorvalton/agentic-swarm",
  repoDisplayName: "Agentic Swarm",
  validationResult: {
    valid: true,
    healthCode: "valid" as const,
    ledger: null,
    errors: [],
    freshnessInfo: { level: "fresh" as const, ageDays: 1, reason: "fresh" },
  },
};

const MOCK_DEGRADED_ROW = {
  kind: "degraded-source" as const,
  repo: "taylorvalton/plx-customer-portal",
  repoDisplayName: "PLX Customer Portal",
  reason: "permission_denied" as const,
  note: "HTTP 403 — private repo, no access.",
};

/** Encode a LedgerRef as base64url for use in the [ref] route param. */
function encodeRef(ref: { repo: string; branch: string; path: string }): string {
  return Buffer.from(JSON.stringify(ref)).toString("base64url");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const emptyCtx = { params: Promise.resolve({} as Record<string, string>) };
const getReq = (url = "http://test/api/loop-ledgers") =>
  new Request(url, { method: "GET" });

function detailCtx(ref: { repo: string; branch: string; path: string }) {
  return { params: Promise.resolve({ ref: encodeRef(ref) }) };
}

// ─── Default mock setup ───────────────────────────────────────────────────────

beforeEach(() => {
  m.readFileSync.mockReturnValue(REGISTRY_JSON);
  m.parseRegistryJson.mockReturnValue({ ok: true, config: MOCK_REGISTRY });
  m.createSource.mockReturnValue({});
  m.listLedgerSummaries.mockResolvedValue([MOCK_LEDGER_ROW]);
  m.getLedgerDetail.mockResolvedValue({
    ok: true,
    ref: MOCK_LEDGER_ROW.ref,
    repo: MOCK_LEDGER_ROW.repo,
    repoDisplayName: MOCK_LEDGER_ROW.repoDisplayName,
    validationResult: MOCK_LEDGER_ROW.validationResult,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/loop-ledgers — list
// ═════════════════════════════════════════════════════════════════════════════

describe("GET /api/loop-ledgers — list", () => {
  it("returns { data } envelope with an array of summary rows", async () => {
    const resp = await listRouteModule.GET(getReq(), emptyCtx);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body).toHaveProperty("data");
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("includes ledger rows in the data array", async () => {
    const resp = await listRouteModule.GET(getReq(), emptyCtx);
    const { data } = await resp.json();
    expect(data).toHaveLength(1);
    expect(data[0].kind).toBe("ledger");
  });

  it("degraded source rows appear in the payload — never filtered out", async () => {
    m.listLedgerSummaries.mockResolvedValue([MOCK_LEDGER_ROW, MOCK_DEGRADED_ROW]);
    const resp = await listRouteModule.GET(getReq(), emptyCtx);
    const { data } = await resp.json();
    expect(data).toHaveLength(2);
    const degraded = data.find(
      (r: { kind: string }) => r.kind === "degraded-source"
    );
    expect(degraded).toBeDefined();
    expect(degraded.reason).toBe("permission_denied");
    expect(degraded.repo).toBe("taylorvalton/plx-customer-portal");
  });

  it("a list of only degraded rows is still returned in { data }", async () => {
    m.listLedgerSummaries.mockResolvedValue([MOCK_DEGRADED_ROW]);
    const resp = await listRouteModule.GET(getReq(), emptyCtx);
    expect(resp.status).toBe(200);
    const { data } = await resp.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data[0].kind).toBe("degraded-source");
  });

  it("returns 500 error envelope when registry JSON is invalid", async () => {
    m.parseRegistryJson.mockReturnValue({ ok: false, error: "bad schema" });
    const resp = await listRouteModule.GET(getReq(), emptyCtx);
    expect(resp.status).toBe(500);
    const body = await resp.json();
    expect(body.error.code).toBe("invalid_registry");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/loop-ledgers/[ref] — detail
// ═════════════════════════════════════════════════════════════════════════════

describe("GET /api/loop-ledgers/[ref] — detail", () => {
  const ref = MOCK_LEDGER_ROW.ref;

  it("returns { data } envelope for a known valid ledger", async () => {
    const resp = await detailRouteModule.GET(
      getReq(`http://test/api/loop-ledgers/${encodeRef(ref)}`),
      detailCtx(ref)
    );
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body).toHaveProperty("data");
    expect(body.data.ok).toBe(true);
    expect(body.data.repo).toBe(ref.repo);
  });

  it("returns visible degraded payload in { data } for an unreachable ledger", async () => {
    m.getLedgerDetail.mockResolvedValue({
      ok: false,
      ref,
      repo: ref.repo,
      repoDisplayName: "Agentic Swarm",
      reason: "not_found",
      note: "HTTP 404 — repo or branch does not exist.",
    });
    const resp = await detailRouteModule.GET(
      getReq(`http://test/api/loop-ledgers/${encodeRef(ref)}`),
      detailCtx(ref)
    );
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body).toHaveProperty("data");
    expect(body.data.ok).toBe(false);
    expect(body.data.reason).toBe("not_found");
  });

  it("returns 400 error envelope for a malformed ref param", async () => {
    const badCtx = {
      params: Promise.resolve({ ref: "!!!not-base64url!!!" }),
    };
    const resp = await detailRouteModule.GET(
      getReq("http://test/api/loop-ledgers/bad"),
      badCtx
    );
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error.code).toBe("invalid_ref");
  });

  it("returns 400 error envelope for a ref missing required fields", async () => {
    const missingPath = Buffer.from(
      JSON.stringify({ repo: "foo/bar", branch: "main" })
    ).toString("base64url");
    const badCtx = { params: Promise.resolve({ ref: missingPath }) };
    const resp = await detailRouteModule.GET(
      getReq("http://test/api/loop-ledgers/bad"),
      badCtx
    );
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error.code).toBe("invalid_ref");
  });

  it("returns 500 error envelope when registry JSON is invalid", async () => {
    m.parseRegistryJson.mockReturnValue({ ok: false, error: "bad schema" });
    const resp = await detailRouteModule.GET(
      getReq(`http://test/api/loop-ledgers/${encodeRef(ref)}`),
      detailCtx(ref)
    );
    expect(resp.status).toBe(500);
    const body = await resp.json();
    expect(body.error.code).toBe("invalid_registry");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// N1 regression — off-registry refs produce degraded { data } response (not 4xx)
// The allowlist enforcement is in the loader; the route must surface the result.
// ═════════════════════════════════════════════════════════════════════════════

describe("GET /api/loop-ledgers/[ref] — N1 regression: off-registry ref", () => {
  it("returns 200 with degraded not_found payload for a ref whose repo is not in the registry", async () => {
    const offRegistryRef = { repo: "attacker/evil-repo", branch: "main", path: "docs/evil.json" };
    m.getLedgerDetail.mockResolvedValue({
      ok: false,
      ref: offRegistryRef,
      repo: offRegistryRef.repo,
      repoDisplayName: offRegistryRef.repo,
      reason: "not_found",
      note: 'repo "attacker/evil-repo" is not in the registry',
    });

    const resp = await detailRouteModule.GET(
      getReq(`http://test/api/loop-ledgers/${encodeRef(offRegistryRef)}`),
      detailCtx(offRegistryRef)
    );

    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body).toHaveProperty("data");
    expect(body.data.ok).toBe(false);
    expect(body.data.reason).toBe("not_found");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Read-only contract — only GET exported from each route module
// ═════════════════════════════════════════════════════════════════════════════

describe("read-only contract", () => {
  it("list route exports GET and NOT POST/PUT/PATCH/DELETE", () => {
    expect(typeof listRouteModule.GET).toBe("function");
    expect((listRouteModule as Record<string, unknown>).POST).toBeUndefined();
    expect((listRouteModule as Record<string, unknown>).PUT).toBeUndefined();
    expect((listRouteModule as Record<string, unknown>).PATCH).toBeUndefined();
    expect((listRouteModule as Record<string, unknown>).DELETE).toBeUndefined();
  });

  it("detail route exports GET and NOT POST/PUT/PATCH/DELETE", () => {
    expect(typeof detailRouteModule.GET).toBe("function");
    expect((detailRouteModule as Record<string, unknown>).POST).toBeUndefined();
    expect((detailRouteModule as Record<string, unknown>).PUT).toBeUndefined();
    expect((detailRouteModule as Record<string, unknown>).PATCH).toBeUndefined();
    expect((detailRouteModule as Record<string, unknown>).DELETE).toBeUndefined();
  });
});
