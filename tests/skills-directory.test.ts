// Domain tests for skills-directory: allowlist parse, manifest filter, loader
// with injected GitHub source, and seed allowlist integration.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  buildSkillsInstallPlan,
  createSkillSubmission,
  detectRegistryDrift,
  listSkillSubmissions,
  getSkillDetail,
  listSkillCatalog,
  loadCatalogConfig,
  packageSkillIds,
  parseAllowlistJson,
  parseManifestJson,
  parseSkillsRegistryJson,
  publishedSkills,
  resolveAllowIds,
  updateSkillSubmission,
} from "@/lib/skills-directory";
import type {
  AllowlistConfig,
  CatalogPointer,
  ContentFetchResult,
  ManifestFetchResult,
  SkillsSourceReader,
} from "@/lib/skills-directory";

const FIXTURE_MANIFEST = readFileSync(
  join(process.cwd(), "tests/fixtures/skills-directory/manifest.json"),
  "utf8"
);
const FIXTURE_SKILL = readFileSync(
  join(process.cwd(), "tests/fixtures/skills-directory/create-skill-SKILL.md"),
  "utf8"
);

const TEST_CATALOG_V3: AllowlistConfig = {
  schemaVersion: "plx-skills-catalog/v3",
  sourceRepo: "taylorvalton/plx-cursor-skills",
  sourceBranch: "main",
  manifestPath: "manifest.json",
  packageId: "plx-engineering-core",
  pinTag: "v1.0.0-test",
  pinSha: "abc123",
  skills: [],
};

const TEST_ALLOWLIST: AllowlistConfig = {
  ...TEST_CATALOG_V3,
  schemaVersion: "plx-company-skills-allowlist/v2",
  skills: ["create-skill", "wterm-preflight", "missing-from-manifest"],
};

const parsedFixtureManifest = parseManifestJson(FIXTURE_MANIFEST);
if (!parsedFixtureManifest.ok) {
  throw new Error("fixture manifest invalid");
}
const FIXTURE_MANIFEST_OBJ = parsedFixtureManifest.manifest;

function fakeSource(opts: {
  manifest?: ManifestFetchResult;
  skills?: Record<string, ContentFetchResult>;
}): SkillsSourceReader {
  return {
    async fetchManifest() {
      return (
        opts.manifest ?? {
          ok: true,
          manifest: FIXTURE_MANIFEST_OBJ,
          ref: "v1.0.0-test",
        }
      );
    },
    async fetchSkillContent(_pointer: CatalogPointer, contentPath: string) {
      if (contentPath.includes("create-skill")) {
        return opts.skills?.["create-skill"] ?? { ok: true, content: FIXTURE_SKILL };
      }
      return (
        opts.skills?.[contentPath] ?? {
          ok: false,
          reason: "not_found",
          note: `missing ${contentPath}`,
        }
      );
    },
  };
}

describe("skills-directory catalog config", () => {
  it("loads committed v3 skills-catalog.json", () => {
    const r = loadCatalogConfig();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.schemaVersion).toBe("plx-skills-catalog/v3");
      expect(r.config.sourceRepo).toBe("taylorvalton/plx-cursor-skills");
      expect(r.config.skills).toEqual([]);
    }
  });

  it("parses legacy v2 allowlist with skills[]", () => {
    const raw = readFileSync(
      join(process.cwd(), "config/company-skills-allowlist.json"),
      "utf8"
    );
    const r = parseAllowlistJson(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.skills.length).toBeGreaterThan(20);
    }
  });

  it("never throws on garbage JSON", () => {
    expect(() => parseAllowlistJson("{bad")).not.toThrow();
    expect(parseAllowlistJson("{bad").ok).toBe(false);
  });

  it("resolveAllowIds uses manifest package when v3", () => {
    const ids = resolveAllowIds(TEST_CATALOG_V3, FIXTURE_MANIFEST_OBJ);
    expect([...ids].sort()).toEqual(["create-skill", "wterm-preflight"]);
  });

  it("packageSkillIds reads package from manifest", () => {
    expect(packageSkillIds(FIXTURE_MANIFEST_OBJ, "plx-engineering-core")).toEqual([
      "create-skill",
      "wterm-preflight",
    ]);
  });
});

describe("skills-directory manifest", () => {
  it("parses fixture manifest", () => {
    const r = parseManifestJson(FIXTURE_MANIFEST);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.skills).toHaveLength(3);
  });

  it("filters published skills by package + allowlist", () => {
    const manifest = parseManifestJson(FIXTURE_MANIFEST);
    if (!manifest.ok) throw new Error("bad fixture");
    const allow = new Set(["create-skill", "wterm-preflight", "draft-only"]);
    const rows = publishedSkills(manifest.manifest, "plx-engineering-core", allow);
    expect(rows.map((s) => s.id)).toEqual(["create-skill", "wterm-preflight"]);
  });
});

