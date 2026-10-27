// Drafts screen (Draft Projects step 3, TASK-4071): the list, a draft's record
// (plan, research, reviews, versions) and Accept, against mocked /api/drafts
// routes. Accept states what it creates before it sends anything, and sends the
// version the author read. An older version is read-only. Approvals lists the
// drafts waiting for the viewer's review. Axe and horizontal overflow run at
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

function detail(viewer: Record<string, unknown> = {}) {
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
    },
    versions: [
      { version: 1, digest: DIGEST_1, frozenBy: "vince@petrasoap.com", frozenAt: "2026-10-27T09:30:00.000Z" },
      { version: 2, digest: DIGEST_2, frozenBy: "vince@petrasoap.com", frozenAt: "2026-10-27T09:50:00.000Z" },
    ],
    version: null,
    preflight: [],
    viewer: {
      email: "vince@petrasoap.com",
      isAuthor: true,
      openBlockingFindings: [],
      unsubmittedEdits: false,
      acceptInProgress: false,
      canReview: true,
      canAccept: true,
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
}

async function mockDraftsApi(page: Page, viewer: Record<string, unknown> = {}): Promise<Mock> {
  const mock: Mock = { accepts: [] };
  const json = (data: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify({ data }) });
  await page.route(/\/api\/drafts(\/|\?|$)/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname.endsWith("/accept")) {
      mock.accepts.push(request.postDataJSON());
      return route.fulfill(json({ created: { P: "PRJ-90", B1: "BKT-91", B2: "BKT-92", T1: "TASK-93", T2: "TASK-94" }, alreadyAccepted: false }));
    }
    if (request.method() !== "GET") return route.fulfill({ status: 405, body: "Method Not Allowed" });
    if (/\/api\/drafts\/DRF-7$/.test(url.pathname)) {
      const old = url.searchParams.get("version") === "1";
      return route.fulfill(json({ ...detail(viewer), ...(old ? { version: VERSION_1 } : {}) }));
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
    for (const query of ["", "&draftId=DRF-7"]) {
      for (const [name, width, height] of WIDTHS) {
        await page.setViewportSize({ width, height });
        await openDrafts(page, query);
        const label = `drafts${query ? "-record" : "-list"}/${name}`;
        await page.screenshot({ path: `${SHOT_DIR}/${label.replace("/", "-")}.png`, fullPage: true });
        await expectSurfaceNoHorizontalOverflow(page, "drafts-screen", label);
        const results = await new AxeBuilder({ page }).include("[data-testid='drafts-screen']").withTags(TAGS).analyze();
        expect(results.violations, label).toEqual([]);
      }
    }
  });
});
