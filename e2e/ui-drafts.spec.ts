// Drafts screen (Draft Projects step 3, TASK-4071): the list, a draft's record
// (plan, research, reviews, versions) and Accept, against mocked /api/drafts
// routes. Accept states what it creates before it sends anything, and sends the
// version the author read, then reloads the shared snapshot before it links the
// new records. An older version is read-only, and a closed draft offers no
// finding actions. Approvals lists the drafts waiting for the viewer's review.
// The New draft form (TASK-4109) creates a draft, saves from the edit base it
// read and keeps what it does not show; submit and withdraw are the author's. Axe and horizontal overflow run at
// desktop, tablet and phone widths.

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
}

interface MockOptions {
  /** What submit still needs, as GET /api/drafts/{id} reports it. */
  completeness?: unknown[];
  /** The draft moved since the form read it: a save refuses with 409 draft_changed. */
  refuseSave?: boolean;
}

async function mockDraftsApi(
  page: Page,
  viewer: Record<string, unknown> = {},
  draftFields: Record<string, unknown> = {},
  options: MockOptions = {}
): Promise<Mock> {
  const mock: Mock = { accepts: [], order: [], creates: [], saves: [], submits: [], withdraws: [] };
  // A save moves the edit base, as the server's does.
  let editBase = EDIT_BASE;
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
      return route.fulfill(json({ draft: { ...ROW, id: "DRF-8", status: "drafting", version: 0 } }));
    }
    if (request.method() === "PATCH" && url.pathname === "/api/drafts/DRF-7") {
      mock.saves.push(request.postDataJSON());
      if (options.refuseSave) {
        const error = { code: "draft_changed", message: "DRF-7 changed since you opened it. Copy your edits, reload it, and edit again." };
        return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error }) });
      }
      editBase = EDIT_BASE_2;
      return route.fulfill(json({ draft: ROW, changed: true, editBase }));
    }
    if (request.method() === "POST" && url.pathname.endsWith("/submit")) {
      mock.submits.push(request.postDataJSON());
      return route.fulfill(json({ draft: ROW, frozen: true, duplicates: 0 }));
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
      const old = url.searchParams.get("version") === "1";
      return route.fulfill(
        json({ ...detail({ editBase, ...viewer }, draftFields), ...(old ? { version: VERSION_1 } : {}), completeness: options.completeness ?? [] })
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

  test("Edit saves from the edit base it read, and keeps what the form does not show", async ({ page }) => {
    const mock = await mockDraftsApi(page);
    await openDrafts(page, "&draftId=DRF-7");
    await page.getByRole("region", { name: "Your draft" }).getByRole("button", { name: "Edit draft" }).click();
    await expect(page).toHaveURL(/draftId=DRF-7&edit=1/);
    await page.getByLabel("Title", { exact: true }).fill("Draft Projects rollout, revised");
    await expect(page.getByText("Saving keeps the draft's 1 risk(s), 1 open question(s) as they are.")).toBeVisible();
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
    await mockDraftsApi(page);
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
