// Contract tests for the loop-ledgers P2 source adapters and loader.
// Stubs global fetch — no real network calls.
// Covers: github-api adapter failure modes, local-fs safety, and the loader's
// batch-survivability invariant (one repo failing must NOT kill the batch).

import { readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GithubApiSource } from "@/lib/loop-ledgers/sources/github-api";
import { LocalFsSource } from "@/lib/loop-ledgers/sources/local-fs";
import { getLedgerDetail, listLedgerSummaries } from "@/lib/loop-ledgers/loader";
import type { RegistryConfig } from "@/lib/loop-ledgers/types";

// node:fs/promises is mocked so LocalFsSource calls are intercepted.
// Must be at module level (vi.mock is hoisted regardless of position).
vi.mock("node:fs/promises");

// ─── Fixture helpers (use sync fs — not affected by the promises mock) ────────

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures/loop-ledgers");

function loadFixtureSync(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf-8");
}

// ─── Registry factory ─────────────────────────────────────────────────────────

function makeRegistry(repos?: RegistryConfig["repos"]): RegistryConfig {
  return {
    schema_version: "plx-loop-ledger-registry/v1",
    freshness: { warn_after_days: 7, stale_after_days: 30 },
    repos: repos ?? [
      {
        repo: "taylorvalton/agentic-swarm",
        display_name: "Agentic Swarm",
        default_branch: "main",
        ledger_glob: "docs/vmc/quality-ledger/*.artifacts.json",
      },
    ],
  };
}

// ─── Fetch mock helpers ───────────────────────────────────────────────────────

function mockResponse(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function setupFetchFn(fn: (url: string) => Response): void {
  vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(fn(url))));
}

function setupFetchThrow(message: string): void {
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error(message))));
}

// ─── Environment helpers ──────────────────────────────────────────────────────

function setToken(token: string | undefined): void {
  if (token === undefined) {
    delete process.env.GITHUB_TOKEN;
  } else {
    process.env.GITHUB_TOKEN = token;
  }
}

