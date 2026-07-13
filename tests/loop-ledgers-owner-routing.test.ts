// Regression: Loop Ledger GitHub reads must resolve credentials with the
// parsed repo owner so dual-org App installations are selected correctly.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GithubApiSource } from "@/lib/loop-ledgers/sources/github-api";
import type { RegistryConfig } from "@/lib/loop-ledgers/types";

const resolveGithubToken = vi.fn();

vi.mock("@/lib/github-app", () => ({
  resolveGithubToken: (...args: unknown[]) => resolveGithubToken(...args),
}));

function mockResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "application/json" },
  });
}

const TREE_ONE = JSON.stringify({
  sha: "tree-sha",
  truncated: false,
  tree: [{ path: "docs/portal/quality-ledger/uat.artifacts.json", type: "blob", sha: "b1" }],
});

const LEDGER_BODY = JSON.stringify({
  schema_version: "vmc-quality-ledger/v1",
  generated_at: "2026-07-01T00:00:00.000Z",
  artifacts: [],
  summary: { total_artifacts: 0 },
});

beforeEach(() => {
  resolveGithubToken.mockReset();
  resolveGithubToken.mockImplementation(async (opts?: { repoOwner?: string | null }) => {
    const owner = (opts?.repoOwner ?? "").toLowerCase();
    if (owner === "petralabx") return "tok_plx";
    if (owner === "taylorvalton") return "tok_legacy";
    return null;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GithubApiSource owner-aware token routing", () => {
  it("passes each registry repo owner into resolveGithubToken for listLedgers", async () => {
    const seenAuth = new Set<string>();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        const auth = String((init?.headers as Record<string, string> | undefined)?.authorization ?? "");
        seenAuth.add(auth);
        if (url.includes("/git/trees/")) return Promise.resolve(mockResponse(200, TREE_ONE));
        return Promise.resolve(mockResponse(200, LEDGER_BODY));
      })
    );

    const registry: RegistryConfig = {
      schema_version: "plx-loop-ledger-registry/v1",
      freshness: { warn_after_days: 7, stale_after_days: 30 },
      repos: [
        {
          repo: "petralabx/plx-customer-portal",
          display_name: "Portal",
          default_branch: "staging",
          ledger_glob: "docs/portal/quality-ledger/*.artifacts.json",
        },
        {
          repo: "taylorvalton/agentic-swarm",
          display_name: "Swarm",
          default_branch: "main",
          ledger_glob: "docs/portal/quality-ledger/*.artifacts.json",
        },
      ],
    };

    const results = await new GithubApiSource().listLedgers(registry);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.ok)).toBe(true);

    expect(resolveGithubToken).toHaveBeenCalledWith({ repoOwner: "petralabx" });
    expect(resolveGithubToken).toHaveBeenCalledWith({ repoOwner: "taylorvalton" });
    expect(seenAuth.has("Bearer tok_plx")).toBe(true);
    expect(seenAuth.has("Bearer tok_legacy")).toBe(true);
  });

  it("passes the detail ref owner into resolveGithubToken for getLedger", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(mockResponse(200, LEDGER_BODY)))
    );

    const result = await new GithubApiSource().getLedger({
      repo: "petralabx/agentic-swarm",
      branch: "main",
      path: "docs/vmc/quality-ledger/chat.artifacts.json",
    });

    expect(result.ok).toBe(true);
    expect(resolveGithubToken).toHaveBeenCalledWith({ repoOwner: "petralabx" });
    expect(resolveGithubToken).toHaveBeenCalledTimes(1);
  });
});
