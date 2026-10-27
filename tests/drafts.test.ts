// Draft Projects (TASK-4059): the invariants the PRD sets, on the process-local
// store (no database). A version's digest is its identity; submit refuses an
// incomplete or failing plan and freezes nothing; only the writer changes a
// draft; a restricted draft is hidden from non-members; reviews bind to the
// version they were given on; a blocking finding stays open until its raiser
// resolves it or the author, in person, closes it; agents never accept.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/compliance/repo", () => ({ appendEvent: vi.fn(async () => "1") }));

import { HUMANS } from "@/lib/mc-data/data";
import type { Project, Repo, Task } from "@/lib/mc-data/types";
import { likelyDuplicates, titleTokens } from "@/lib/drafts/duplicates";
import { completenessIssues, isKnownPerson, preflightIssues, type PreflightContext } from "@/lib/drafts/preflight";
import { canonicalJson, draftDigest, draftPlanSchema, draftResearchSchema } from "@/lib/drafts/schema";
import {
  closeFinding,
  createDraft,
  getVisibleDraft,
  listVisibleDrafts,
  needsReviewFrom,
  reviewDraft,
  saveDraft,
  submitDraft,
  withdrawDraft,
  type DraftActor,
  type DraftDeps,
} from "@/lib/drafts/service";
import * as draftStore from "@/lib/drafts/store";
import { __resetDraftsMemoryForTests, getDraftVersion } from "@/lib/drafts/store";
import { emptyDraftContent, openBlockingFindings, type DraftContent, type DraftPlan, type DraftResearch } from "@/lib/drafts/types";
import { capabilitiesForRole, capabilitiesForServicePrincipal } from "@/lib/permissions";
import { principalFromTokens } from "@/lib/permissions/project-acl";

const REGISTRY = { "plx-mc": { id: "plx-mc", name: "PLX_MC" } as Repo };
const OPEN: Project = { id: "PRJ-OPEN", name: "Open", owner: "vince", health: "track", target: "—", started: "", desc: "", repos: [], sync: { state: "synced", ts: "", sp: "" }, prd: null };
const CLOSED: Project = { ...OPEN, id: "PRJ-CLOSED", status: "closed" };
const ARCHIVED: Project = { ...OPEN, id: "PRJ-ARCHIVED", archivedAt: "2026-10-01", archivedBy: "vince", archiveReason: "done" };
const SECRET: Project = { ...OPEN, id: "PRJ-SECRET", visibility: "restricted", members: ["ricardo@petrasoap.com"] };

function deps(openTasks: Partial<Task>[] = []): DraftDeps {
  return {
    registry: async () => REGISTRY,
    projects: async () => [OPEN, CLOSED, ARCHIVED, SECRET],
    buckets: async () => [
      { id: "BKT-SECRET", project: "PRJ-SECRET" } as never,
      { id: "BKT-OPEN", project: "PRJ-OPEN" } as never,
      { id: "BKT-ORPHAN", project: "PRJ-GONE" } as never,
    ],
    openTasks: async () => openTasks as Task[],
    humans: () => Object.values(HUMANS),
  };
}

const agent = (email = "vince@petrasoap.com", principal = "sp_mcp_claude_code"): DraftActor => ({
  kind: "agent",
  email,
  principalId: principal,
  acl: principalFromTokens(principal),
});
const human = (email: string): DraftActor => ({ kind: "human", email, principalId: `oid-${email}`, acl: principalFromTokens(email, `oid-${email}`) });
/** An agent under the shadow rollout: its operator email counts as a token, as aclPrincipalFromMcp gives today. */
const shadowAgent = (email: string, principal = "sp_mcp_claude_code"): DraftActor => ({
  kind: "agent",
  email,
  principalId: principal,
  acl: { ...principalFromTokens(principal, email), principalOnlyTokens: [principal] },
});

