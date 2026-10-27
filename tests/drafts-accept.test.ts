// Draft Projects Accept (step 3): only the author, signed in, accepts the
// version they read; an open blocking finding, unsubmitted edits or a moved
// version refuses it; Accept creates the project, buckets and tasks through the
// create functions, in dependency order, with the frozen version's link as their
// PRD; a failed Accept resumes without creating anything twice, adopts a record
// a crashed Accept made, and a running Accept refuses a second one.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/compliance/repo", () => ({ appendEvent: vi.fn(async () => "1") }));

import { HUMANS } from "@/lib/mc-data/data";
import type { Bucket, Project, Repo, Task } from "@/lib/mc-data/types";
import { acceptDraft, draftLink, type AcceptDeps } from "@/lib/drafts/accept";
import { completenessIssues, preflightIssues } from "@/lib/drafts/preflight";
import { draftPlanSchema, draftResearchSchema } from "@/lib/drafts/schema";
import { closeFinding, createDraft, reviewDraft, saveDraft, submitDraft, type DraftActor } from "@/lib/drafts/service";
import { __resetDraftsMemoryForTests, getDraft, mutateDraft } from "@/lib/drafts/store";
import type { DraftPlan, DraftResearch } from "@/lib/drafts/types";
import { principalFromTokens } from "@/lib/permissions/project-acl";

const OPEN: Project = { id: "PRJ-OPEN", name: "Open", owner: "vince", health: "track", target: "—", started: "", desc: "", repos: [], sync: { state: "synced", ts: "", sp: "" }, prd: null };

interface Calls {
  projects: Record<string, unknown>[];
  buckets: Record<string, unknown>[];
  tasks: Record<string, unknown>[];
}

function deps(calls: Calls, overrides: Partial<AcceptDeps> = {}): AcceptDeps {
  let bucketSeq = 0;
  let taskSeq = 100;
  return {
    registry: async () => ({ "plx-mc": { id: "plx-mc", name: "PLX_MC" } as Repo }),
    projects: async () => [OPEN],
    buckets: async () => [],
    openTasks: async () => [],
    humans: () => Object.values(HUMANS),
    liveProjects: async () => [OPEN],
    liveBuckets: async () => [],
    createProject: vi.fn(async (input) => {
      calls.projects.push(input as never);
      return { ...OPEN, id: "PRJ-NEW", name: input.name, prd: input.prd ?? null } as Project;
    }),
    createBucket: vi.fn(async (input) => {
      calls.buckets.push(input as never);
      bucketSeq += 1;
      return { id: `BKT-${bucketSeq}`, name: input.name, project: input.project, prd: input.prd } as Bucket;
    }),
    createTask: vi.fn(async (input, _attr, options) => {
      calls.tasks.push(input as never);
      taskSeq += 1;
      const task = { id: `TASK-${taskSeq}`, ...input } as unknown as Task;
      await options?.inTransaction?.(vi.fn() as never, task);
      return task;
    }),
    ...overrides,
  };
}

const agent: DraftActor = { kind: "agent", email: "vince@petrasoap.com", principalId: "sp_mcp_claude_code", acl: { ...principalFromTokens("sp_mcp_claude_code", "vince@petrasoap.com"), principalOnlyTokens: ["sp_mcp_claude_code"] } };
const person = (email: string): DraftActor => ({ kind: "human", email, principalId: `oid-${email}`, acl: principalFromTokens(email, `oid-${email}`) });
const vince = person("vince@petrasoap.com");

const plan = draftPlanSchema.parse({
  project: { name: "Draft Projects", owner: "vince@petrasoap.com", repos: ["plx-mc"] },
  buckets: [
    { key: "B1", name: "Storage", owner: "vince" },
    { key: "B2", name: "Screen", owner: "stephen@petrasoap.com" },
  ],
  tasks: [
    { key: "T2", bucket: "B2", title: "Drafts screen", dependsOn: ["T1", "TASK-3953"], accountableOwner: "ricardo" },
    { key: "T1", bucket: "B1", title: "Drafts tables", kind: "code", priority: "high" },
  ],
}) as DraftPlan;
const research = draftResearchSchema.parse({
  summary: "Reviewable plans.",
  recommendation: "Separate tables.",
  approaches: [
    { name: "Separate tables", chosen: true },
    { name: "Status on projects" },
  ],
}) as DraftResearch;

async function inReview(extra: { visibility?: "restricted"; members?: string[]; plan?: DraftPlan } = {}) {
  const draft = await createDraft(agent, { title: "Draft Projects", plan: extra.plan ?? plan, research, ...extra });
  return (await submitDraft(agent, draft.id, deps({ projects: [], buckets: [], tasks: [] }))).draft;
}

beforeEach(() => {
  __resetDraftsMemoryForTests();
});

