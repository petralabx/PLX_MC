// Drafts screen (Draft Projects step 3, TASK-4071): the list, a draft's record
// (plan, research, reviews, versions) and Accept, against mocked /api/drafts
// routes. Accept states what it creates before it sends anything, and sends the
// version the author read, then reloads the shared snapshot before it links the
// new records. An older version is read-only, and a closed draft offers no
// finding actions. Approvals lists the drafts waiting for the viewer's review.
// The New draft form (TASK-4109) creates a draft, saves from the edit base it
// read and sends back what it did not change; submit and withdraw are the
// author's, and the form locks while either runs. It edits risks, open
// questions, artifacts, dependencies and the order of tasks too (TASK-4110).
// Axe and horizontal overflow run at desktop, tablet and phone widths.

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { waitForHydration } from "./helpers";
import { approvalsInboxRoute, mockApprovalsApi } from "./helpers/ui-loop/mc.routes";
import { expectSurfaceNoHorizontalOverflow } from "./helpers/ui-loop-surfaces";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOT_DIR = ".orchestrator/mc-brand-ui/drafts";
const WIDTHS = [
  ["desktop", 1440, 900],
  ["tablet", 820, 1180],
  ["mobile", 393, 851],
] as const;

const DIGEST_1 = `sha256:${"b".repeat(64)}`;
const DIGEST_2 = `sha256:${"a".repeat(64)}`;
const EDIT_BASE = `sha256:${"c".repeat(64)}`;
const EDIT_BASE_2 = `sha256:${"d".repeat(64)}`;
/** The base after another writer saved: an agent, or another tab. */
const EDIT_BASE_OTHER = `sha256:${"e".repeat(64)}`;

const WORKING = {
  title: "Draft Projects rollout",
  plan: {
    project: { key: "P", existing: null, name: "Draft Projects rollout", owner: "vince", repos: ["plx-mc"], desc: "Reviewable plans before they go live." },
    buckets: [
      { key: "B1", name: "Storage", owner: "ricardo", repos: ["plx-mc"], desc: "" },
      { key: "B2", name: "Screen", owner: "stephen", repos: ["plx-mc"], desc: "" },
    ],
    tasks: [
      { key: "T1", bucket: "B1", title: "Drafts tables", description: "Migration 056.", priority: "high", kind: "code", repos: ["plx-mc"], accountableOwner: "ricardo", dependsOn: [] },
      { key: "T2", bucket: "B2", title: "Drafts screen", description: "", priority: "medium", kind: "code", repos: ["plx-mc"], accountableOwner: null, dependsOn: ["T1"] },
    ],
  },
  research: {
    summary: "Plans get reviewed before they create live work.",
    context: "Agents create projects, buckets and tasks directly today.",
    findings: [{ text: "Projects and buckets have no draft state.", sources: ["[1]"] }],
    approaches: [
      { name: "Separate tables", pros: ["Live screens stay unchanged"], cons: ["Two more tables"], risk: "low", effort: "M", chosen: true },
      { name: "A status on projects", pros: ["One table"], cons: ["Every live screen must hide drafts"], risk: "medium", effort: "M", chosen: false },
    ],
    recommendation: "Separate tables.",
    risks: [{ text: "Drafts get accepted unread.", likelihood: "low", impact: "medium", mitigation: "A blocking finding refuses Accept." }],
    openQuestions: ["Who reviews by default?"],
    sources: [
      {
        ref: "[1]",
        title: "PRD: Draft Projects",
        url: "https://github.com/petralabx/PLX_MC/blob/main/docs/product/PRD-draft-projects.md",
        kind: "internal",
        excerpt: "",
        accessed: "2026-10-27",
      },
    ],
    artifacts: [],
  },
};

const REVIEW = {
  id: "drv_0123456789abcdef",
  kind: "approve",
  body: "The plan matches the PRD.",
  blocking: false,
  target: null,
  version: 2,
  digest: DIGEST_2,
  by: "ricardo@petrasoap.com",
  byKind: "human",
  byPrincipal: null,
  at: "2026-10-27T10:00:00.000Z",
  source: "review",
  status: null,
  closedBy: null,
  closedAt: null,
  closeReason: null,
  stale: false,
};

const OPEN_FINDING = {
  ...REVIEW,
  id: "drv_00000000000000aa",
  kind: "finding",
  body: "Split B2 before Accept.",
  blocking: true,
  status: "open",
};

