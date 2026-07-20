// Invariant tests for the repo registry, allow-list governance, and the
// self-service request → approve flow (EN-002 / WS-2). These protect behavior
// (registry shape, backfill correctness, allow-list rejection, request
// transitions, GitHub-validation reconcile), not fixture shape. GitHub
// validation is mocked through the store's injectable validator seam.
import { beforeEach, describe, expect, it } from "vitest";

import {
  AGENTS,
  ALLOWED_REPO_ORGS,
  BUCKETS,
  DEFAULT_NEW_REPO_ORG,
  HUMANS,
  REPOS,
  REPO_ORG_LEGACY,
  REPO_ORG_PLX,
  TASKS,
  allowedReposOnly,
  disallowedRepos,
  isAllowedRepo,
  isAllowedRepoOrg,
  isApprover,
  normalizeRepoInputs,
  repoFromRequest,
  repoIdFromName,
  resolveRepoInput,
} from "@/lib/mc-data";
import type { Repo } from "@/lib/mc-data";
import {
  __repoValidationSettled,
  __setRepoValidatorForTests,
  addTask,
  allRepos,
  approveRepo,
  rejectRepo,
  repoRequests,
  requestRepo,
  resetStore,
  setTaskRepos,
  taskById,
} from "@/lib/mc-data/store";

beforeEach(() => resetStore());

describe("registry shape", () => {
  it("is exactly the canonical repos", () => {
    expect(Object.keys(REPOS).sort()).toEqual([
      "1hr-after",
      "agentic-swarm",
      "for-and-against",
      "furgenics",
      "local-inference",
      "plx-mc",
      "portal-web",
      "skills",
    ]);
  });

  it("carries honest metadata and no fabricated counts", () => {
    for (const repo of Object.values(REPOS)) {
      expect(repo).not.toHaveProperty("openPRs");
      expect(repo).not.toHaveProperty("openTasks");
      expect(ALLOWED_REPO_ORGS).toContain(repo.owner);
      expect(typeof repo.scope).toBe("string");
      expect(["public", "private"]).toContain(repo.visibility);
      expect(repo.def.length).toBeGreaterThan(0);
    }
  });

  it("keeps legacy platform repos on taylorvalton until EN-008 migration", () => {
    expect(REPOS["portal-web"].owner).toBe(REPO_ORG_PLX);
    expect(REPOS["plx-mc"].owner).toBe(REPO_ORG_PLX);
    expect(REPOS["agentic-swarm"].owner).toBe(REPO_ORG_PLX);
  });

  it("registers new repos on the PLX org slug", () => {
    for (const id of ["local-inference", "for-and-against", "furgenics", "1hr-after"]) {
      expect(REPOS[id].owner).toBe(REPO_ORG_PLX);
    }
  });

  it("keeps portal-web as the plx-customer-portal id the seeds reference", () => {
    expect(REPOS["portal-web"].name).toBe("plx-customer-portal");
  });

  it("registers skills and matches fleet GitHub visibility", () => {
    expect(REPOS.skills).toMatchObject({
      name: "skills",
      owner: REPO_ORG_PLX,
      visibility: "public",
    });
    for (const id of [
      "plx-mc",
      "skills",
      "local-inference",
      "1hr-after",
      "furgenics",
      "for-and-against",
    ]) {
      expect(REPOS[id].visibility).toBe("public");
    }
    expect(REPOS["portal-web"].visibility).toBe("private");
    expect(REPOS["agentic-swarm"].visibility).toBe("private");
  });
});

describe("backfill", () => {
  it("attaches plx-customer-portal to every bucket", () => {
    for (const bucket of BUCKETS) expect(bucket.repos).toEqual(["portal-web"]);
  });

  it("attaches plx-customer-portal to every seeded task", () => {
    for (const task of TASKS) expect(task.repos).toEqual(["portal-web"]);
  });
});