describe("who accepts", () => {
  it("is the author in person: never an agent, never another person", async () => {
    const draft = await inReview();
    const calls: Calls = { projects: [], buckets: [], tasks: [] };
    await expect(acceptDraft(agent, draft.id, 1, deps(calls))).rejects.toMatchObject({ status: 403 });
    await expect(acceptDraft(person("ricardo@petrasoap.com"), draft.id, 1, deps(calls))).rejects.toMatchObject({ code: "not_draft_author", status: 403 });
    expect(calls).toEqual({ projects: [], buckets: [], tasks: [] });
  });
});

describe("guards", () => {
  it("waits for every blocking finding to close, then accepts", async () => {
    const draft = await inReview();
    const { review } = await reviewDraft(person("stephen@petrasoap.com"), draft.id, { kind: "finding", version: 1, body: "Split B2.", blocking: true });
    const calls: Calls = { projects: [], buckets: [], tasks: [] };
    await expect(acceptDraft(vince, draft.id, 1, deps(calls))).rejects.toMatchObject({ code: "blocking_findings", status: 409 });
    expect(calls.projects).toEqual([]);
    await closeFinding(person("stephen@petrasoap.com"), draft.id, review.id, "resolve", null);
    await expect(acceptDraft(vince, draft.id, 1, deps(calls))).resolves.toMatchObject({ alreadyAccepted: false });
  });

  it("refuses a version the author did not read, and unsubmitted edits", async () => {
    const draft = await inReview();
    const calls: Calls = { projects: [], buckets: [], tasks: [] };
    await expect(acceptDraft(vince, draft.id, 2, deps(calls))).rejects.toMatchObject({ code: "draft_version_moved" });
    await saveDraft(agent, draft.id, { title: "Edited" });
    await expect(acceptDraft(vince, draft.id, 1, deps(calls))).rejects.toMatchObject({ code: "draft_not_in_review" });
    await submitDraft(agent, draft.id, deps(calls));
    await expect(acceptDraft(vince, draft.id, 1, deps(calls))).rejects.toMatchObject({ code: "draft_version_moved" });
    expect(calls.projects).toEqual([]);
  });

  it("re-runs preflight: a parent project closed during review refuses", async () => {
    const onOpen = draftPlanSchema.parse({ ...plan, project: { existing: "PRJ-OPEN" } }) as DraftPlan;
    const draft = await inReview({ plan: onOpen });
    const calls: Calls = { projects: [], buckets: [], tasks: [] };
    const closed = deps(calls, { projects: async () => [{ ...OPEN, status: "closed" }] });
    await expect(acceptDraft(vince, draft.id, 1, closed)).rejects.toMatchObject({ code: "draft_not_ready", status: 422 });
    expect(calls.buckets).toEqual([]);
  });

  it("refuses a dependency cycle at submit", () => {
    const cyclic = draftPlanSchema.parse({
      ...plan,
      tasks: [
        { key: "T1", bucket: "B1", title: "a", dependsOn: ["T2"] },
        { key: "T2", bucket: "B1", title: "b", dependsOn: ["T1"] },
      ],
    }) as DraftPlan;
    const content = { title: "x", plan: cyclic, research };
    expect(completenessIssues(content)).toEqual([]);
    expect(
      preflightIssues(content, { registry: { "plx-mc": { id: "plx-mc" } as Repo }, projects: [OPEN], humans: Object.values(HUMANS), principal: principalFromTokens() }).map((i) => i.code)
    ).toContain("dependency_cycle");
  });
});