function detail(viewer: Record<string, unknown> = {}, draftFields: Record<string, unknown> = {}) {
  return {
    draft: {
      id: "DRF-7",
      status: "in_review",
      author: "vince@petrasoap.com",
      createdBy: "sp_mcp_claude_code",
      visibility: "shared",
      members: [],
      reviewers: ["ricardo"],
      version: 2,
      digest: DIGEST_2,
      working: WORKING,
      reviews: [REVIEW],
      materialized: {},
      acceptedAt: null,
      acceptedBy: null,
      withdrawnAt: null,
      withdrawnBy: null,
      withdrawReason: null,
      createdAt: "2026-10-27T09:00:00.000Z",
      updatedAt: "2026-10-27T10:00:00.000Z",
      ...draftFields,
    },
    versions: [
      { version: 1, digest: DIGEST_1, frozenBy: "vince@petrasoap.com", frozenAt: "2026-10-27T09:30:00.000Z" },
      { version: 2, digest: DIGEST_2, frozenBy: "vince@petrasoap.com", frozenAt: "2026-10-27T09:50:00.000Z" },
    ],
    version: null,
    preflight: [],
    completeness: [],
    viewer: {
      email: "vince@petrasoap.com",
      isAuthor: true,
      openBlockingFindings: [],
      unsubmittedEdits: false,
      acceptInProgress: false,
      canReview: true,
      canAccept: true,
      canEdit: true,
      canSubmit: false,
      canWithdraw: true,
      editBase: EDIT_BASE,
      ...viewer,
    },
  };
}

const VERSION_1 = {
  draftId: "DRF-7",
  version: 1,
  digest: DIGEST_1,
  content: { ...WORKING, title: "Draft Projects rollout, first plan" },
  frozenBy: "vince@petrasoap.com",
  frozenAt: "2026-10-27T09:30:00.000Z",
};

const VERSION_2 = { ...VERSION_1, version: 2, digest: DIGEST_2, content: WORKING, frozenAt: "2026-10-27T09:50:00.000Z" };

const ROW = {
  id: "DRF-7",
  title: "Draft Projects rollout",
  status: "in_review",
  author: "vince@petrasoap.com",
  version: 2,
  buckets: 2,
  tasks: 2,
  openFindings: 0,
  openBlockingFindings: 0,
  updatedAt: "2026-10-27T10:00:00.000Z",
};

interface Mock {
  accepts: unknown[];
  /** Request paths in order: an Accept, then the shared snapshot load. */
  order: string[];
  creates: Record<string, unknown>[];
  saves: Record<string, unknown>[];
  submits: unknown[];
  withdraws: unknown[];
  uploads: Record<string, unknown>[];
}

