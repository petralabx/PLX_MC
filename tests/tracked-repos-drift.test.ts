// Single repo registry drift gate. config/tracked-repos-registry.json (keyed on
// owner/name) is the source of truth; every other repo list in the codebase is
// either derived from it (the Hub MCP checkout allowlist) or a legitimate
// subset (routing pilots, go-live announcer slugs, loop-ledgers registry, the
// MC REPOS seed fixture). CI runs this via `npm test`, so a list that drifts
// from the registry fails the build instead of disagreeing silently.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ACTIVE_TRACKED_REPO_SLUGS, registryDrift, TRACKED_REPO_SLUGS } from "@/lib/compliance";
import { GO_LIVE_BARE_REPO_SLUGS, GO_LIVE_GITHUB_ORG } from "@/lib/compliance/go-live-announcer";
import { parseRegistryJson } from "@/lib/loop-ledgers";
import { REPOS } from "@/lib/mc-data/data";
import { MCP_CHECKOUT_REPO_ALLOWLIST } from "@/lib/mcp/checkout-repo";
import { listPilotDescriptors } from "@/lib/routing/rollout";

const ROOT = join(import.meta.dirname, "..");

function loopLedgerRepos(): string[] {
  const parsed = parseRegistryJson(
    readFileSync(join(ROOT, "config/loop-ledgers-registry.json"), "utf8")
  );
  if (!parsed.ok) throw new Error(`loop-ledgers registry invalid: ${parsed.error}`);
  return parsed.config.repos.map((entry) => entry.repo);
}

const NO_DRIFT = { unknown: [], missing: expect.any(Array), duplicates: [] };

describe("fleet registry is the single source of truth", () => {
  it("lists every org repo as a canonical owner/name slug (incl. plx_secondbrain)", () => {
    expect(TRACKED_REPO_SLUGS.length).toBe(10);
    expect(TRACKED_REPO_SLUGS).toContain("petralabx/plx_secondbrain");
    for (const slug of TRACKED_REPO_SLUGS) {
      expect(slug).toMatch(/^petralabx\/[A-Za-z0-9_.-]+$/);
    }
    expect(new Set(TRACKED_REPO_SLUGS).size).toBe(TRACKED_REPO_SLUGS.length);
  });

  it("Hub MCP checkout allowlist equals the ACTIVE registry set", () => {
    expect(registryDrift(MCP_CHECKOUT_REPO_ALLOWLIST, ACTIVE_TRACKED_REPO_SLUGS)).toEqual({
      unknown: [],
      missing: [],
      duplicates: [],
    });
    // Non-active entries (test-perms-check is pending_adoption) stay fail-closed.
    expect(MCP_CHECKOUT_REPO_ALLOWLIST).not.toContain("petralabx/test-perms-check");
    expect(registryDrift(MCP_CHECKOUT_REPO_ALLOWLIST).missing).toEqual([
      "petralabx/test-perms-check",
    ]);
  });

  it("the active set is the registry filtered to status === active", () => {
    const registry = JSON.parse(
      readFileSync(join(ROOT, "config/tracked-repos-registry.json"), "utf8")
    ) as { repos: Array<{ repo: string; status?: string }> };
    expect([...ACTIVE_TRACKED_REPO_SLUGS]).toEqual(
      registry.repos.filter((entry) => entry.status === "active").map((entry) => entry.repo)
    );
    expect(ACTIVE_TRACKED_REPO_SLUGS).toContain("petralabx/plx_secondbrain");
    expect(registryDrift(ACTIVE_TRACKED_REPO_SLUGS)).toEqual({
      unknown: [],
      missing: ["petralabx/test-perms-check"],
      duplicates: [],
    });
  });

  it("every routing pilot descriptor is a registry repo", () => {
    expect(registryDrift(listPilotDescriptors().map((pilot) => pilot.repo))).toEqual(NO_DRIFT);
  });

  it("every go-live announcer slug is a registry repo", () => {
    const slugs = [...GO_LIVE_BARE_REPO_SLUGS].map((name) => `${GO_LIVE_GITHUB_ORG}/${name}`);
    expect(registryDrift(slugs)).toEqual(NO_DRIFT);
  });

  it("every loop-ledgers registry repo is a registry repo", () => {
    expect(registryDrift(loopLedgerRepos())).toEqual(NO_DRIFT);
  });

  it("every MC REPOS seed fixture entry is a registry repo", () => {
    const slugs = Object.values(REPOS).map((repo) => `${repo.owner}/${repo.name}`);
    expect(registryDrift(slugs)).toEqual(NO_DRIFT);
  });
});

describe("registryDrift detects an injected mismatch (the checker is not vacuous)", () => {
  it("flags unknown, case-drifted, missing, and duplicate entries", () => {
    const bad = [
      "petralabx/PLX_MC",
      "petralabx/not-a-registry-repo",
      "petralabx/plx_mc", // case drift from the canonical petralabx/PLX_MC
      "petralabx/skills",
      "petralabx/skills",
    ];
    const drift = registryDrift(bad);
    expect(drift.unknown).toEqual(["petralabx/not-a-registry-repo", "petralabx/plx_mc"]);
    expect(drift.duplicates).toEqual(["petralabx/skills"]);
    expect(drift.missing).toContain("petralabx/plx_secondbrain");
    expect(drift.missing).not.toContain("petralabx/PLX_MC");
    expect(drift).not.toEqual({ unknown: [], missing: [], duplicates: [] });
  });

  it("an allowlist that omits a registry repo fails the equality check", () => {
    const stale = TRACKED_REPO_SLUGS.filter((slug) => slug !== "petralabx/plx_secondbrain");
    expect(registryDrift(stale).missing).toEqual(["petralabx/plx_secondbrain"]);
  });

  it("accepts an explicit registry for hermetic checks", () => {
    expect(registryDrift(["o/a"], ["o/a", "o/b"])).toEqual({
      unknown: [],
      missing: ["o/b"],
      duplicates: [],
    });
  });
});
