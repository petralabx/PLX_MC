// Domain tests for skills-directory: allowlist parse, manifest filter, loader
// with injected GitHub source, and seed allowlist integration.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { PATCH as patchSubmission } from "@/app/api/skills-directory/submissions/[id]/route";
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
  publishApprovedSkillSubmission,
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
  SkillSubmission,
  SkillsPublishGithubClient,
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

afterEach(() => {
  vi.unstubAllEnvs();
});

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
      expect(r.config.sourceRepo).toBe("petralabx/skills");
      expect(r.config.skills).toEqual([]);
    }
  });

  it("parses deprecated v2 allowlist redirect with empty skills[]", () => {
    const raw = readFileSync(
      join(process.cwd(), "config/company-skills-allowlist.json"),
      "utf8"
    );
    const r = parseAllowlistJson(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.skills).toEqual([]);
      expect(r.config.schemaVersion).toBe("plx-company-skills-allowlist/v2");
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

  it("accepts manifests without gitRef and fills from fallback", () => {
    const raw = JSON.parse(FIXTURE_MANIFEST) as Record<string, unknown>;
    delete raw.gitRef;
    const r = parseManifestJson(JSON.stringify(raw), {
      fallbackGitRef: "805c514bcd91f68172d45cee915c04d01f33ff8b",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.gitRef).toBe("805c514bcd91f68172d45cee915c04d01f33ff8b");
      expect(r.manifest.version).toBe("1.0.0-test");
    }
  });

  it("prefers publisher gitRef over fallback", () => {
    const r = parseManifestJson(FIXTURE_MANIFEST, { fallbackGitRef: "other-ref" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.gitRef).toBe("v1.0.0-test");
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

  it("lists ready catalog when publisher omits gitRef (uses fetch ref / pin)", async () => {
    const withoutGitRef = {
      ...FIXTURE_MANIFEST_OBJ,
      gitRef: "",
    };
    const result = await listSkillCatalog(
      TEST_CATALOG_V3,
      fakeSource({
        manifest: { ok: true, manifest: withoutGitRef, ref: "abc123" },
      })
    );
    expect(result.meta.state).toBe("ready");
    expect(result.meta.gitRef).toBe("abc123");
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

  it("rejects unsafe skill ids before generating installer scripts", () => {
    expect(() =>
      buildSkillsInstallPlan({
        mode: "install",
        allowlist: TEST_ALLOWLIST,
        manifest: FIXTURE_MANIFEST_OBJ,
        ids: ["../escape"],
      })
    ).toThrow(/invalid skill id/);
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
      skillMd: "# Improve skill\n",
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

  it("rejects unsafe ids at submission persistence boundary", async () => {
    vi.stubEnv("PLX_MC_DATABASE_URL", "");
    await expect(
      createSkillSubmission({
        skillId: "../escape",
        title: "Bad Skill",
        submitterEmail: "vince@petrasoap.com",
      })
    ).rejects.toThrow(/invalid skill id/);
  });
});

describe("skills-directory publish", () => {
  const submission: SkillSubmission = {
    id: "skill-sub-123",
    skillId: "new-skill",
    title: "New Skill",
    description: "Adds a new company skill.",
    submitterEmail: "vince@petrasoap.com",
    skillMd: "# New Skill\n\nInstructions.\n",
    status: "pending",
    createdAt: "2026-07-01T12:00:00.000Z",
    updatedAt: "2026-07-01T12:00:00.000Z",
  };

  it("returns publish-instructions.md content when GitHub writes are disabled", async () => {
    const result = await publishApprovedSkillSubmission(submission, {
      writeEnabled: false,
      now: new Date("2026-07-01T12:00:00.000Z"),
    });

    expect(result.mode).toBe("instructions");
    if (result.mode === "instructions") {
      expect(result.branchName).toBe("submit/skill-sub-123-20260701T120000Z");
      expect(result.instructionsPath).toBe("publish-instructions.md");
      expect(result.content).toContain("SKILLS_SUBMIT_GITHUB_WRITE_ENABLED");
      expect(result.content).toContain("skills/new-skill/SKILL.md");
      expect(result.content).toContain('status: "published"');
    }
  });

  it("creates a publish branch, writes skill + manifest, and opens a PR", async () => {
    const manifest = {
      ...FIXTURE_MANIFEST_OBJ,
      packages: [
        {
          id: "plx-engineering-core",
          name: "PLX Engineering Core",
          skillIds: ["create-skill"],
        },
      ],
      skills: [
        ...FIXTURE_MANIFEST_OBJ.skills,
        {
          id: "new-skill",
          name: "New Skill",
          description: "Waiting for approval.",
          status: "pending_review",
          contentPath: "skills/new-skill/",
        },
      ],
    };
    const calls: string[] = [];
    const writes: Array<{ path: string; content: string; sha?: string }> = [];
    const github: SkillsPublishGithubClient = {
      async getBranchHead(input) {
        calls.push(`head:${input.branch}`);
        return "base-sha";
      },
      async createBranch(input) {
        calls.push(`branch:${input.branch}:${input.sha}`);
      },
      async getFile(input) {
        calls.push(`get:${input.path}:${input.ref}`);
        if (input.path === "manifest.json") {
          return { sha: "manifest-sha", content: JSON.stringify(manifest) };
        }
        return null;
      },
      async putFile(input) {
        calls.push(`put:${input.path}:${input.branch}`);
        writes.push({
          path: input.path,
          content: input.content,
          sha: input.sha,
        });
      },
      async openPullRequest(input) {
        calls.push(`pr:${input.head}:${input.base}`);
        return {
          number: 42,
          htmlUrl: `https://github.com/taylorvalton/plx-cursor-skills/pull/42`,
        };
      },
    };
    const fetchImpl = vi.fn();

    const result = await publishApprovedSkillSubmission(submission, {
      github,
      token: "test-token",
      writeEnabled: true,
      now: new Date("2026-07-01T12:00:00.000Z"),
    });

    expect(result.mode).toBe("github_pr");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(calls).toContain("branch:submit/skill-sub-123-20260701T120000Z:base-sha");
    expect(calls).toContain("pr:submit/skill-sub-123-20260701T120000Z:main");
    const skillWrite = writes.find((w) => w.path === "skills/new-skill/SKILL.md");
    expect(skillWrite?.content).toBe("# New Skill\n\nInstructions.\n");
    const manifestWrite = writes.find((w) => w.path === "manifest.json");
    expect(manifestWrite?.sha).toBe("manifest-sha");
    const nextManifest = JSON.parse(manifestWrite?.content ?? "{}");
    const nextEntry = nextManifest.skills.find(
      (entry: { id: string }) => entry.id === "new-skill"
    );
    expect(nextEntry.status).toBe("published");
    expect(nextManifest.packages[0].skillIds).toEqual(["create-skill", "new-skill"]);
  });

  it("approval PATCH includes publish fallback metadata", async () => {
    vi.stubEnv("PLX_MC_DATABASE_URL", "");
    vi.stubEnv("PLX_MC_AUTH_CLIENT_ID", "");
    vi.stubEnv("PLX_MC_AUTH_CLIENT_SECRET", "");
    vi.stubEnv("SKILLS_SUBMIT_GITHUB_WRITE_ENABLED", "0");
    const created = await createSkillSubmission({
      skillId: "api-skill",
      title: "API Skill",
      submitterEmail: "vince@petrasoap.com",
      description: "API publish check.",
      skillMd: "# API Skill\n",
    });

    const res = await patchSubmission(
      new Request(`http://localhost/api/skills-directory/submissions/${created.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "approved",
          actor: "vince",
          reviewComment: "Approved through API.",
        }),
      }),
      { params: Promise.resolve({ id: created.id }) }
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.status).toBe("approved");
    expect(body.data.reviewComment).toBe("Approved through API.");
    expect(body.data.publish.mode).toBe("instructions");
    expect(body.data.publish.instructionsPath).toBe("publish-instructions.md");
    expect(body.data.publish.content).toContain("skills/api-skill/SKILL.md");
  });

  it("approval PATCH rejects non-approver actors before publishing", async () => {
    vi.stubEnv("PLX_MC_DATABASE_URL", "");
    vi.stubEnv("PLX_MC_AUTH_CLIENT_ID", "");
    vi.stubEnv("PLX_MC_AUTH_CLIENT_SECRET", "");
    vi.stubEnv("SKILLS_SUBMIT_GITHUB_WRITE_ENABLED", "0");
    const created = await createSkillSubmission({
      skillId: "blocked-skill",
      title: "Blocked Skill",
      submitterEmail: "vince@petrasoap.com",
      description: "Rejected by server-side approver gate.",
      skillMd: "# Blocked Skill\n",
    });

    const res = await patchSubmission(
      new Request(`http://localhost/api/skills-directory/submissions/${created.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "approved",
          actor: "greg",
          reviewComment: "Should not publish.",
        }),
      }),
      { params: Promise.resolve({ id: created.id }) }
    );
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("not_approver");
    const stored = await listSkillSubmissions("pending");
    expect(stored.some((item) => item.id === created.id)).toBe(true);
  });

  it("approval PATCH does not trust actor body when OIDC is configured", async () => {
    vi.stubEnv("PLX_MC_DATABASE_URL", "");
    vi.stubEnv("SKILLS_SUBMIT_GITHUB_WRITE_ENABLED", "0");
    vi.stubEnv("PLX_MC_AUTH_CLIENT_ID", "test-client");
    vi.stubEnv("PLX_MC_AUTH_CLIENT_SECRET", "test-secret");
    vi.stubEnv("PLX_MC_AUTH_TENANT_ID", "test-tenant");
    vi.stubEnv("PLX_MC_AUTH_SECRET", "test-auth-secret");
    const created = await createSkillSubmission({
      skillId: "spoof-skill",
      title: "Spoof Skill",
      submitterEmail: "vince@petrasoap.com",
      description: "Actor spoof should fail under OIDC.",
      skillMd: "# Spoof Skill\n",
    });

    const res = await patchSubmission(
      new Request(`http://localhost/api/skills-directory/submissions/${created.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "approved",
          actor: "vince",
          reviewComment: "Spoofed actor.",
        }),
      }),
      { params: Promise.resolve({ id: created.id }) }
    );
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("not_authenticated");
  });
});