interface MockOptions {
  /** What submit still needs, as GET /api/drafts/{id} reports it. */
  completeness?: unknown[];
  /** The draft moved since the form read it: a save refuses with 409 draft_changed. */
  refuseSave?: boolean;
  /** Every read of DRF-7 after a save fails, as a read-back after a save can. */
  failReadBack?: boolean;
  /** Another writer saves right after the form does: the read-back is slow, and moved on. */
  otherWriterAfterSave?: boolean;
  /** With otherWriterAfterSave: the other writer also set T2's dependencies to these. */
  otherWriterDependsOn?: string[];
  /** Create takes a while, so the form can be seen locked meanwhile. */
  slowCreate?: boolean;
  /** The first save's read-back takes a second and the second save two: the read-back lands while that save is on its way. */
  slowSecondSave?: boolean;
  /** Submit takes a while, so the form can be seen locked meanwhile. */
  slowSubmit?: boolean;
  /** Every save takes a while, so the form can be seen while one is on its way. */
  slowSave?: boolean;
  /** What GET /api/drafts/{id} reports once a file is uploaded, as when an upload returns a draft in review to drafting. */
  afterUpload?: { viewer?: Record<string, unknown>; draftFields?: Record<string, unknown> };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function mockDraftsApi(
  page: Page,
  viewer: Record<string, unknown> = {},
  draftFields: Record<string, unknown> = {},
  options: MockOptions = {}
): Promise<Mock> {
  const mock: Mock = { accepts: [], order: [], creates: [], saves: [], submits: [], withdraws: [], uploads: [] };
  // A save moves the edit base and the title it sent, as the server's does.
  let editBase = EDIT_BASE;
  let title = WORKING.title;
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path === "/api/state" || path.endsWith("/accept")) mock.order.push(`${request.method()} ${path}`);
  });
  const json = (data: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify({ data }) });
  await page.route(/\/api\/drafts(\/|\?|$)/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname.endsWith("/accept")) {
      mock.accepts.push(request.postDataJSON());
      return route.fulfill(json({ created: { P: "PRJ-90", B1: "BKT-91", B2: "BKT-92", T1: "TASK-93", T2: "TASK-94" }, alreadyAccepted: false }));
    }
    if (request.method() === "POST" && url.pathname === "/api/drafts") {
      mock.creates.push(request.postDataJSON());
      if (options.slowCreate) await pause(1_500);
      return route.fulfill(json({ draft: { ...ROW, id: "DRF-8", status: "drafting", version: 0 } }));
    }
    if (request.method() === "PATCH" && url.pathname === "/api/drafts/DRF-7") {
      mock.saves.push(request.postDataJSON());
      if (options.refuseSave) {
        const error = { code: "draft_changed", message: "DRF-7 changed since you opened it. Copy your edits, reload it, and edit again." };
        return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error }) });
      }
      if (options.slowSecondSave && mock.saves.length === 2) await pause(2_000);
      if (options.slowSave) await pause(1_500);
      editBase = EDIT_BASE_2;
      title = String(mock.saves.at(-1)?.title ?? title);
      return route.fulfill(json({ draft: ROW, changed: true, editBase }));
    }
    if (request.method() === "POST" && url.pathname.endsWith("/submit")) {
      mock.submits.push(request.postDataJSON());
      if (options.slowSubmit) await pause(1_500);
      return route.fulfill(json({ draft: ROW, frozen: true, duplicates: 0 }));
    }
    if (request.method() === "POST" && url.pathname.endsWith("/artifacts")) {
      // As the server does: the file is stored and linked, and the edit base moves.
      const body = request.postDataJSON() as Record<string, string>;
      mock.uploads.push(body);
      editBase = EDIT_BASE_2;
      const link = `https://petrasoap.sharepoint.com/sites/PLXSite/Mission%20Control/Drafts/DRF-7/20261028T220000Z-abcdef12-${body.fileName}`;
      return route.fulfill(json({ artifact: { kind: body.kind, name: body.fileName, url: link, inline: null }, duplicate: false, editBase, draft: ROW }));
    }
    if (request.method() === "POST" && url.pathname.endsWith("/withdraw")) {
      mock.withdraws.push(request.postDataJSON());
      return route.fulfill(json({ draft: { ...ROW, status: "withdrawn" } }));
    }
    if (request.method() === "POST" && url.pathname.endsWith("/review")) {
      const error = { code: "draft_version_moved", message: "DRF-7 is at version 3, not 2. Read it again before you review." };
      return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error }) });
    }
    if (request.method() !== "GET") return route.fulfill({ status: 405, body: "Method Not Allowed" });
    if (/\/api\/drafts\/DRF-7$/.test(url.pathname)) {
      const otherDeps = options.otherWriterAfterSave && mock.saves.length > 0 ? options.otherWriterDependsOn : undefined;
      const tasks = otherDeps ? WORKING.plan.tasks.map((t) => (t.key === "T2" ? { ...t, dependsOn: otherDeps } : t)) : WORKING.plan.tasks;
      const working = { ...WORKING, title, plan: { ...WORKING.plan, tasks } };
      if (options.slowSecondSave && mock.saves.length === 1) await pause(1_000);
      if (options.otherWriterAfterSave && mock.saves.length > 0) {
        await pause(1_500);
        editBase = EDIT_BASE_OTHER;
      }
      if (options.failReadBack && mock.saves.length > 0) {
        const error = { code: "internal", message: "Internal error." };
        return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error }) });
      }
      const frozen = { "1": VERSION_1, "2": VERSION_2 }[url.searchParams.get("version") ?? ""] ?? null;
      const uploaded = mock.uploads.length > 0 ? options.afterUpload : undefined;
      return route.fulfill(
        json({
          ...detail({ editBase, ...viewer, ...uploaded?.viewer }, { working, ...draftFields, ...uploaded?.draftFields }),
          ...(frozen ? { version: frozen } : {}),
          completeness: options.completeness ?? [],
        })
      );
    }
    if (/\/api\/drafts\/DRF-8$/.test(url.pathname)) {
      // The draft the New draft form just created, as the form sent it.
      const made = mock.creates.at(-1) ?? {};
      const working = { title: made.title, plan: made.plan, research: made.research };
      return route.fulfill(
        json(
          detail(
            { canSubmit: true, canAccept: false, canReview: false },
            { id: "DRF-8", status: "drafting", version: 0, digest: null, working, reviews: [], reviewers: [] }
          )
        )
      );
    }
    return route.fulfill(json({ drafts: [ROW], count: 1, viewer: "vince@petrasoap.com" }));
  });
  return mock;
}

async function openDrafts(page: Page, query = ""): Promise<void> {
  await page.goto(`/?screen=drafts${query}`);
  await waitForHydration(page);
  await expect(page.locator("[data-testid='drafts-screen']")).toBeVisible();
}