const plan: DraftPlan = draftPlanSchema.parse({
  project: { name: "Draft Projects", owner: "vince", repos: ["plx-mc"] },
  buckets: [{ key: "B1", name: "Storage and tools", owner: "vince", repos: ["plx-mc"] }],
  tasks: [
    { key: "T1", bucket: "B1", title: "Drafts storage migration", repos: ["plx-mc"] },
    { key: "T2", bucket: "B1", title: "Draft review screen", dependsOn: ["T1"] },
  ],
}) as DraftPlan;

const research: DraftResearch = draftResearchSchema.parse({
  summary: "Put reviewable plans in Mission Control.",
  recommendation: "Separate tables; accept through the create functions.",
  approaches: [
    { name: "Separate tables", chosen: true },
    { name: "Status on projects", chosen: false },
  ],
  sources: [{ ref: "[1]", title: "PRD", kind: "internal", url: "docs/product/PRD-draft-projects.md" }],
  findings: [{ text: "Live surfaces read projects.", sources: ["[1]"] }],
}) as DraftResearch;

const content = (): DraftContent => ({ title: "Draft Projects", plan: structuredClone(plan), research: structuredClone(research) });
const ctx = (principal = principalFromTokens("sp_mcp_claude_code")): PreflightContext => ({
  registry: REGISTRY,
  projects: [OPEN, CLOSED, ARCHIVED, SECRET],
  humans: Object.values(HUMANS),
  principal,
});

async function submitted(actor = agent()) {
  const draft = await createDraft(actor, { title: "Draft Projects", plan, research, reviewers: ["ricardo"] });
  return (await submitDraft(actor, draft.id, deps())).draft;
}