describe("isApprover", () => {
  it("accepts Owner/Admin humans only", () => {
    expect(isApprover(HUMANS.vince)).toBe(true); // Owner
    expect(isApprover(HUMANS.greg)).toBe(false); // Contributor
    expect(isApprover(AGENTS.vibes)).toBe(false); // agents never approve
    expect(isApprover(undefined)).toBe(false);
  });

  it("delegates to the permissions repo.approve capability (compatibility shim)", () => {
    // Owner/Admin directory roles map to access roles that grant repo.approve;
    // agents and contributors remain denied. Synchronous caller contract preserved.
    expect(isApprover({ ...HUMANS.vince, role: "Admin" })).toBe(true);
    expect(isApprover({ ...HUMANS.greg, role: "Contributor" })).toBe(false);
    expect(isApprover({ ...AGENTS.vibes })).toBe(false);
  });
});

describe("allow-list helpers", () => {
  it("permits legacy and PLX org slugs during phased migration", () => {
    expect(isAllowedRepoOrg(REPO_ORG_LEGACY)).toBe(true);
    expect(isAllowedRepoOrg(REPO_ORG_PLX)).toBe(true);
    expect(isAllowedRepoOrg("random-corp")).toBe(false);
  });

  it("recognizes registry repos and rejects unknowns", () => {
    expect(isAllowedRepo("portal-web", REPOS)).toBe(true);
    expect(isAllowedRepo("ghost", REPOS)).toBe(false);
    expect(disallowedRepos(["portal-web", "ghost"], REPOS)).toEqual(["ghost"]);
    expect(allowedReposOnly(["portal-web", "ghost"], REPOS)).toEqual(["portal-web"]);
  });

  it("derives a kebab-case id from a repo name", () => {
    expect(repoIdFromName("PLX_MC")).toBe("plx-mc");
    expect(repoIdFromName("  My New Repo ")).toBe("my-new-repo");
  });
});

describe("resolveRepoInput / normalizeRepoInputs", () => {
  it("resolves registry id, unique name, and owner/name slug to portal-web", () => {
    expect(resolveRepoInput("portal-web", REPOS)).toEqual({ ok: true, id: "portal-web" });
    expect(resolveRepoInput("plx-customer-portal", REPOS)).toEqual({ ok: true, id: "portal-web" });
    expect(resolveRepoInput("petralabx/plx-customer-portal", REPOS)).toEqual({
      ok: true,
      id: "portal-web",
    });
    expect(resolveRepoInput("  PetraLabX/PLX-Customer-Portal  ", REPOS)).toEqual({
      ok: true,
      id: "portal-web",
    });
  });

  it("normalizes mixed inputs and de-dupes to registry ids", () => {
    expect(
      normalizeRepoInputs(
        ["portal-web", "plx-customer-portal", "petralabx/plx-customer-portal", "plx-mc"],
        REPOS
      )
    ).toEqual({ ids: ["portal-web", "plx-mc"], rejected: [] });
  });

  it("keeps unknown slugs fail-closed (no silent invent)", () => {
    const result = resolveRepoInput("petralabx/not-a-real-repo", REPOS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("not a registry id");
      expect(result.message).toContain("petralabx/not-a-real-repo");
    }
    expect(disallowedRepos(["petralabx/not-a-real-repo"], REPOS)).toEqual([
      "petralabx/not-a-real-repo",
    ]);
    expect(allowedReposOnly(["petralabx/not-a-real-repo"], REPOS)).toEqual([]);
  });

  it("rejects ambiguous bare names with a clear message", () => {
    const twin: Repo = {
      id: "portal-web-fork",
      name: "plx-customer-portal",
      lang: "TypeScript",
      def: "main",
      owner: REPO_ORG_LEGACY,
      visibility: "private",
      scope: "ambiguous-name fixture",
    };
    const registry = { ...REPOS, "portal-web-fork": twin };
    const result = resolveRepoInput("plx-customer-portal", registry);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("matches multiple registry repos");
      expect(result.message).toContain("portal-web");
      expect(result.message).toContain("portal-web-fork");
    }
  });

  it("suggests a registry id when a slug name matches but owner does not", () => {
    const result = resolveRepoInput("wrong-org/plx-customer-portal", REPOS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("Did you mean `portal-web`?");
    }
  });
});

describe("repoFromRequest", () => {
  it("builds an honest registry repo from an approved request", () => {
    const repo = repoFromRequest({
      id: "RR-1",
      name: "My Repo",
      owner: REPO_ORG_PLX,
      visibility: "public",
      def: "trunk",
      lang: "Go",
      scope: "scope text",
      requestedBy: "vince",
      requestedTs: "—",
      status: "pending",
      verified: true,
    });
    expect(repo.id).toBe("my-repo");
    expect(repo.visibility).toBe("public");
    expect(repo.def).toBe("trunk");
    expect(repo.lang).toBe("Go");
  });
});