test.describe("Drafts screen (Draft Projects)", () => {
  test("lists the drafts the viewer can see and opens one", async ({ page }) => {
    await mockDraftsApi(page);
    await openDrafts(page);
    await expect(page.getByRole("heading", { name: /Draft projects/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Needs my review" })).toBeVisible();
    await page.locator(".dr-row", { hasText: "Draft Projects rollout" }).click();
    await expect(page).toHaveURL(/draftId=DRF-7/);
    const plan = page.getByRole("region", { name: "Plan" });
    await expect(plan.getByText("Storage")).toBeVisible();
    await expect(plan.getByText("Drafts screen")).toBeVisible();
    await expect(plan.getByText("after T1")).toBeVisible();
  });

  test("shows the research, the reviews and the versions of a draft", async ({ page }) => {
    await mockDraftsApi(page);
    await openDrafts(page, "&draftId=DRF-7");
    const research = page.getByRole("region", { name: "Research" });
    await expect(research.getByText("Plans get reviewed before they create live work.")).toBeVisible();
    await expect(research.getByText("chosen", { exact: true })).toBeVisible();
    await expect(research.getByRole("link", { name: "PRD: Draft Projects" })).toHaveAttribute("href", /^https:\/\/github\.com\//);
    await expect(page.getByRole("region", { name: "Reviews" }).getByText("The plan matches the PRD.")).toBeVisible();
    await expect(page.getByRole("region", { name: "Versions" }).getByRole("button", { name: "Version 1" })).toBeVisible();
  });

  test("Accept states what it creates, then sends the version the author read", async ({ page }) => {
    const mock = await mockDraftsApi(page);
    await openDrafts(page, "&draftId=DRF-7");
    const accept = page.getByRole("region", { name: "Accept" });
    await accept.getByRole("button", { name: "Accept version 2…" }).click();
    const confirm = accept.getByRole("alertdialog", { name: "Confirm Accept" });
    await expect(confirm).toContainText("Creates 1 project, 2 buckets and 2 tasks, from version 2");
    expect(mock.accepts).toEqual([]);
    await confirm.getByRole("button", { name: /^Accept: creates 1 project/ }).click();
    await expect.poll(() => mock.accepts).toEqual([{ version: 2 }]);
    // The created records' screens read the shared snapshot: it reloads after the Accept.
    await expect.poll(() => mock.order.slice(mock.order.indexOf("POST /api/drafts/DRF-7/accept"))).toContain("GET /api/state");
  });

  test("finding actions show only while the draft takes them, and a failed close shows its error", async ({ page }) => {
    await mockDraftsApi(page, { canReview: false }, { reviews: [OPEN_FINDING] });
    await openDrafts(page, "&draftId=DRF-7");
    const reviews = page.getByRole("region", { name: "Reviews" });
    await reviews.getByRole("button", { name: "Resolve" }).click();
    await expect(reviews.getByText("DRF-7 is at version 3, not 2.")).toBeVisible();

    await page.unrouteAll({ behavior: "ignoreErrors" });
    await mockDraftsApi(page, {}, { status: "withdrawn", reviews: [OPEN_FINDING] });
    await openDrafts(page, "&draftId=DRF-7");
    const closed = page.getByRole("region", { name: "Reviews" });
    await expect(closed.getByText("Split B2 before Accept.")).toBeVisible();
    await expect(closed.getByRole("button", { name: "Resolve" })).toHaveCount(0);
    await expect(closed.getByRole("button", { name: "Dismiss…" })).toHaveCount(0);
  });

  test("an older version is read-only: no review form, no finding actions and no Accept", async ({ page }) => {
    await mockDraftsApi(page);
    await openDrafts(page, "&draftId=DRF-7&version=1");
    await expect(page.getByRole("heading", { name: "Draft Projects rollout, first plan" })).toBeVisible();
    await expect(page.getByText("You are reading version 1. The current version is 2.")).toBeVisible();
    const reviews = page.getByRole("region", { name: "Reviews" });
    await expect(reviews.getByText("To review, read the current version.")).toBeVisible();
    await expect(reviews.getByRole("textbox", { name: "Review" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Accept" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Your draft" })).toHaveCount(0);
    await page.getByRole("button", { name: "Read the current version" }).click();
    await expect(page.getByRole("heading", { name: "Draft Projects rollout", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Reviews" }).getByRole("textbox", { name: "Review" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Accept" }).getByRole("button", { name: "Accept version 2…" })).toBeVisible();
  });

  test("New draft creates a draft from the form, then opens it to edit", async ({ page }) => {
    const mock = await mockDraftsApi(page);
    await openDrafts(page);
    await page.getByRole("button", { name: "+ New draft" }).click();
    await expect(page).toHaveURL(/draftId=new/);
    await expect(page.getByRole("heading", { name: "New draft" })).toBeVisible();
    await page.getByLabel("Title", { exact: true }).fill("Supplier onboarding");
    await page.getByLabel("Project name", { exact: true }).fill("Supplier onboarding");
    await page.getByRole("button", { name: "+ Add bucket" }).click();
    await page.getByLabel("B1 name", { exact: true }).fill("Intake");
    await page.getByRole("button", { name: "+ Add task" }).click();
    await page.getByLabel("T1 title", { exact: true }).fill("Intake form");
    await page.getByRole("button", { name: "+ Add approach" }).click();
    await page.getByLabel("Approach 1 name", { exact: true }).fill("A form in Mission Control");
    await page.getByRole("button", { name: "Create draft" }).click();
    await expect.poll(() => mock.creates.length).toBe(1);
    expect(mock.creates[0]).toMatchObject({
      title: "Supplier onboarding",
      plan: {
        project: { existing: null, name: "Supplier onboarding" },
        buckets: [{ key: "B1", name: "Intake" }],
        tasks: [{ key: "T1", bucket: "B1", title: "Intake form", dependsOn: [] }],
      },
      research: { approaches: [{ name: "A form in Mission Control", chosen: true }] },
      visibility: "shared",
      members: [],
      reviewers: [],
    });
    await expect(page).toHaveURL(/draftId=DRF-8&edit=1/);
    await expect(page.getByRole("heading", { name: "Edit DRF-8" })).toBeVisible();
    await expect(page.getByLabel("T1 title", { exact: true })).toHaveValue("Intake form");
  });

  test("Edit saves from the edit base it read, and sends back what it did not change", async ({ page }) => {
    const mock = await mockDraftsApi(page);
    await openDrafts(page, "&draftId=DRF-7");
    await page.getByRole("region", { name: "Your draft" }).getByRole("button", { name: "Edit draft" }).click();
    await expect(page).toHaveURL(/draftId=DRF-7&edit=1/);
    await page.getByLabel("Title", { exact: true }).fill("Draft Projects rollout, revised");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect.poll(() => mock.saves.length).toBe(1);
    expect(mock.saves[0]).toMatchObject({
      base: EDIT_BASE,
      title: "Draft Projects rollout, revised",
      plan: WORKING.plan,
      research: { risks: WORKING.research.risks, openQuestions: WORKING.research.openQuestions, sources: WORKING.research.sources },
    });
    // The next save names the base the last one returned.
    await expect(page.getByText("Saved.")).toBeVisible();
    await page.getByLabel("Title", { exact: true }).fill("Draft Projects rollout, revised twice");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect.poll(() => mock.saves.length).toBe(2);
    expect(mock.saves[1]).toMatchObject({ base: EDIT_BASE_2, title: "Draft Projects rollout, revised twice" });
  });

  test("a failed reload after a save keeps the form, and the save counts as saved", async ({ page }) => {
    const mock = await mockDraftsApi(page, {}, {}, { failReadBack: true });
    await openDrafts(page, "&draftId=DRF-7&edit=1");
    await page.getByLabel("Title", { exact: true }).fill("Saved, then the read-back fails");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect.poll(() => mock.saves.length).toBe(1);
    const footer = page.getByRole("region", { name: "Save" });
    await expect(footer).toContainText("Could not reload DRF-7: Internal error.");
    await expect(footer.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Saved, then the read-back fails");
    await expect(footer.getByRole("button", { name: "Done" })).toBeVisible();
    await expect(footer.getByRole("button", { name: "Save draft" })).toBeDisabled();
  });

  test("edits typed during a save's read-back keep the base they were made from", async ({ page }) => {
    const mock = await mockDraftsApi(page, {}, {}, { otherWriterAfterSave: true });
    await openDrafts(page, "&draftId=DRF-7&edit=1");
    const title = page.getByLabel("Title", { exact: true });
    await title.fill("First save");
    const readBack = page.waitForResponse((r) => r.request().method() === "GET" && new URL(r.url()).pathname === "/api/drafts/DRF-7");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect.poll(() => mock.saves.length).toBe(1);
    await title.fill("Typed while the read-back was on its way");
    await readBack;
    await expect(title).toHaveValue("Typed while the read-back was on its way");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect.poll(() => mock.saves.length).toBe(2);
    // The base the edits were made from: another writer's change refuses this save instead of being overwritten.
    expect(mock.saves[1]).toMatchObject({ base: EDIT_BASE_2, title: "Typed while the read-back was on its way" });
  });

  test("a save's read-back that lands during the next save does not undo it", async ({ page }) => {
    const mock = await mockDraftsApi(page, {}, {}, { slowSecondSave: true });
    await openDrafts(page, "&draftId=DRF-7&edit=1");
    const title = page.getByLabel("Title", { exact: true });
    await title.fill("First save");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await title.fill("Second save");
    const secondSave = page.waitForResponse((r) => r.request().method() === "PATCH");
    await page.getByRole("button", { name: "Save draft" }).click();
    await secondSave;
    expect(mock.saves.map((s) => s.title)).toEqual(["First save", "Second save"]);
    await expect(page.getByText("Saved.")).toBeVisible();
    await expect(title).toHaveValue("Second save");
  });

  test("the form is locked while Create runs", async ({ page }) => {
    const mock = await mockDraftsApi(page, {}, {}, { slowCreate: true });
    await openDrafts(page, "&draftId=new");
    await page.getByLabel("Title", { exact: true }).fill("Supplier onboarding");
    await page.getByRole("button", { name: "Create draft" }).click();
    await expect(page.getByLabel("Title", { exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "+ Add bucket" })).toBeDisabled();
    await expect(page).toHaveURL(/draftId=DRF-8&edit=1/);
    expect(mock.creates).toHaveLength(1);
  });

  test("unsaved edits ask before an in-app move or Back", async ({ page }) => {
    await mockDraftsApi(page);
    await openDrafts(page, "&draftId=DRF-7");
    await page.getByRole("region", { name: "Your draft" }).getByRole("button", { name: "Edit draft" }).click();
    const title = page.getByLabel("Title", { exact: true });
    await title.fill("Not saved yet");
    const asked: string[] = [];
    page.once("dialog", (dialog) => {
      asked.push(dialog.message());
      void dialog.dismiss();
    });
    await page.getByRole("button", { name: "← Back to DRF-7" }).click();
    await expect.poll(() => asked).toEqual(["Leave without saving your edits?"]);
    await expect(page).toHaveURL(/draftId=DRF-7&edit=1/);
    await expect(title).toHaveValue("Not saved yet");

    page.once("dialog", (dialog) => void dialog.dismiss());
    await page.goBack();
    await expect(page).toHaveURL(/draftId=DRF-7&edit=1/);
    await expect(title).toHaveValue("Not saved yet");

    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "← Back to DRF-7" }).click();
    await expect(page).toHaveURL(/draftId=DRF-7$/);
  });

  test("edits risks, open questions, artifacts, dependencies and the order of tasks", async ({ page }) => {
    const mock = await mockDraftsApi(page);
    await openDrafts(page, "&draftId=DRF-7&edit=1");
    await page.getByRole("button", { name: "+ Add risk" }).click();
    await page.getByLabel("Risk 2", { exact: true }).fill("Reviewers skip drafts.");
    await page.getByLabel(/^Risk 2 impact/).selectOption("high");
    await page.getByLabel("Open questions (one per line)").fill("Who reviews by default?\nDo drafts expire?");
    await page.getByRole("button", { name: "+ Add artifact" }).click();
    await page.getByLabel("Artifact 1 name", { exact: true }).fill("Flow");
    await page.getByLabel(/^Artifact 1 kind/).selectOption("mermaid");
    await page.getByLabel("Inline markdown or Mermaid").check();
    await page.getByLabel("Artifact 1 content", { exact: true }).fill("graph TD; A-->B");
    await page.getByRole("group", { name: "T2 depends on" }).getByLabel(/T1/).uncheck();
    await page.getByLabel("T2 also depends on existing tasks (TASK ids, separated by commas)").fill("TASK-3953");
    await page.getByRole("button", { name: "Move T2 up" }).click();
    await expect(page.getByRole("button", { name: "Move T2 up" })).toBeDisabled();
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect.poll(() => mock.saves.length).toBe(1);
    expect(mock.saves[0]).toMatchObject({
      plan: { tasks: [{ key: "T2", dependsOn: ["TASK-3953"] }, { key: "T1", dependsOn: [] }] },
      research: {
        risks: [WORKING.research.risks[0], { text: "Reviewers skip drafts.", likelihood: "medium", impact: "high", mitigation: "" }],
        openQuestions: ["Who reviews by default?", "Do drafts expire?"],
        artifacts: [{ kind: "mermaid", name: "Flow", url: null, inline: "graph TD; A-->B" }],
      },
    });
  });

  test("a draft that moved refuses the save, and the form keeps the edits", async ({ page }) => {
    await mockDraftsApi(page, {}, {}, { refuseSave: true });
    await openDrafts(page, "&draftId=DRF-7&edit=1");
    await page.getByLabel("Title", { exact: true }).fill("My edit");
    await page.getByRole("button", { name: "Save draft" }).click();
    const footer = page.getByRole("region", { name: "Save" });
    await expect(footer.getByRole("alert")).toContainText("DRF-7 changed since you opened it.");
    await expect(footer.getByRole("button", { name: "Reload DRF-7 (drops your edits)" })).toBeVisible();
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue("My edit");
  });

  test("Submit lists what is missing, then sends the edit base the author read", async ({ page }) => {
    const missing = [{ code: "summary_required", path: "research.summary", message: "Write a summary of the plan." }];
    await mockDraftsApi(page, { canSubmit: true }, { status: "drafting" }, { completeness: missing });
    await openDrafts(page, "&draftId=DRF-7");
    const waiting = page.getByRole("region", { name: "Your draft" });
    await expect(waiting).toContainText("Before you can submit:");
    await expect(waiting).toContainText("Write a summary of the plan.");
    await expect(waiting.getByRole("button", { name: "Submit for review" })).toBeDisabled();

    await page.unrouteAll({ behavior: "ignoreErrors" });
    const mock = await mockDraftsApi(page, { canSubmit: true }, { status: "drafting" });
    await openDrafts(page, "&draftId=DRF-7");
    await page.getByRole("region", { name: "Your draft" }).getByRole("button", { name: "Submit for review" }).click();
    await expect.poll(() => mock.submits).toEqual([{ base: EDIT_BASE }]);
  });

  test("the form is locked while Submit runs, so no edit is lost when it opens the draft", async ({ page }) => {
    const mock = await mockDraftsApi(page, { canSubmit: true }, { status: "drafting" }, { slowSubmit: true });
    await openDrafts(page, "&draftId=DRF-7&edit=1");
    const footer = page.getByRole("region", { name: "Save" });
    await footer.getByRole("button", { name: "Submit for review" }).click();
    await expect(page.getByLabel("Title", { exact: true })).toBeDisabled();
    // Done or Back would open the record before Submit lands, and it would keep showing the draft as it was.
    await expect(footer.getByRole("button", { name: "Done" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "← Back to DRF-7" })).toBeDisabled();
    await expect(page).toHaveURL(/draftId=DRF-7$/);
    expect(mock.submits).toEqual([{ base: EDIT_BASE }]);
  });

  test("a dependency typed key by key stays as typed, even past a shorter task key", async ({ page }) => {
    const mock = await mockDraftsApi(page);
    await openDrafts(page, "&draftId=DRF-7&edit=1");
    const typed = page.getByLabel("T2 also depends on existing tasks (TASK ids, separated by commas)");
    await page.getByRole("group", { name: "T2 depends on" }).getByLabel(/T1/).uncheck();
    // T10 passes through T1, a key the plan holds, on the way.
    await typed.pressSequentially("T10");
    await expect(typed).toHaveValue("T10");
    await expect(page.getByRole("group", { name: "T2 depends on" }).getByLabel(/T1/)).not.toBeChecked();
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect.poll(() => mock.saves.length).toBe(1);
    expect(mock.saves[0]).toMatchObject({ plan: { tasks: [{ key: "T1" }, { key: "T2", dependsOn: ["T10"] }] } });
  });

  test("a read-back that replaces the form while a dependency field has focus restarts the edit from it", async ({ page }) => {
    const mock = await mockDraftsApi(page, {}, {}, { otherWriterAfterSave: true, otherWriterDependsOn: ["TASK-77"] });
    await openDrafts(page, "&draftId=DRF-7&edit=1");
    await page.getByLabel("Title", { exact: true }).fill("Saved before the read-back");
    const readBack = page.waitForResponse((r) => r.request().method() === "GET" && new URL(r.url()).pathname === "/api/drafts/DRF-7");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect.poll(() => mock.saves.length).toBe(1);
    // Focus before the read-back lands, and type after: the field shows, and builds on, what it brought.
    const typed = page.getByLabel("T2 also depends on existing tasks (TASK ids, separated by commas)");
    await typed.focus();
    await readBack;
    await expect(typed).toHaveValue("TASK-77");
    await typed.press("End");
    await typed.pressSequentially(",TASK-88");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect.poll(() => mock.saves.length).toBe(2);
    expect(mock.saves[1]).toMatchObject({ plan: { tasks: [{ key: "T1" }, { key: "T2", dependsOn: ["TASK-77", "TASK-88"] }] } });
  });

  test("uploads a file into the draft's artifacts, and the next save names the base the upload returned", async ({ page }) => {
    const mock = await mockDraftsApi(page, { canUpload: true });
    await openDrafts(page, "&draftId=DRF-7&edit=1");
    await page.getByLabel(/^Upload as/).selectOption("screenshot");
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);
    await page.getByLabel(/^Upload a file/).setInputFiles({ name: "form.png", mimeType: "image/png", buffer: png });
    await expect.poll(() => mock.uploads.length).toBe(1);
    expect(mock.uploads[0]).toEqual({ base: EDIT_BASE, kind: "screenshot", fileName: "form.png", contentType: "image/png", contentBase64: png.toString("base64") });
    // The link joins the form at once, and nothing is left to save.
    await expect(page.getByLabel("Artifact 1 name", { exact: true })).toHaveValue("form.png");
    await expect(page.getByRole("button", { name: "Save draft" })).toBeDisabled();

    await page.getByLabel("Title", { exact: true }).fill("After the upload");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect.poll(() => mock.saves.length).toBe(1);
    expect(mock.saves[0]).toMatchObject({ base: EDIT_BASE_2, research: { artifacts: [expect.objectContaining({ kind: "screenshot", name: "form.png" })] } });
  });

  test("an upload to a draft in review returns it to drafting, and the form offers Submit again", async ({ page }) => {
    await mockDraftsApi(page, { canUpload: true }, {}, { afterUpload: { viewer: { canSubmit: true }, draftFields: { status: "drafting" } } });
    await openDrafts(page, "&draftId=DRF-7&edit=1");
    const footer = page.getByRole("region", { name: "Save" });
    await expect(footer.getByRole("button", { name: "Submit for review" })).toHaveCount(0);
    await page.getByLabel(/^Upload as/).selectOption("screenshot");
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);
    await page.getByLabel(/^Upload a file/).setInputFiles({ name: "form.png", mimeType: "image/png", buffer: png });
    await expect(page.getByLabel("Artifact 1 name", { exact: true })).toHaveValue("form.png");
    await expect(footer.getByRole("button", { name: "Submit for review" })).toBeEnabled();
  });

  test("an upload waits for a save on its way, and then names the base that save returned", async ({ page }) => {
    const mock = await mockDraftsApi(page, { canUpload: true }, {}, { slowSave: true });
    await openDrafts(page, "&draftId=DRF-7&edit=1");
    await page.getByLabel("Title", { exact: true }).fill("Saved before the upload");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect.poll(() => mock.saves.length).toBe(1);
    // Both would name the base the form read: one would be refused, or store a file it never links.
    const file = page.getByLabel(/^Upload a file/);
    await expect(file).toBeDisabled();
    await expect(file).toBeEnabled();
    await page.getByLabel(/^Upload as/).selectOption("screenshot");
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);
    await file.setInputFiles({ name: "form.png", mimeType: "image/png", buffer: png });
    await expect.poll(() => mock.uploads.length).toBe(1);
    expect(mock.uploads[0]).toMatchObject({ base: EDIT_BASE_2 });
  });

  test("offers no upload when the draft cannot take one", async ({ page }) => {
    await mockDraftsApi(page, { canUpload: false });
    await openDrafts(page, "&draftId=DRF-7&edit=1");
    await expect(page.getByLabel("Title", { exact: true })).toBeVisible();
    await expect(page.getByLabel(/^Upload a file/)).toHaveCount(0);
  });

  test("a frozen version, the current one too, offers no Submit: it would send the working copy", async ({ page }) => {
    await mockDraftsApi(page, { canSubmit: true, unsubmittedEdits: true }, { status: "drafting" });
    await openDrafts(page, "&draftId=DRF-7&version=2");
    await expect(page.getByRole("region", { name: "Plan" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Your draft" })).toHaveCount(0);
    await openDrafts(page, "&draftId=DRF-7");
    await expect(page.getByRole("region", { name: "Your draft" }).getByRole("button", { name: "Submit for review" })).toBeVisible();
  });

  test("Withdraw takes a reason of 10 characters or more", async ({ page }) => {
    const mock = await mockDraftsApi(page);
    await openDrafts(page, "&draftId=DRF-7");
    const mine = page.getByRole("region", { name: "Your draft" });
    await mine.getByRole("button", { name: "Withdraw…" }).click();
    const reason = mine.getByLabel(/Why withdraw DRF-7/);
    await reason.fill("too short");
    await expect(mine.getByRole("button", { name: "Withdraw DRF-7" })).toBeDisabled();
    await reason.fill("Folded into the supplier plan.");
    await mine.getByRole("button", { name: "Withdraw DRF-7" }).click();
    await expect.poll(() => mock.withdraws).toEqual([{ reason: "Folded into the supplier plan." }]);
  });

  test("only the author gets the author actions and the form", async ({ page }) => {
    await mockDraftsApi(page, { isAuthor: false, canEdit: false, canSubmit: false, canWithdraw: false, canAccept: false });
    await openDrafts(page, "&draftId=DRF-7");
    await expect(page.getByRole("region", { name: "Plan" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Your draft" })).toHaveCount(0);
    await openDrafts(page, "&draftId=DRF-7&edit=1");
    await expect(page.getByText("Only vince@petrasoap.com edits DRF-7.")).toBeVisible();
  });

  test("Accept waits for every blocking finding", async ({ page }) => {
    await mockDraftsApi(page, { openBlockingFindings: ["drv_00000000000000aa"], canAccept: false });
    await openDrafts(page, "&draftId=DRF-7");
    await expect(page.getByText("1 open blocking finding(s).")).toBeVisible();
    const accept = page.getByRole("region", { name: "Accept" });
    await expect(accept).toContainText("close every blocking finding first.");
    await expect(accept.getByRole("button")).toHaveCount(0);
  });

  test("Approvals lists the drafts waiting for the viewer's review, and opens one", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockApprovalsApi(page, []);
    await mockDraftsApi(page);
    await page.goto(approvalsInboxRoute.path);
    await waitForHydration(page);
    const panel = page.getByRole("region", { name: "Drafts to review" });
    await expect(panel).toContainText("DRF-7");
    await expect(panel).toContainText("Draft Projects rollout");
    await page.screenshot({ path: `${SHOT_DIR}/approvals-panel-desktop.png`, fullPage: true });
    await panel.getByRole("button", { name: /Draft Projects rollout/ }).click();
    await expect(page).toHaveURL(/screen=drafts&draftId=DRF-7/);
    await expect(page.getByRole("region", { name: "Plan" })).toBeVisible();
  });

  test("has no axe violations and no horizontal overflow at any width", async ({ page }) => {
    // canUpload: the edit page shows the upload control too (TASK-4131).
    await mockDraftsApi(page, { canUpload: true });
    for (const query of ["", "&draftId=DRF-7", "&draftId=new", "&draftId=DRF-7&edit=1"]) {
      for (const [name, width, height] of WIDTHS) {
        await page.setViewportSize({ width, height });
        await openDrafts(page, query);
        const label = `drafts-${query.includes("edit") ? "edit" : query.includes("new") ? "new" : query ? "record" : "list"}/${name}`;
        await page.screenshot({ path: `${SHOT_DIR}/${label.replace("/", "-")}.png`, fullPage: true });
        await expectSurfaceNoHorizontalOverflow(page, "drafts-screen", label);
        const results = await new AxeBuilder({ page }).include("[data-testid='drafts-screen']").withTags(TAGS).analyze();
        expect(results.violations, label).toEqual([]);
      }
    }
  });
});