// Hermetic GitHub auth: these tests exercise the GITHUB_TOKEN path, but
// resolveGithubToken() prefers a GitHub App installation token when the
// GITHUB_APP_* env is present. On a box where the App is provisioned that env
// would hijack the fetch stubs (a real token mint), so neutralize it per test
// and restore afterwards.
const APP_KEYS = [
  "GITHUB_APP_ID",
  "GITHUB_APP_INSTALLATION_ID",
  "GITHUB_APP_INSTALLATION_ID_PLX",
  "GITHUB_APP_PRIVATE_KEY",
] as const;
const savedAppEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of APP_KEYS) {
    savedAppEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of APP_KEYS) {
    if (savedAppEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedAppEnv[k];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ═════════════════════════════════════════════════════════════════════════════
// GithubApiSource adapter contract tests
// ═════════════════════════════════════════════════════════════════════════════

describe("GithubApiSource", () => {
  const TREE_SUCCESS = loadFixtureSync("tree-success.json");
  const LEDGER_VALID = loadFixtureSync("ledger-valid.json");
  const TREE_EMPTY = loadFixtureSync("tree-empty.json");

  afterEach(() => {
    setToken(undefined);
  });

  describe("listLedgers — success path", () => {
    it("discovers matching ledger files and returns their raw content", async () => {
      setToken("test-token");

      setupFetchFn((url) => {
        if (url.includes("/git/trees/")) return mockResponse(200, TREE_SUCCESS);
        return mockResponse(200, LEDGER_VALID);
      });

      const registry = makeRegistry();
      const source = new GithubApiSource();
      const results = await source.listLedgers(registry);

      expect(results).toHaveLength(1);
      const result = results[0];
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // tree-success.json has 2 *.artifacts.json files under the glob path
      expect(result.ledgers).toHaveLength(2);
      expect(result.ledgers[0].ref.repo).toBe("taylorvalton/agentic-swarm");
      expect(result.ledgers[0].ref.path).toBe("docs/vmc/quality-ledger/chat.artifacts.json");
      expect(result.ledgers[0].commitSha).toBe("abc123def456");
      expect(result.ledgers[0].raw).toContain("vmc-quality-ledger/v1");
    });

    it("includes the tree SHA as commitSha on discovered ledgers", async () => {
      setToken("test-token");

      setupFetchFn((url) => {
        if (url.includes("/git/trees/")) return mockResponse(200, TREE_SUCCESS);
        return mockResponse(200, LEDGER_VALID);
      });

      const results = await new GithubApiSource().listLedgers(makeRegistry());
      const result = results[0];
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.ledgers[0].commitSha).toBe("abc123def456");
    });
  });

  describe("listLedgers — repo not_found (404)", () => {
    it("returns ok=false with reason=not_found for a 404 tree response", async () => {
      setToken("test-token");
      setupFetchFn(() => mockResponse(404, JSON.stringify({ message: "Not Found" })));

      const results = await new GithubApiSource().listLedgers(makeRegistry());
      expect(results).toHaveLength(1);
      expect(results[0].ok).toBe(false);
      if (results[0].ok) return;
      expect(results[0].reason).toBe("not_found");
    });
  });

  describe("listLedgers — permission_denied (403, not rate limit)", () => {
    it("returns ok=false with reason=permission_denied for a 403 without rate-limit header", async () => {
      setToken("test-token");
      setupFetchFn(() => mockResponse(403, JSON.stringify({ message: "Must have push access" })));

      const results = await new GithubApiSource().listLedgers(makeRegistry());
      expect(results[0].ok).toBe(false);
      if (results[0].ok) return;
      expect(results[0].reason).toBe("permission_denied");
    });
  });

  describe("listLedgers — rate_limit", () => {
    it("returns ok=false with reason=rate_limit for a 403 with x-ratelimit-remaining=0", async () => {
      setToken("test-token");
      setupFetchFn(() =>
        mockResponse(
          403,
          JSON.stringify({ message: "API rate limit exceeded" }),
          { "x-ratelimit-remaining": "0" }
        )
      );

      const results = await new GithubApiSource().listLedgers(makeRegistry());
      expect(results[0].ok).toBe(false);
      if (results[0].ok) return;
      expect(results[0].reason).toBe("rate_limit");
    });

    it("returns ok=false with reason=rate_limit for a 429 response", async () => {
      setToken("test-token");
      setupFetchFn(() => mockResponse(429, JSON.stringify({ message: "Too Many Requests" })));

      const results = await new GithubApiSource().listLedgers(makeRegistry());
      expect(results[0].ok).toBe(false);
      if (results[0].ok) return;
      expect(results[0].reason).toBe("rate_limit");
    });
  });

  describe("listLedgers — no_ledgers (empty glob)", () => {
    it("returns ok=false with reason=no_ledgers when glob matches zero files", async () => {
      setToken("test-token");
      // tree-empty.json has no *.artifacts.json files under the glob path
      setupFetchFn(() => mockResponse(200, TREE_EMPTY));

      const results = await new GithubApiSource().listLedgers(makeRegistry());
      expect(results[0].ok).toBe(false);
      if (results[0].ok) return;
      expect(results[0].reason).toBe("no_ledgers");
    });
  });

  describe("listLedgers — network_error", () => {
    it("returns ok=false with reason=network_error when fetch throws", async () => {
      setToken("test-token");
      setupFetchThrow("ECONNREFUSED: connection refused");

      const results = await new GithubApiSource().listLedgers(makeRegistry());
      expect(results[0].ok).toBe(false);
      if (results[0].ok) return;
      expect(results[0].reason).toBe("network_error");
      expect(results[0].note).toContain("ECONNREFUSED");
    });
  });

  describe("listLedgers — token_missing", () => {
    it("returns ok=false with reason=token_missing when GITHUB_TOKEN is not set", async () => {
      setToken(undefined);

      const results = await new GithubApiSource().listLedgers(makeRegistry());
      expect(results[0].ok).toBe(false);
      if (results[0].ok) return;
      expect(results[0].reason).toBe("token_missing");
      expect(results[0].note).toContain("GITHUB_TOKEN");
    });
  });

  describe("getLedger", () => {
    it("returns ok=true with raw content when the file exists", async () => {
      setToken("test-token");
      setupFetchFn(() => mockResponse(200, LEDGER_VALID));

      const result = await new GithubApiSource().getLedger({
        repo: "taylorvalton/agentic-swarm",
        branch: "main",
        path: "docs/vmc/quality-ledger/chat.artifacts.json",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.raw).toContain("vmc-quality-ledger/v1");
    });

    it("returns ok=false with reason=not_found on 404", async () => {
      setToken("test-token");
      setupFetchFn(() => mockResponse(404, JSON.stringify({ message: "Not Found" })));

      const result = await new GithubApiSource().getLedger({
        repo: "taylorvalton/agentic-swarm",
        branch: "main",
        path: "docs/vmc/quality-ledger/missing.artifacts.json",
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("not_found");
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Loader — batch survivability invariant
// One repo failing must NOT kill the batch.
// ═════════════════════════════════════════════════════════════════════════════

describe("loader — batch survivability (one repo failing does NOT kill the batch)", () => {
  const TREE_SUCCESS = loadFixtureSync("tree-success.json");
  const LEDGER_VALID = loadFixtureSync("ledger-valid.json");
  const TREE_EMPTY = loadFixtureSync("tree-empty.json");

  afterEach(() => setToken(undefined));

  it("returns healthy repo rows + degraded row when one of three repos fails", async () => {
    setToken("test-token");

    const registry = makeRegistry([
      {
        repo: "taylorvalton/agentic-swarm",
        display_name: "Agentic Swarm",
        default_branch: "main",
        ledger_glob: "docs/vmc/quality-ledger/*.artifacts.json",
      },
      {
        repo: "taylorvalton/plx-mc",
        display_name: "PLX MC",
        default_branch: "main",
        ledger_glob: "docs/plx-mc/quality-ledger/*.artifacts.json",
      },
      {
        repo: "taylorvalton/plx-customer-portal",
        display_name: "PLX Portal",
        default_branch: "master",
        ledger_glob: "docs/portal/quality-ledger/*.artifacts.json",
      },
    ]);

    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("agentic-swarm")) {
        if (url.includes("/git/trees/")) return Promise.resolve(mockResponse(200, TREE_SUCCESS));
        return Promise.resolve(mockResponse(200, LEDGER_VALID));
      }
      if (url.includes("plx-mc")) {
        return Promise.resolve(mockResponse(404, JSON.stringify({ message: "Not Found" })));
      }
      // plx-customer-portal: tree exists but glob matches nothing
      return Promise.resolve(mockResponse(200, TREE_EMPTY));
    }));

    const rows = await listLedgerSummaries(registry, new GithubApiSource());

    const swarmRows = rows.filter((r) => r.repo === "taylorvalton/agentic-swarm");
    const mcRows = rows.filter((r) => r.repo === "taylorvalton/plx-mc");
    const portalRows = rows.filter((r) => r.repo === "taylorvalton/plx-customer-portal");

    // agentic-swarm: 2 ledger files → 2 ledger rows (valid)
    expect(swarmRows.length).toBe(2);
    expect(swarmRows.every((r) => r.kind === "ledger")).toBe(true);

    // plx-mc: degraded (not_found)
    expect(mcRows).toHaveLength(1);
    expect(mcRows[0].kind).toBe("degraded-source");
    if (mcRows[0].kind === "degraded-source") {
      expect(mcRows[0].reason).toBe("not_found");
    }

    // plx-customer-portal: degraded (no_ledgers)
    expect(portalRows).toHaveLength(1);
    expect(portalRows[0].kind).toBe("degraded-source");
    if (portalRows[0].kind === "degraded-source") {
      expect(portalRows[0].reason).toBe("no_ledgers");
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Loader — invalid_json and schema_mismatch files surface as degraded rows
// ═════════════════════════════════════════════════════════════════════════════

describe("loader — per-file validation surfaces degraded rows", () => {
  const LEDGER_SCHEMA_MISMATCH = loadFixtureSync("ledger-schema-mismatch.json");

  afterEach(() => setToken(undefined));

  it("produces a degraded row with reason=invalid_json for an unparseable file", async () => {
    setToken("test-token");

    // Single-file tree so only one fetch happens after the tree call
    const singleTree = {
      sha: "abc123def456",
      tree: [
        {
          path: "docs/vmc/quality-ledger/chat.artifacts.json",
          type: "blob",
          sha: "blobsha001",
        },
      ],
      truncated: false,
    };

    setupFetchFn((url) => {
      if (url.includes("/git/trees/")) return mockResponse(200, JSON.stringify(singleTree));
      return mockResponse(200, "{ this is not valid json ]]]");
    });

    const registry = makeRegistry();
    const rows = await listLedgerSummaries(registry, new GithubApiSource());

    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row.kind).toBe("degraded-source");
    if (row.kind === "degraded-source") {
      expect(row.reason).toBe("invalid_json");
    }
  });

  it("produces a ledger row with healthCode=schema_mismatch for a wrong schema_version", async () => {
    setToken("test-token");

    const singleTree = {
      sha: "abc123def456",
      tree: [
        {
          path: "docs/vmc/quality-ledger/chat.artifacts.json",
          type: "blob",
          sha: "blobsha001",
        },
      ],
      truncated: false,
    };

    setupFetchFn((url) => {
      if (url.includes("/git/trees/")) return mockResponse(200, JSON.stringify(singleTree));
      return mockResponse(200, LEDGER_SCHEMA_MISMATCH);
    });

    const registry = makeRegistry();
    const rows = await listLedgerSummaries(registry, new GithubApiSource());

    expect(rows).toHaveLength(1);
    const row = rows[0];
    // schema_mismatch file is fetched and parsed, then the validator marks it degraded
    expect(row.kind).toBe("ledger");
    if (row.kind === "ledger") {
      expect(row.validationResult.valid).toBe(false);
      expect(row.validationResult.healthCode).toBe("schema_mismatch");
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Loader — getLedgerDetail
// ═════════════════════════════════════════════════════════════════════════════

describe("getLedgerDetail", () => {
  const LEDGER_VALID = loadFixtureSync("ledger-valid.json");

  const ref = {
    repo: "taylorvalton/agentic-swarm",
    branch: "main",
    path: "docs/vmc/quality-ledger/chat.artifacts.json",
  };

  afterEach(() => setToken(undefined));

  it("returns ok=true with a validated ledger on success", async () => {
    setToken("test-token");
    setupFetchFn(() => mockResponse(200, LEDGER_VALID));

    const registry = makeRegistry();
    const result = await getLedgerDetail(ref, registry, new GithubApiSource());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.validationResult.valid).toBe(true);
    expect(result.repoDisplayName).toBe("Agentic Swarm");
  });

  it("returns ok=false with reason from the source on 404", async () => {
    setToken("test-token");
    setupFetchFn(() => mockResponse(404, "{}"));

    const result = await getLedgerDetail(ref, makeRegistry(), new GithubApiSource());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("not_found");
  });

  it("returns ok=false with reason=invalid_json for unparseable content", async () => {
    setToken("test-token");
    setupFetchFn(() => mockResponse(200, "not-json{{"));

    const result = await getLedgerDetail(ref, makeRegistry(), new GithubApiSource());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_json");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// LocalFsSource adapter contract tests
// ═════════════════════════════════════════════════════════════════════════════

describe("LocalFsSource", () => {
  const LEDGER_VALID = loadFixtureSync("ledger-valid.json");

  const readdirMock = vi.mocked(readdir);
  const readFileMock = vi.mocked(readFile);

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("disabled in production", () => {
    it("returns ok=false with reason=disabled when NODE_ENV=production", async () => {
      vi.stubEnv("NODE_ENV", "production");

      const source = new LocalFsSource({
        repoRoots: { "taylorvalton/agentic-swarm": "/repos/agentic-swarm" },
      });

      const registry = makeRegistry();
      const results = await source.listLedgers(registry);

      expect(results).toHaveLength(1);
      expect(results[0].ok).toBe(false);
      if (results[0].ok) return;
      expect(results[0].reason).toBe("disabled");
    });

    it("getLedger returns ok=false with reason=disabled when NODE_ENV=production", async () => {
      vi.stubEnv("NODE_ENV", "production");

      const source = new LocalFsSource({
        repoRoots: { "taylorvalton/agentic-swarm": "/repos/agentic-swarm" },
      });

      const result = await source.getLedger({
        repo: "taylorvalton/agentic-swarm",
        branch: "main",
        path: "docs/vmc/quality-ledger/chat.artifacts.json",
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("disabled");
    });
  });

  describe("allowlisted read OK", () => {
    it("reads a file from the allowlisted root and returns its raw content", async () => {
      readdirMock.mockResolvedValue(["chat.artifacts.json"] as never);
      readFileMock.mockResolvedValue(LEDGER_VALID as never);

      const source = new LocalFsSource({
        repoRoots: { "taylorvalton/agentic-swarm": "/repos/agentic-swarm" },
      });

      const results = await source.listLedgers(makeRegistry());
      expect(results).toHaveLength(1);
      const result = results[0];
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.ledgers).toHaveLength(1);
      expect(result.ledgers[0].raw).toContain("vmc-quality-ledger/v1");
    });
  });

  describe("path traversal rejection", () => {
    it("returns ok=false with reason=not_found for paths containing ../", async () => {
      const source = new LocalFsSource({
        repoRoots: { "taylorvalton/agentic-swarm": "/repos/agentic-swarm" },
      });

      const result = await source.getLedger({
        repo: "taylorvalton/agentic-swarm",
        branch: "main",
        path: "../../etc/passwd",
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("not_found");
    });

    it("returns ok=false with reason=not_found for paths that resolve outside the root", async () => {
      const source = new LocalFsSource({
        repoRoots: { "taylorvalton/agentic-swarm": "/repos/agentic-swarm" },
      });

      const result = await source.getLedger({
        repo: "taylorvalton/agentic-swarm",
        branch: "main",
        path: "docs/../../../etc/shadow",
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("not_found");
    });

    it("returns ok=false with reason=not_found for a repo not in repoRoots", async () => {
      const source = new LocalFsSource({ repoRoots: {} });

      const result = await source.getLedger({
        repo: "taylorvalton/unknown-repo",
        branch: "main",
        path: "docs/ledger.json",
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("not_found");
    });
  });

  describe("no_ledgers when glob matches nothing", () => {
    it("returns ok=false with reason=no_ledgers when directory has no matching files", async () => {
      readdirMock.mockResolvedValue(["README.md", "notes.txt"] as never);

      const source = new LocalFsSource({
        repoRoots: { "taylorvalton/agentic-swarm": "/repos/agentic-swarm" },
      });

      const results = await source.listLedgers(makeRegistry());
      expect(results[0].ok).toBe(false);
      if (results[0].ok) return;
      expect(results[0].reason).toBe("no_ledgers");
    });

    it("returns ok=false with reason=no_ledgers when directory is empty", async () => {
      readdirMock.mockResolvedValue([] as never);

      const source = new LocalFsSource({
        repoRoots: { "taylorvalton/agentic-swarm": "/repos/agentic-swarm" },
      });

      const results = await source.listLedgers(makeRegistry());
      expect(results[0].ok).toBe(false);
      if (results[0].ok) return;
      expect(results[0].reason).toBe("no_ledgers");
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// N1 regression — getLedgerDetail registry allowlist enforcement
// Off-registry / wrong-branch / out-of-glob refs must be rejected WITHOUT fetching.
// ═════════════════════════════════════════════════════════════════════════════

describe("getLedgerDetail — N1 regression: registry allowlist", () => {
  afterEach(() => setToken(undefined));

  it("returns degraded not_found for a repo not in the registry (no fetch)", async () => {
    setToken("test-token");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const registry = makeRegistry(); // only taylorvalton/agentic-swarm
    const result = await getLedgerDetail(
      { repo: "attacker/evil-repo", branch: "main", path: "docs/vmc/quality-ledger/chat.artifacts.json" },
      registry,
      new GithubApiSource()
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("not_found");
    expect(result.note).toMatch(/not in the registry/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns degraded not_found for a ref with wrong branch (no fetch)", async () => {
    setToken("test-token");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const registry = makeRegistry(); // default_branch: main
    const result = await getLedgerDetail(
      { repo: "taylorvalton/agentic-swarm", branch: "evil-branch", path: "docs/vmc/quality-ledger/chat.artifacts.json" },
      registry,
      new GithubApiSource()
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("not_found");
    expect(result.note).toMatch(/evil-branch/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns degraded not_found for a path that does not match the registry glob (no fetch)", async () => {
    setToken("test-token");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const registry = makeRegistry(); // glob: docs/vmc/quality-ledger/*.artifacts.json
    const result = await getLedgerDetail(
      { repo: "taylorvalton/agentic-swarm", branch: "main", path: "../../etc/passwd" },
      registry,
      new GithubApiSource()
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("not_found");
    expect(result.note).toMatch(/glob/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// N2 regression — fetchTree JSON parse failure does NOT poison the batch
// One repo returning 200 + non-JSON body must only affect that repo.
// ═════════════════════════════════════════════════════════════════════════════

describe("loader — N2 regression: tree JSON parse failure is per-repo, not batch-wide", () => {
  const LEDGER_VALID = loadFixtureSync("ledger-valid.json");

  afterEach(() => setToken(undefined));

  it("healthy repo still yields rows when another repo returns 200+invalid-JSON for tree", async () => {
    setToken("test-token");

    const goodTree = {
      sha: "abc123",
      tree: [{ path: "docs/vmc/quality-ledger/chat.artifacts.json", type: "blob", sha: "s1" }],
      truncated: false,
    };

    const registry = makeRegistry([
      { repo: "taylorvalton/agentic-swarm", display_name: "Good Repo", default_branch: "main", ledger_glob: "docs/vmc/quality-ledger/*.artifacts.json" },
      { repo: "taylorvalton/bad-repo", display_name: "Bad Repo", default_branch: "main", ledger_glob: "docs/vmc/quality-ledger/*.artifacts.json" },
    ]);

    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("agentic-swarm")) {
        if (url.includes("/git/trees/")) return Promise.resolve(mockResponse(200, JSON.stringify(goodTree)));
        return Promise.resolve(mockResponse(200, LEDGER_VALID));
      }
      // bad-repo returns 200 with non-JSON body for tree
      return Promise.resolve(mockResponse(200, "this is not json {{{{"));
    }));

    const rows = await listLedgerSummaries(registry, new GithubApiSource());

    const goodRows = rows.filter((r) => r.repo === "taylorvalton/agentic-swarm");
    const badRows = rows.filter((r) => r.repo === "taylorvalton/bad-repo");

    // Good repo must survive
    expect(goodRows.length).toBeGreaterThanOrEqual(1);
    expect(goodRows.some((r) => r.kind === "ledger")).toBe(true);

    // Bad repo must yield exactly one degraded row — not pollute good rows
    expect(badRows).toHaveLength(1);
    expect(badRows[0].kind).toBe("degraded-source");
    if (badRows[0].kind === "degraded-source") {
      expect(badRows[0].reason).toBe("network_error");
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// N3 regression — truncated tree flag surfaces as loud degraded reason
// ═════════════════════════════════════════════════════════════════════════════

describe("GithubApiSource — N3 regression: truncated tree returns degraded reason", () => {
  afterEach(() => setToken(undefined));

  it("returns ok=false with reason=truncated when trees API returns truncated=true", async () => {
    setToken("test-token");

    const truncatedTree = {
      sha: "abc123",
      tree: [{ path: "docs/vmc/quality-ledger/chat.artifacts.json", type: "blob", sha: "s1" }],
      truncated: true,
    };

    setupFetchFn((url) => {
      if (url.includes("/git/trees/")) return mockResponse(200, JSON.stringify(truncatedTree));
      return mockResponse(200, "should-not-reach");
    });

    const results = await new GithubApiSource().listLedgers(makeRegistry());
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(false);
    if (results[0].ok) return;
    expect(results[0].reason).toBe("truncated");
    expect(results[0].note).toMatch(/truncated/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// N4 regression — all raw content fetches fail → visible degraded row
// ═════════════════════════════════════════════════════════════════════════════

describe("GithubApiSource — N4 regression: all content fetches fail → degraded row visible", () => {
  afterEach(() => setToken(undefined));

  it("returns ok=false with reason=network_error when all content fetches fail for matched paths", async () => {
    setToken("test-token");

    const twoPathTree = {
      sha: "abc123",
      tree: [
        { path: "docs/vmc/quality-ledger/chat.artifacts.json", type: "blob", sha: "s1" },
        { path: "docs/vmc/quality-ledger/swarm.artifacts.json", type: "blob", sha: "s2" },
      ],
      truncated: false,
    };

    setupFetchFn((url) => {
      if (url.includes("/git/trees/")) return mockResponse(200, JSON.stringify(twoPathTree));
      // All content fetches fail with 500
      return mockResponse(500, JSON.stringify({ message: "Internal Server Error" }));
    });

    const results = await new GithubApiSource().listLedgers(makeRegistry());
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(false);
    if (results[0].ok) return;
    expect(results[0].reason).toBe("network_error");
    expect(results[0].note).toMatch(/2 path/i);
  });

  it("NEW-3 regression: carries the dominant per-file reason (all 403 → permission_denied, not network_error)", async () => {
    setToken("test-token");

    const twoPathTree = {
      sha: "abc123",
      tree: [
        { path: "docs/vmc/quality-ledger/chat.artifacts.json", type: "blob", sha: "s1" },
        { path: "docs/vmc/quality-ledger/swarm.artifacts.json", type: "blob", sha: "s2" },
      ],
      truncated: false,
    };

    setupFetchFn((url) => {
      if (url.includes("/git/trees/")) return mockResponse(200, JSON.stringify(twoPathTree));
      // Every content fetch is forbidden — the repo-level reason must reflect that,
      // not flatten to a generic network_error.
      return mockResponse(403, JSON.stringify({ message: "Forbidden" }));
    });

    const results = await new GithubApiSource().listLedgers(makeRegistry());
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(false);
    if (results[0].ok) return;
    expect(results[0].reason).toBe("permission_denied");
  });

  it("visible degraded row appears in listLedgerSummaries output (repo not dropped)", async () => {
    setToken("test-token");

    const twoPathTree = {
      sha: "abc123",
      tree: [
        { path: "docs/vmc/quality-ledger/chat.artifacts.json", type: "blob", sha: "s1" },
        { path: "docs/vmc/quality-ledger/swarm.artifacts.json", type: "blob", sha: "s2" },
      ],
      truncated: false,
    };

    setupFetchFn((url) => {
      if (url.includes("/git/trees/")) return mockResponse(200, JSON.stringify(twoPathTree));
      return mockResponse(404, JSON.stringify({ message: "Not Found" }));
    });

    const rows = await listLedgerSummaries(makeRegistry(), new GithubApiSource());
    const repoRows = rows.filter((r) => r.repo === "taylorvalton/agentic-swarm");
    // Repo must appear in the list — not silently dropped
    expect(repoRows).toHaveLength(1);
    expect(repoRows[0].kind).toBe("degraded-source");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Loader — scariest-first sort
// ═════════════════════════════════════════════════════════════════════════════

describe("loader — scariest-first sort", () => {
  const LEDGER_VALID = loadFixtureSync("ledger-valid.json");

  afterEach(() => setToken(undefined));

  it("places token_missing rows before valid ledger rows", async () => {
    setToken(undefined); // no token → all repos get token_missing (rank 0)

    const registry = makeRegistry();
    const rows = await listLedgerSummaries(registry, new GithubApiSource());
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("degraded-source");
    if (rows[0].kind === "degraded-source") {
      expect(rows[0].reason).toBe("token_missing");
    }
  });

  it("N8 regression: among equal-rank rows, lower avg confidence sorts first", async () => {
    setToken("test-token");

    // Two repos, both return valid ledgers (rank 6) but different confidence averages.
    // low-confidence ledger (avg 0.3) must sort before high-confidence (avg 0.9).
    const lowConfTree = {
      sha: "sha-low",
      tree: [{ path: "docs/vmc/quality-ledger/low.artifacts.json", type: "blob", sha: "s1" }],
      truncated: false,
    };
    const highConfTree = {
      sha: "sha-high",
      tree: [{ path: "docs/vmc/quality-ledger/high.artifacts.json", type: "blob", sha: "s2" }],
      truncated: false,
    };

    const makeLedger = (confidence: number, generatedAt: string) => JSON.stringify({
      schema_version: "vmc-quality-ledger/v1",
      module: "m",
      generated_at: generatedAt,
      branch: "main",
      summary: { total_artifacts: 1, by_type: { defect: 1 }, by_status: { broken: 1 }, by_severity: { low: 1 }, by_safety_class: { green: 1 } },
      artifacts: [{ artifact_id: "X-001", module: "m", artifact_type: "defect", title: "t", status: "broken", severity: "low", safety_class: "green", confidence }],
    });

    const registry = makeRegistry([
      { repo: "taylorvalton/high-conf", display_name: "High Conf", default_branch: "main", ledger_glob: "docs/vmc/quality-ledger/*.artifacts.json" },
      { repo: "taylorvalton/low-conf", display_name: "Low Conf", default_branch: "main", ledger_glob: "docs/vmc/quality-ledger/*.artifacts.json" },
    ]);

    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("high-conf")) {
        if (url.includes("/git/trees/")) return Promise.resolve(mockResponse(200, JSON.stringify(highConfTree)));
        return Promise.resolve(mockResponse(200, makeLedger(0.9, "2026-06-01")));
      }
      if (url.includes("low-conf")) {
        if (url.includes("/git/trees/")) return Promise.resolve(mockResponse(200, JSON.stringify(lowConfTree)));
        return Promise.resolve(mockResponse(200, makeLedger(0.3, "2026-06-01")));
      }
      return Promise.resolve(mockResponse(404, "{}"));
    }));

    const rows = await listLedgerSummaries(registry, new GithubApiSource());
    const ledgerRows = rows.filter((r) => r.kind === "ledger");
    expect(ledgerRows).toHaveLength(2);
    // lower avg confidence (0.3) must come before higher (0.9)
    if (ledgerRows[0].kind === "ledger" && ledgerRows[1].kind === "ledger") {
      const conf0 = ledgerRows[0].validationResult.valid ? ledgerRows[0].validationResult.ledger.artifacts[0].confidence : 1;
      const conf1 = ledgerRows[1].validationResult.valid ? ledgerRows[1].validationResult.ledger.artifacts[0].confidence : 0;
      expect(conf0).toBeLessThan(conf1);
    }
  });

  it("N8 regression: among equal-rank equal-confidence rows, newer generated_at sorts first", async () => {
    setToken("test-token");

    // Use dates that are both fresh (within 7 days of now) so both rows stay at rank 6.
    // "older" = 5 days ago, "newer" = 2 days ago — both fresh, same rank, same confidence.
    const olderDate = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);
    const newerDate = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);

    const makeTree = (sha: string, path: string) => ({
      sha,
      tree: [{ path, type: "blob", sha: "s1" }],
      truncated: false,
    });

    const makeLedger = (generatedAt: string) => JSON.stringify({
      schema_version: "vmc-quality-ledger/v1",
      module: "m",
      generated_at: generatedAt,
      branch: "main",
      summary: { total_artifacts: 1, by_type: { defect: 1 }, by_status: { broken: 1 }, by_severity: { low: 1 }, by_safety_class: { green: 1 } },
      artifacts: [{ artifact_id: "X-001", module: "m", artifact_type: "defect", title: "t", status: "broken", severity: "low", safety_class: "green", confidence: 0.5 }],
    });

    const registry = makeRegistry([
      { repo: "taylorvalton/older-repo", display_name: "Older Repo", default_branch: "main", ledger_glob: "docs/vmc/quality-ledger/*.artifacts.json" },
      { repo: "taylorvalton/newer-repo", display_name: "Newer Repo", default_branch: "main", ledger_glob: "docs/vmc/quality-ledger/*.artifacts.json" },
    ]);

    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("older-repo")) {
        if (url.includes("/git/trees/")) return Promise.resolve(mockResponse(200, JSON.stringify(makeTree("sha1", "docs/vmc/quality-ledger/older.artifacts.json"))));
        return Promise.resolve(mockResponse(200, makeLedger(olderDate)));
      }
      if (url.includes("newer-repo")) {
        if (url.includes("/git/trees/")) return Promise.resolve(mockResponse(200, JSON.stringify(makeTree("sha2", "docs/vmc/quality-ledger/newer.artifacts.json"))));
        return Promise.resolve(mockResponse(200, makeLedger(newerDate)));
      }
      return Promise.resolve(mockResponse(404, "{}"));
    }));

    const rows = await listLedgerSummaries(registry, new GithubApiSource());
    const ledgerRows = rows.filter((r) => r.kind === "ledger");
    expect(ledgerRows).toHaveLength(2);
    // newer generated_at must come before older (both have same rank + confidence)
    if (ledgerRows[0].kind === "ledger" && ledgerRows[1].kind === "ledger") {
      const ga0 = ledgerRows[0].validationResult.valid ? ledgerRows[0].validationResult.ledger.generated_at : "";
      const ga1 = ledgerRows[1].validationResult.valid ? ledgerRows[1].validationResult.ledger.generated_at : "";
      expect(ga0 > ga1).toBe(true);
    }
  });

  it("sorts permission_denied rows before valid ledger rows (scariest-first)", async () => {
    setToken("test-token");

    // Single-file tree for agentic-swarm
    const singleTree = {
      sha: "abc123def456",
      tree: [{ path: "docs/vmc/quality-ledger/chat.artifacts.json", type: "blob", sha: "s1" }],
      truncated: false,
    };

    const registry = makeRegistry([
      {
        repo: "taylorvalton/agentic-swarm",
        display_name: "Agentic Swarm",
        default_branch: "main",
        ledger_glob: "docs/vmc/quality-ledger/*.artifacts.json",
      },
      {
        repo: "taylorvalton/plx-mc",
        display_name: "PLX MC",
        default_branch: "main",
        ledger_glob: "docs/plx-mc/quality-ledger/*.artifacts.json",
      },
    ]);

    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("agentic-swarm")) {
        if (url.includes("/git/trees/")) return Promise.resolve(mockResponse(200, JSON.stringify(singleTree)));
        return Promise.resolve(mockResponse(200, LEDGER_VALID));
      }
      // plx-mc → permission denied
      return Promise.resolve(mockResponse(403, "{}"));
    }));

    const rows = await listLedgerSummaries(registry, new GithubApiSource());

    // permission_denied (rank 0) must appear before valid ledger (rank 6 or 3)
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0].kind).toBe("degraded-source");
    if (rows[0].kind === "degraded-source") {
      expect(rows[0].reason).toBe("permission_denied");
    }
  });
});