describe("skills-directory loader", () => {
  it("lists ready catalog from manifest (v3, no skills[])", async () => {
    const result = await listSkillCatalog(TEST_CATALOG_V3, fakeSource({}));
    expect(result.meta.state).toBe("ready");
    expect(result.skills.map((s) => s.id)).toEqual(["create-skill", "wterm-preflight"]);
  });

  it("lists ready catalog from legacy allowlist", async () => {
    const result = await listSkillCatalog(TEST_ALLOWLIST, fakeSource({}));
    expect(result.meta.state).toBe("ready");
    expect(result.meta.version).toBe("1.0.0-test");
    expect(result.skills.map((s) => s.id)).toEqual(["create-skill", "wterm-preflight"]);
  });

  it("degrades with legacy fallback ids when manifest fetch fails", async () => {
    const result = await listSkillCatalog(
      TEST_ALLOWLIST,
      fakeSource({
        manifest: { ok: false, reason: "token_missing", note: "no token" },
      })
    );
    expect(result.meta.state).toBe("degraded");
    expect(result.meta.note).toContain("token");
    expect(result.skills).toHaveLength(3);
    expect(result.skills[0].status).toBe("unknown");
  });

  it("degrades empty when v3 and manifest fetch fails", async () => {
    const result = await listSkillCatalog(
      TEST_CATALOG_V3,
      fakeSource({
        manifest: { ok: false, reason: "token_missing", note: "no token" },
      })
    );
    expect(result.meta.state).toBe("degraded");
    expect(result.skills).toHaveLength(0);
  });

  it("detail returns markdown nodes for a published skill", async () => {
    const detail = await getSkillDetail(TEST_ALLOWLIST, fakeSource({}), "create-skill");
    expect(detail.ok).toBe(true);
    if (detail.ok) {
      expect(detail.nodes.length).toBeGreaterThan(0);
      expect(detail.toc.some((h) => /when to use/i.test(h.text))).toBe(true);
    }
  });

  it("detail rejects allowlist ids not in manifest publish set", async () => {
    const detail = await getSkillDetail(
      TEST_ALLOWLIST,
      fakeSource({}),
      "missing-from-manifest"
    );
    expect(detail.ok).toBe(false);
    if (!detail.ok) expect(detail.reason).toBe("skill_not_found");
  });

  it("detail degrades when SKILL.md missing", async () => {
    const detail = await getSkillDetail(TEST_ALLOWLIST, fakeSource({}), "wterm-preflight");
    expect(detail.ok).toBe(false);
    if (!detail.ok) expect(detail.reason).toBe("not_found");
  });
});

describe("skills-directory registry + installer", () => {
  it("detects missing and stale local registry entries", () => {
    const registry = parseSkillsRegistryJson(
      JSON.stringify({
        schemaVersion: "agentic-skills-registry.v1",
        catalogVersion: "old",
        gitRef: "old-ref",
        packageId: "plx-engineering-core",
        syncedAt: "2026-06-30T12:00:00.000Z",
        skills: [{ id: "create-skill", contentSha: "" }],
      })
    );
    if (!registry.ok) throw new Error(registry.error);
    const expected = publishedSkills(
      FIXTURE_MANIFEST_OBJ,
      "plx-engineering-core",
      new Set(TEST_ALLOWLIST.skills)
    );
    const drift = detectRegistryDrift(
      registry.registry,
      FIXTURE_MANIFEST_OBJ,
      "plx-engineering-core",
      expected
    );
    expect(drift.ok).toBe(false);
    expect(drift.catalogVersionChanged).toBe(true);
    expect(drift.gitRefChanged).toBe(true);
    expect(drift.missingSkillIds).toEqual(["wterm-preflight"]);
    expect(drift.staleSkillIds).toEqual(["create-skill"]);
  });

  it("builds install and sync scripts without executing them", () => {
    const plan = buildSkillsInstallPlan({
      mode: "install",
      allowlist: TEST_ALLOWLIST,
      manifest: FIXTURE_MANIFEST_OBJ,
    });
    expect(plan.installSkillIds).toEqual(["create-skill", "wterm-preflight"]);
    expect(plan.scripts.bash).toContain("git -C");
    expect(plan.scripts.bash).toContain("Registry:");
    expect(plan.scripts.powershell).toContain("Get-FileHash");

    const synced = buildSkillsInstallPlan({
      mode: "sync",
      allowlist: TEST_ALLOWLIST,
      manifest: FIXTURE_MANIFEST_OBJ,
      localRegistry: {
        schemaVersion: "agentic-skills-registry.v1",
        catalogVersion: FIXTURE_MANIFEST_OBJ.version,
        gitRef: FIXTURE_MANIFEST_OBJ.gitRef,
        packageId: "plx-engineering-core",
        syncedAt: "2026-06-30T12:00:00.000Z",
        skills: [
          { id: "create-skill", contentSha: "x" },
          { id: "wterm-preflight", contentSha: "x" },
        ],
      },
    });
    expect(synced.installSkillIds).toEqual([]);
  });
});

describe("skills-directory submissions store", () => {
  it("falls back to memory when PLX_MC_DATABASE_URL is unset", async () => {
    vi.stubEnv("PLX_MC_DATABASE_URL", "");
    const created = await createSkillSubmission({
      skillId: "create-skill",
      title: "Improve skill",
      submitterEmail: "vince@petrasoap.com",
      description: "Add clearer examples.",
    });
    expect(created.id).toMatch(/^skill-sub-/);
    expect(created.status).toBe("pending");

    const listed = await listSkillSubmissions("pending");
    expect(listed.some((s) => s.id === created.id)).toBe(true);

    const updated = await updateSkillSubmission(created.id, {
      status: "approved",
      reviewComment: "Ship it.",
    });
    expect(updated?.status).toBe("approved");
    expect(updated?.reviewComment).toBe("Ship it.");
  });
});
