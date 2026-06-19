// Invariant tests for the repo registry, allow-list governance, and the
// self-service request → approve flow (EN-002 / WS-2). These protect behavior
// (registry shape, backfill correctness, allow-list rejection, request
// transitions, GitHub-validation reconcile), not fixture shape. GitHub
// validation is mocked through the store's injectable validator seam.
import { beforeEach, describe, expect, it } from "vitest";

import {
  AGENTS,
  BUCKETS,
  HUMANS,
  REPOS,
  REPO_ORG,
  TASKS,
  allowedReposOnly,
  disallowedRepos,
  isAllowedRepo,
  isApprover,
  repoFromRequest,
  repoIdFromName,
} from "@/lib/mc-data";
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
  it("is exactly the three canonical repos", () => {
    expect(Object.keys(REPOS).sort()).toEqual(["agentic-swarm", "plx-mc", "portal-web"]);
  });

  it("carries honest metadata and no fabricated counts", () => {
    for (const repo of Object.values(REPOS)) {
      expect(repo).not.toHaveProperty("openPRs");
      expect(repo).not.toHaveProperty("openTasks");
      expect(repo.owner).toBe(REPO_ORG);
      expect(typeof repo.scope).toBe("string");
      expect(["public", "private"]).toContain(repo.visibility);
      expect(repo.def.length).toBeGreaterThan(0);
    }
  });

  it("keeps portal-web as the plx-customer-portal id the seeds reference", () => {
    expect(REPOS["portal-web"].name).toBe("plx-customer-portal");
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
});

describe("allow-list helpers", () => {
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

describe("repoFromRequest", () => {
  it("builds an honest registry repo from an approved request", () => {
    const repo = repoFromRequest({
      id: "RR-1",
      name: "My Repo",
      owner: REPO_ORG,
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