describe("what Accept creates", () => {
  it("creates the project, its buckets and its tasks in dependency order, linked to the frozen version", async () => {
    const draft = await inReview();
    const calls: Calls = { projects: [], buckets: [], tasks: [] };
    const result = await acceptDraft(vince, draft.id, 1, deps(calls));
    const link = draftLink(draft.id, 1);
    expect(result.created).toEqual({ P: "PRJ-NEW", B1: "BKT-1", B2: "BKT-2", T1: "TASK-101", T2: "TASK-102" });
    expect(calls.projects).toEqual([expect.objectContaining({ name: "Draft Projects", owner: "vince", prd: link, visibility: "shared" })]);
    expect(calls.buckets).toEqual([
      expect.objectContaining({ name: "Storage", owner: "vince", prd: link, project: "PRJ-NEW" }),
      expect.objectContaining({ name: "Screen", owner: "stephen", prd: link, project: "PRJ-NEW" }),
    ]);
    // T1 first: T2 depends on it.
    expect(calls.tasks.map((t) => t.title)).toEqual(["Drafts tables", "Drafts screen"]);
    expect(calls.tasks[0]).toMatchObject({ bucket: "BKT-1", priority: "high", kind: "code", reporter: "vince@petrasoap.com", accountableOwner: "vince", labels: [`draft:${draft.id}`] });
    expect(calls.tasks[1]).toMatchObject({
      bucket: "BKT-2",
      accountableOwner: "ricardo",
      labels: [`draft:${draft.id}`, "depends-on:TASK-101", "depends-on:TASK-3953"],
      description: expect.stringContaining(link),
    });
    const stored = await getDraft(draft.id);
    expect(stored).toMatchObject({ status: "accepted", acceptedBy: "vince@petrasoap.com", materialized: result.created });
    await expect(acceptDraft(vince, draft.id, 1, deps(calls))).resolves.toMatchObject({ alreadyAccepted: true, created: result.created });
    expect(calls.projects).toHaveLength(1);
  });

  it("adds to an existing project without creating one, and keeps a restricted draft restricted", async () => {
    const onOpen = draftPlanSchema.parse({ ...plan, project: { existing: "PRJ-OPEN" } }) as DraftPlan;
    const draft = await inReview({ plan: onOpen });
    const calls: Calls = { projects: [], buckets: [], tasks: [] };
    expect((await acceptDraft(vince, draft.id, 1, deps(calls))).created.P).toBe("PRJ-OPEN");
    expect(calls.projects).toEqual([]);
    expect(calls.buckets.every((b) => b.project === "PRJ-OPEN")).toBe(true);

    const secret = await inReview({ visibility: "restricted", members: ["stephen@petrasoap.com"] });
    const secretCalls: Calls = { projects: [], buckets: [], tasks: [] };
    await acceptDraft(vince, secret.id, 1, deps(secretCalls));
    expect(secretCalls.projects[0]).toMatchObject({ visibility: "restricted", members: ["stephen@petrasoap.com", "vince@petrasoap.com"] });
  });
});

describe("resume", () => {
  it("releases its claim on a failure, and the retry creates only what is missing", async () => {
    const draft = await inReview();
    const calls: Calls = { projects: [], buckets: [], tasks: [] };
    let fail = true;
    const flaky = deps(calls);
    const real = flaky.createTask;
    flaky.createTask = vi.fn(async (input, attr, options) => {
      if (input.title === "Drafts screen" && fail) {
        fail = false;
        throw new Error("database went away");
      }
      return real(input, attr, options);
    }) as AcceptDeps["createTask"];
    await expect(acceptDraft(vince, draft.id, 1, flaky)).rejects.toThrow("database went away");
    const half = await getDraft(draft.id);
    expect(half).toMatchObject({ status: "in_review", acceptedAt: null, materialized: { P: "PRJ-NEW", B1: "BKT-1", B2: "BKT-2", T1: "TASK-101" } });
    const done = await acceptDraft(vince, draft.id, 1, flaky);
    expect(done.created.T2).toBeDefined();
    expect(calls.projects).toHaveLength(1);
    expect(calls.buckets).toHaveLength(2);
    expect(calls.tasks.filter((t) => t.title === "Drafts tables")).toHaveLength(1);
  });

  it("adopts a project and bucket a crashed Accept made, found by their PRD link", async () => {
    const draft = await inReview();
    const link = draftLink(draft.id, 1);
    const calls: Calls = { projects: [], buckets: [], tasks: [] };
    const crashed = deps(calls, {
      liveProjects: async () => [OPEN, { ...OPEN, id: "PRJ-MADE", prd: link }],
      liveBuckets: async () => [{ id: "BKT-MADE", name: "Storage", project: "PRJ-MADE", prd: new URL(link).href } as Bucket],
    });
    const result = await acceptDraft(vince, draft.id, 1, crashed);
    expect(result.created).toMatchObject({ P: "PRJ-MADE", B1: "BKT-MADE" });
    expect(calls.projects).toEqual([]);
    expect(calls.buckets.map((b) => b.name)).toEqual(["Screen"]);
  });

  it("refuses a second Accept while one runs, and takes over a stale claim", async () => {
    const draft = await inReview();
    await mutateDraft(draft.id, (d) => ({ draft: { ...d, acceptedAt: new Date().toISOString(), acceptedBy: "vince@petrasoap.com" } }));
    const calls: Calls = { projects: [], buckets: [], tasks: [] };
    await expect(acceptDraft(vince, draft.id, 1, deps(calls))).rejects.toMatchObject({ code: "accept_in_progress", status: 409 });
    // Nothing changes the draft while an Accept runs: no edit, no review.
    await expect(saveDraft(agent, draft.id, { title: "Changed mid-Accept" })).rejects.toMatchObject({ code: "accept_in_progress" });
    await expect(reviewDraft(person("ricardo@petrasoap.com"), draft.id, { kind: "finding", version: 1, body: "Too late to block.", blocking: true })).rejects.toMatchObject({ code: "accept_in_progress" });
    await mutateDraft(draft.id, (d) => ({ draft: { ...d, acceptedAt: new Date(Date.now() - 11 * 60_000).toISOString() } }));
    await expect(acceptDraft(vince, draft.id, 1, deps(calls))).resolves.toMatchObject({ alreadyAccepted: false });
  });
});