describe("addTask allow-list enforcement", () => {
  it("drops repos that are not in the registry", () => {
    const task = addTask({ title: "t", bucket: "BKT-WMS", repos: ["portal-web", "not-a-repo"] });
    expect(task.repos).toEqual(["portal-web"]);
  });
});

describe("setTaskRepos — edit a task's repos post-create (EN-005)", () => {
  it("keeps only registry repos and de-dupes when editing", () => {
    setTaskRepos("TASK-221", ["portal-web", "agentic-swarm", "agentic-swarm", "ghost"]);
    expect(taskById("TASK-221")?.repos).toEqual(["portal-web", "agentic-swarm"]);
  });

  it("can clear a task's repos", () => {
    setTaskRepos("TASK-222", []);
    expect(taskById("TASK-222")?.repos).toEqual([]);
  });
});

describe("self-service request → approve", () => {
  it("verifies a request against the GitHub org (mocked) then an approver adds it", async () => {
    __setRepoValidatorForTests(async () => ({ ok: true, visibility: "public", def: "main", lang: "TypeScript" }));
    const req = requestRepo({ name: "new-tool", scope: "a new tool" });
    await __repoValidationSettled();

    const validated = repoRequests().find((r) => r.id === req.id)!;
    expect(validated.verified).toBe(true);
    expect(validated.visibility).toBe("public");
    expect(allRepos()["new-tool"]).toBeUndefined(); // not in the registry until approved

    expect(approveRepo(req.id)).toBe(true); // vince is Owner
    expect(repoRequests().find((r) => r.id === req.id)?.status).toBe("approved");
    expect(allRepos()["new-tool"]?.name).toBe("new-tool");
  });

  it("marks an unvalidated repo pending/unverified rather than fabricating it", async () => {
    __setRepoValidatorForTests(async () => ({ ok: false, note: "not found in the org" }));
    const req = requestRepo({ name: "ghost-repo" });
    await __repoValidationSettled();

    const r = repoRequests().find((x) => x.id === req.id)!;
    expect(r.verified).toBe(false);
    expect(r.status).toBe("pending");
    expect(r.note).toContain("not found");
  });

  it("refuses to approve an unverified request even for an approver (repo_unverified guard)", async () => {
    __setRepoValidatorForTests(async () => ({ ok: false, note: "not found in the org" }));
    const req = requestRepo({ name: "unverified-repo" });
    await __repoValidationSettled();
    expect(repoRequests().find((r) => r.id === req.id)?.verified).toBe(false);

    expect(approveRepo(req.id)).toBe(false); // vince is Owner, but the repo is unverified
    expect(repoRequests().find((r) => r.id === req.id)?.status).toBe("pending");
    expect(allRepos()["unverified-repo"]).toBeUndefined();
  });

  it("rejects a request for a disallowed GitHub org", () => {
    const req = requestRepo({ name: "evil-corp-tool", owner: "evil-corp" });
    expect(req.verified).toBe(false);
    expect(req.note).toContain("not allowed");
    expect(allRepos()["evil-corp-tool"]).toBeUndefined();
  });

  it("defaults new repo requests to the PLX org slug", () => {
    const req = requestRepo({ name: "new-brand-site" });
    expect(req.owner).toBe(DEFAULT_NEW_REPO_ORG);
  });

  it("rejects a request without adding it to the registry", () => {
    const req = requestRepo({ name: "wontfix" });
    expect(rejectRepo(req.id)).toBe(true);
    expect(repoRequests().find((r) => r.id === req.id)?.status).toBe("rejected");
    expect(allRepos()["wontfix"]).toBeUndefined();
  });

  it("blocks approve/reject for non-approvers", () => {
    const req = requestRepo({ name: "needs-owner" });
    expect(approveRepo(req.id, "greg")).toBe(false); // Contributor
    expect(approveRepo(req.id, "vibes")).toBe(false); // agent
    expect(rejectRepo(req.id, "greg")).toBe(false);
    expect(repoRequests().find((r) => r.id === req.id)?.status).toBe("pending");
  });
});