beforeEach(() => {
  __resetDraftsMemoryForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("digest", () => {
  it("is the same for the same content in any key order, and changes with the content", () => {
    const a = content();
    const reordered = JSON.parse(JSON.stringify({ research: a.research, plan: a.plan, title: a.title })) as DraftContent;
    expect(canonicalJson(reordered)).toBe(canonicalJson(a));
    expect(draftDigest(reordered)).toBe(draftDigest(a));
    expect(draftDigest(a)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(draftDigest({ ...a, title: "Other" })).not.toBe(draftDigest(a));
  });
});

describe("validation", () => {
  it("refuses duplicate plan keys and a task in a non-draft bucket", () => {
    expect(draftPlanSchema.safeParse({ buckets: [{ key: "B1" }, { key: "B1" }] }).success).toBe(false);
    expect(draftPlanSchema.safeParse({ buckets: [{ key: "B1" }], tasks: [{ key: "T1", bucket: "BKT-INFRA" }] }).success).toBe(false);
  });

  it("takes only http(s) links, and scheme-less internal refs for sources; never javascript: or data:", () => {
    const art = (url: string) => draftResearchSchema.safeParse({ artifacts: [{ kind: "diagram", name: "x", url }] }).success;
    expect(art("https://example.com/a.svg")).toBe(true);
    expect(art("javascript:alert(1)//x")).toBe(false);
    expect(art("data:text/html,<script>alert(1)</script>")).toBe(false);
    const src = (url: string) => draftResearchSchema.safeParse({ sources: [{ ref: "[1]", title: "x", kind: "internal", url }] }).success;
    for (const ok of ["", "https://learn.microsoft.com/x", "docs/product/PRD-draft-projects.md", "src/lib/sync/state.ts:376", "TASK-3953"]) {
      expect({ ok, valid: src(ok) }).toEqual({ ok, valid: true });
    }
    for (const bad of ["javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,x", "vbscript:x", "file:///etc/passwd"]) {
      expect({ bad, valid: src(bad) }).toEqual({ bad, valid: false });
    }
  });

  it("refuses a NUL character, which Postgres jsonb cannot store", () => {
    expect(draftResearchSchema.safeParse({ summary: "a\u0000b" }).success).toBe(false);
    expect(draftPlanSchema.safeParse({ buckets: [{ key: "B1", name: "x\u0000" }] }).success).toBe(false);
    expect(draftResearchSchema.safeParse({ artifacts: [{ kind: "markdown", name: "x", inline: "\u0000" }] }).success).toBe(false);
  });

  it("takes an artifact as a link or inline content, never both or neither", () => {
    const art = (a: object) => draftResearchSchema.safeParse({ artifacts: [{ kind: "diagram", name: "x", ...a }] }).success;
    expect(art({ url: "https://example.com/a.svg" })).toBe(true);
    expect(art({ inline: "graph TD; A-->B" })).toBe(true);
    expect(art({})).toBe(false);
    expect(art({ url: "https://example.com/a.svg", inline: "x" })).toBe(false);
  });
});

describe("preflight", () => {
  it("passes a sound plan", () => {
    expect(preflightIssues(content(), ctx())).toEqual([]);
    expect(completenessIssues(content())).toEqual([]);
  });

  it("names repos outside the allow-list, unknown owners, missing buckets and dependencies", () => {
    const c = content();
    c.plan.project.owner = "someone@gmail.com";
    c.plan.buckets[0].repos = ["not-a-repo"];
    c.plan.tasks[0].bucket = "B9";
    c.plan.tasks[1].dependsOn = ["T7", "T2"];
    const codes = preflightIssues(c, ctx()).map((i) => `${i.code}@${i.path}`);
    expect(codes).toEqual(
      expect.arrayContaining([
        "unknown_owner@plan.project.owner",
        "repo_not_allowed@plan.buckets[B1].repos",
        "unknown_bucket@plan.tasks[T1].bucket",
        "unknown_dependency@plan.tasks[T2].dependsOn",
        "self_dependency@plan.tasks[T2].dependsOn",
      ])
    );
  });

  it("refuses a closed, archived or missing parent project, and treats a hidden one as missing", () => {
    const codeFor = (existing: string, principal?: ReturnType<typeof principalFromTokens>) => {
      const c = content();
      c.plan.project.existing = existing;
      return preflightIssues(c, ctx(principal)).map((i) => i.code);
    };
    expect(codeFor("PRJ-OPEN")).toEqual([]);
    expect(codeFor("PRJ-CLOSED")).toEqual(["project_closed"]);
    expect(codeFor("PRJ-ARCHIVED")).toEqual(["project_archived"]);
    expect(codeFor("PRJ-NOPE")).toEqual(["unknown_project"]);
    expect(codeFor("PRJ-SECRET")).toEqual(["unknown_project"]);
    expect(codeFor("PRJ-SECRET", principalFromTokens("ricardo@petrasoap.com"))).toEqual([]);
  });

  it("needs two approaches with exactly one chosen, and findings that cite real sources", () => {
    const c = content();
    c.research.approaches = [c.research.approaches[0]];
    c.research.findings = [{ text: "x", sources: ["[9]"] }, { text: "Uncited.", sources: [] }];
    expect(completenessIssues(c).map((i) => i.code)).toEqual(["approaches_required", "unknown_source_ref", "finding_uncited"]);
    c.research.approaches = [
      { ...research.approaches[0], chosen: true },
      { ...research.approaches[1], chosen: true },
    ];
    expect(completenessIssues(c).map((i) => i.code)).toContain("one_approach_chosen");
    expect(completenessIssues(emptyDraftContent("x")).map((i) => i.code)).toEqual(
      expect.arrayContaining(["summary_required", "recommendation_required", "approaches_required", "tasks_required"])
    );
  });

  it("knows Petra people by directory id or email, and nobody else", () => {
    expect(isKnownPerson("ricardo", Object.values(HUMANS))).toBe(true);
    expect(isKnownPerson("tanush@petrasoap.com", Object.values(HUMANS))).toBe(true);
    expect(isKnownPerson("someone@gmail.com", Object.values(HUMANS))).toBe(false);
    expect(isKnownPerson("", Object.values(HUMANS))).toBe(false);
  });
});

describe("likely duplicates", () => {
  it("finds open tasks whose titles share most meaningful words", () => {
    expect([...titleTokens("Add the Drafts storage migration")]).toEqual(["drafts", "storage", "migration"]);
    const hits = likelyDuplicates(plan.tasks, [
      { id: "TASK-9", title: "Drafts storage migration (056)" },
      { id: "TASK-8", title: "Nav sidebar width" },
    ]);
    expect(hits).toEqual([expect.objectContaining({ key: "T1", taskId: "TASK-9" })]);
  });
});

describe("create, edit and submit", () => {
  it("makes the agent's person the author, and refuses anyone who is not a person in the directory", async () => {
    const draft = await createDraft(agent(), { title: "Draft Projects" });
    expect(draft).toMatchObject({ id: "DRF-1", status: "drafting", author: "vince@petrasoap.com", createdBy: "sp_mcp_claude_code", version: 0, digest: null });
    expect(draft.working.plan.project.name).toBe("Draft Projects");
    await expect(createDraft(agent("bot@example.com"), { title: "x" })).rejects.toMatchObject({ code: "invalid_author", status: 422 });
    // A service mailbox on Petra's domain is not a person: it cannot accept or dismiss in person.
    await expect(createDraft(agent("cos@petrasoap.com"), { title: "x" })).rejects.toMatchObject({ code: "invalid_author", status: 422 });
    // A directory id resolves to that person's email.
    expect((await createDraft(agent("ricardo"), { title: "y" })).author).toBe("ricardo@petrasoap.com");
  });

  it("refuses an incomplete draft and freezes nothing", async () => {
    const actor = agent();
    const draft = await createDraft(actor, { title: "Draft Projects", plan });
    await expect(submitDraft(actor, draft.id, deps())).rejects.toMatchObject({ code: "draft_not_ready", status: 422 });
    expect(await getDraftVersion(draft.id, 1)).toBeNull();
    expect((await getVisibleDraft(actor, draft.id)).status).toBe("drafting");
  });

  it("freezes version 1 under its digest, raises duplicates once, and does nothing on an unchanged resubmit", async () => {
    const actor = agent();
    const created = await createDraft(actor, { title: "Draft Projects", plan, research });
    const open = [{ id: "TASK-9", title: "Drafts storage migration", stage: "backlog", bucket: "BKT-OPEN" }];
    const first = await submitDraft(actor, created.id, deps(open as Partial<Task>[]));
    expect(first).toMatchObject({ frozen: true, duplicates: 1 });
    expect(first.draft).toMatchObject({ status: "in_review", version: 1, digest: draftDigest(content()) });
    const v1 = await getDraftVersion(created.id, 1);
    expect(v1).toMatchObject({ version: 1, digest: first.draft.digest, frozenBy: "vince@petrasoap.com" });
    expect(first.draft.reviews).toEqual([
      expect.objectContaining({ kind: "finding", source: "mc", blocking: false, target: "T1", status: "open", body: expect.stringContaining("TASK-9") }),
    ]);
    const again = await submitDraft(actor, created.id, deps(open as Partial<Task>[]));
    expect(again).toMatchObject({ frozen: false, duplicates: 0 });
    expect(again.draft.version).toBe(1);
  });

  it("keeps a dismissed duplicate dismissed across versions", async () => {
    const actor = agent();
    const created = await createDraft(actor, { title: "Draft Projects", plan, research });
    const open = [{ id: "TASK-9", title: "Drafts storage migration", stage: "backlog", bucket: "BKT-OPEN" }] as Partial<Task>[];
    const first = await submitDraft(actor, created.id, deps(open));
    const dup = first.draft.reviews[0];
    await closeFinding(human("vince@petrasoap.com"), created.id, dup.id, "dismiss", "Different scope from TASK-9.");
    await saveDraft(actor, created.id, { title: "Draft Projects, revised" });
    const second = await submitDraft(actor, created.id, deps(open));
    expect(second).toMatchObject({ frozen: true, duplicates: 0 });
    expect(second.draft.reviews.filter((r) => r.source === "mc")).toEqual([expect.objectContaining({ id: dup.id, status: "dismissed" })]);
  });

  it("never raises a restricted project's task as a duplicate", async () => {
    const actor = agent();
    const created = await createDraft(actor, { title: "Draft Projects", plan, research });
    const hidden = [{ id: "TASK-7", title: "Drafts storage migration", stage: "backlog", bucket: "BKT-SECRET" }];
    expect((await submitDraft(actor, created.id, deps(hidden as Partial<Task>[]))).duplicates).toBe(0);
  });

  it("fails closed on a missing parent: a task whose bucket or project the Hub does not hold is never raised", async () => {
    const actor = agent();
    const created = await createDraft(actor, { title: "Draft Projects", plan, research });
    const dangling = [
      { id: "TASK-8", title: "Drafts storage migration", stage: "backlog", bucket: "BKT-ORPHAN" },
      { id: "TASK-9", title: "Drafts storage migration", stage: "backlog", bucket: "BKT-GONE" },
    ];
    expect((await submitDraft(actor, created.id, deps(dangling as Partial<Task>[]))).duplicates).toBe(0);
  });

  it("returns an edited draft to drafting, and the next submit freezes version 2; older reviews go stale", async () => {
    const actor = agent();
    const draft = await submitted(actor);
    await reviewDraft(human("ricardo@petrasoap.com"), draft.id, { kind: "approve", version: 1, body: "Looks right." });
    const { draft: edited } = await saveDraft(actor, draft.id, { title: "Draft Projects v2" });
    expect(edited.status).toBe("drafting");
    const second = (await submitDraft(actor, draft.id, deps())).draft;
    expect(second).toMatchObject({ status: "in_review", version: 2 });
    expect(second.digest).not.toBe(draft.digest);
    expect(second.reviews[0].digest).toBe(draft.digest);
    expect((await getDraftVersion(draft.id, 1))?.content.title).toBe("Draft Projects");
  });

  it("takes no review while the working copy has edits that are not submitted", async () => {
    const actor = agent();
    const draft = await submitted(actor);
    await saveDraft(actor, draft.id, { title: "Draft Projects v2" });
    const ricardo = human("ricardo@petrasoap.com");
    await expect(reviewDraft(ricardo, draft.id, { kind: "approve", version: 1, body: "Looks right." })).rejects.toMatchObject({
      code: "draft_not_in_review",
      status: 409,
    });
    await submitDraft(actor, draft.id, deps());
    await expect(reviewDraft(ricardo, draft.id, { kind: "approve", version: 2, body: "Looks right." })).resolves.toMatchObject({ review: { version: 2 } });
  });

  it("lands a review only on the version its reviewer read", async () => {
    const actor = agent();
    const draft = await submitted(actor);
    await saveDraft(actor, draft.id, { title: "Draft Projects v2" });
    await submitDraft(actor, draft.id, deps());
    const ricardo = human("ricardo@petrasoap.com");
    await expect(reviewDraft(ricardo, draft.id, { kind: "approve", version: 1, body: "Read v1." })).rejects.toMatchObject({
      code: "draft_version_moved",
      status: 409,
    });
    const { review } = await reviewDraft(ricardo, draft.id, { kind: "approve", version: 2, body: "Read v2." });
    expect(review).toMatchObject({ version: 2 });
  });

  it("lets only the writer edit: the same principal acting for the same person", async () => {
    const draft = await createDraft(agent(), { title: "Draft Projects" });
    await expect(saveDraft(agent("vince@petrasoap.com", "sp_mcp_codex"), draft.id, { title: "x" })).rejects.toMatchObject({ code: "not_draft_writer" });
    await expect(saveDraft(agent("ricardo@petrasoap.com"), draft.id, { title: "x" })).rejects.toMatchObject({ code: "not_draft_writer" });
    await expect(saveDraft(human("vince@petrasoap.com"), draft.id, { title: "x" })).resolves.toMatchObject({ changed: true });
  });

  it("closes a withdrawn draft to every change", async () => {
    const actor = agent();
    const draft = await submitted(actor);
    await withdrawDraft(actor, draft.id, "Superseded by a smaller plan.");
    await expect(saveDraft(actor, draft.id, { title: "x" })).rejects.toMatchObject({ code: "draft_closed", status: 409 });
    await expect(reviewDraft(agent(), draft.id, { kind: "comment", version: 1, body: "x" })).rejects.toMatchObject({ code: "draft_closed" });
  });
});

describe("visibility", () => {
  it("hides a restricted draft from non-members as not found, and shows it to its members and author", async () => {
    const draft = await createDraft(shadowAgent("vince@petrasoap.com"), { title: "Secret plan", visibility: "restricted", members: ["sp_mcp_codex"] });
    await expect(getVisibleDraft(agent("ricardo@petrasoap.com", "sp_mcp_grok"), draft.id)).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(getVisibleDraft(agent("ricardo@petrasoap.com", "sp_mcp_codex"), draft.id)).resolves.toMatchObject({ id: draft.id });
    await expect(getVisibleDraft(human("vince@petrasoap.com"), draft.id)).resolves.toMatchObject({ id: draft.id });
    expect((await listVisibleDrafts(agent("ricardo@petrasoap.com", "sp_mcp_grok"))).map((d) => d.id)).toEqual([]);
    expect((await listVisibleDrafts(agent("ricardo@petrasoap.com", "sp_mcp_codex"))).map((d) => d.id)).toEqual([draft.id]);
  });

  it("never lets the writing principal stand in for its person: another person on the same key sees nothing", async () => {
    const draft = await createDraft(shadowAgent("vince@petrasoap.com"), { title: "Secret reorg", visibility: "restricted", members: ["vince@petrasoap.com"] });
    const sameKeyOtherPerson = shadowAgent("ricardo@petrasoap.com");
    await expect(getVisibleDraft(sameKeyOtherPerson, draft.id)).rejects.toMatchObject({ code: "not_found" });
    expect(await listVisibleDrafts(sameKeyOtherPerson, { status: "all" })).toEqual([]);
    // The author's own agent sees it through the author's email during the shadow rollout…
    await expect(getVisibleDraft(shadowAgent("vince@petrasoap.com"), draft.id)).resolves.toMatchObject({ id: draft.id });
    // …and under enforce (principal tokens only) only once its sp_* id is a member.
    await expect(getVisibleDraft(agent(), draft.id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("checks again under the lock: a draft restricted mid-call refuses its writer's save, submit and withdraw", async () => {
    const writer = agent();
    const draft = await createDraft(writer, { title: "Draft Projects", plan, research });
    const shared = await draftStore.getDraft(draft.id);
    await saveDraft(human("vince@petrasoap.com"), draft.id, { visibility: "restricted", members: ["stephen@petrasoap.com"] });
    // The writer's read raced the author's change: it still sees the shared copy.
    const read = vi.spyOn(draftStore, "getDraft").mockResolvedValue(shared);
    try {
      await expect(saveDraft(writer, draft.id, { title: "Changed" })).rejects.toMatchObject({ code: "not_found" });
      await expect(submitDraft(writer, draft.id, deps())).rejects.toMatchObject({ code: "not_found" });
      await expect(withdrawDraft(writer, draft.id, "No longer needed.")).rejects.toMatchObject({ code: "not_found" });
    } finally {
      read.mockRestore();
    }
    expect(await draftStore.getDraft(draft.id)).toMatchObject({ status: "drafting", visibility: "restricted", working: { title: "Draft Projects" } });
  });
});

describe("reviews and findings", () => {
  it("needs a submitted version before anyone reviews", async () => {
    const draft = await createDraft(agent(), { title: "Draft Projects" });
    await expect(reviewDraft(agent(), draft.id, { kind: "comment", version: 1, body: "x" })).rejects.toMatchObject({ code: "draft_not_submitted" });
  });

  it("keeps a blocking finding open until its raiser resolves it; nobody else's agent may", async () => {
    const draft = await submitted();
    const raiser = agent("ricardo@petrasoap.com", "sp_mcp_codex");
    const { review } = await reviewDraft(raiser, draft.id, { kind: "finding", version: 1, body: "T2 needs an owner.", blocking: true, target: "T2" });
    expect(review).toMatchObject({ status: "open", blocking: true, version: 1, digest: draft.digest, byKind: "agent", byPrincipal: "sp_mcp_codex" });
    expect(openBlockingFindings(await getVisibleDraft(agent(), draft.id)).map((r) => r.id)).toEqual([review.id]);
    await expect(closeFinding(agent(), draft.id, review.id, "resolve", null)).rejects.toMatchObject({ status: 403 });
    await expect(closeFinding(agent("ricardo@petrasoap.com", "sp_mcp_grok"), draft.id, review.id, "resolve", null)).rejects.toMatchObject({ status: 403 });
    const { review: closed } = await closeFinding(raiser, draft.id, review.id, "resolve", "Owner added.");
    expect(closed).toMatchObject({ status: "resolved", closedBy: "ricardo@petrasoap.com", closeReason: "Owner added." });
    expect(openBlockingFindings(await getVisibleDraft(agent(), draft.id))).toEqual([]);
    await expect(closeFinding(raiser, draft.id, review.id, "resolve", null)).rejects.toMatchObject({ code: "finding_closed" });
  });

  it("lets only the author in person dismiss a finding, with a reason", async () => {
    const draft = await submitted();
    const { review } = await reviewDraft(human("stephen@petrasoap.com"), draft.id, { kind: "finding", version: 1, body: "Too big.", blocking: true });
    await expect(closeFinding(agent(), draft.id, review.id, "dismiss", "The author's agent cannot.")).rejects.toMatchObject({ status: 403 });
    await expect(closeFinding(human("vince@petrasoap.com"), draft.id, review.id, "dismiss", "no")).rejects.toMatchObject({ status: 422 });
    const { review: dismissed } = await closeFinding(human("vince@petrasoap.com"), draft.id, review.id, "dismiss", "Scope agreed with Stephen.");
    expect(dismissed).toMatchObject({ status: "dismissed", closeReason: "Scope agreed with Stephen." });
  });

  it("asks a named reviewer until they review the current version", async () => {
    const draft = await submitted();
    const ricardo = human("ricardo@petrasoap.com");
    expect(needsReviewFrom(draft, ricardo)).toBe(true);
    expect(needsReviewFrom(draft, human("stephen@petrasoap.com"))).toBe(false);
    expect((await listVisibleDrafts(ricardo, { needsMyReview: true })).map((d) => d.id)).toEqual([draft.id]);
    await reviewDraft(ricardo, draft.id, { kind: "approve", version: 1, body: "Yes." });
    expect(needsReviewFrom(await getVisibleDraft(ricardo, draft.id), ricardo)).toBe(false);
  });
});

describe("capabilities", () => {
  it("lets members write, review and accept drafts; agents write and review but never accept", () => {
    for (const role of ["member", "admin", "owner"] as const) {
      expect(capabilitiesForRole(role)).toEqual(expect.arrayContaining(["draft.create", "draft.review", "draft.accept"]));
    }
    for (const id of ["sp_mcp_claude_code", "sp_mcp_cursor", "sp_mcp_cos", "sp_mcp_ledger"]) {
      expect(capabilitiesForServicePrincipal(id)).toEqual(expect.arrayContaining(["draft.create", "draft.review"]));
      expect(capabilitiesForServicePrincipal(id)).not.toContain("draft.accept");
    }
    for (const id of ["sp_mcp_portal", "sp_mcp_workbench", "sp_mcp_infra", "sp_mcp_cip_auto_undraft", "sp_mcp_workbench_intake"]) {
      for (const cap of ["draft.create", "draft.review", "draft.accept"] as const) {
        expect(capabilitiesForServicePrincipal(id)).not.toContain(cap);
      }
    }
  });
});
