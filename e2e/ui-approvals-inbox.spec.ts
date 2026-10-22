import { expect, test, type Page } from "@playwright/test";

import { waitForHydration } from "./helpers";
import {
  approvalsInboxRoute,
  mockApprovalsApi,
  type E2EApprovalRow,
} from "./helpers/ui-loop/mc.routes";

// Below the 1600px pane breakpoint, a task opened from Approvals is the task
// page (nav goes to screen=task). At ≥1600 the same click fills the pane.
const VIEWPORT = { width: 1440, height: 900 };

const APPROVE_ROW: E2EApprovalRow = {
  taskId: "TASK-227",
  taskTitle: "Test product development",
  stage: "qa",
  evidence: {
    summary: "Evidence-gated test week for Product Development (Jun 29).",
    itemKeys: ["summary", "qa", "shots", "rollback"],
  },
  gate: {
    id: "apg_approve",
    reason: "Promote the test week",
    requestedBy: "agent:e2e",
    requestedAt: "2026-09-25T09:00:00Z",
    status: "pending",
  },
};

const REJECT_ROW: E2EApprovalRow = {
  taskId: "TASK-230",
  taskTitle: "Test Finance",
  stage: "qa",
  evidence: {
    summary: "Evidence-gated test week for Finance (Jul 20).",
    itemKeys: ["summary", "qa", "shots", "rollback"],
  },
  gate: {
    id: "apg_reject",
    reason: "Hold the finance deploy",
    requestedBy: "agent:e2e",
    requestedAt: "2026-09-25T10:00:00Z",
    status: "pending",
  },
};

async function openApprovals(page: Page) {
  await page.setViewportSize(VIEWPORT);
  const stub = await mockApprovalsApi(page, [APPROVE_ROW, REJECT_ROW]);
  await page.goto(approvalsInboxRoute.path);
  await waitForHydration(page);
  const screen = page.getByTestId(approvalsInboxRoute.testId);
  await expect(screen).toBeVisible();
  // TASK-3721: the h1 is the count headline; "Approvals" is the kicker.
  await expect(screen.getByRole("heading", { level: 1, name: /Two decisions waiting on you/ })).toBeVisible();
  await expect(screen.locator(".ap-item", { hasText: "Promote the test week" })).toBeVisible();
  await expect(screen.locator(".ap-item", { hasText: "Hold the finance deploy" })).toBeVisible();
  return { ...stub, screen, sheet: screen.getByTestId("decision-sheet") };
}

test.describe("approvals inbox — approve and reject", () => {
  // TASK-3721: a row selects its gate; Approve, Reject, the note and the
  // evidence link live in the decision sheet beside the queue.
  test("approve posts the decision and drops only that row", async ({ page }) => {
    const { decisions, screen, sheet } = await openApprovals(page);
    await screen.locator(".ap-item", { hasText: "Promote the test week" }).click();
    await expect(sheet.getByRole("heading", { name: "Promote the test week" })).toBeVisible();
    await expect(
      sheet.getByRole("link", { name: /Evidence: Evidence-gated test week for Product Development/ })
    ).toBeVisible();
    await sheet.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(screen.locator(".ap-item", { hasText: "Promote the test week" })).toHaveCount(0);
    await expect(screen.locator(".ap-item", { hasText: "Hold the finance deploy" })).toBeVisible();
    expect(decisions).toEqual([{ taskId: "TASK-227", gateId: "apg_approve", decision: "approved" }]);
  });

  test("reject posts the decision, including the note, and drops only that row", async ({ page }) => {
    const { decisions, screen, sheet } = await openApprovals(page);
    await screen.locator(".ap-item", { hasText: "Hold the finance deploy" }).click();
    await expect(sheet.getByRole("heading", { name: "Hold the finance deploy" })).toBeVisible();
    await expect(
      sheet.getByRole("link", { name: /Evidence: Evidence-gated test week for Finance/ })
    ).toBeVisible();
    await sheet.getByLabel("Decision note").fill("not yet");
    await sheet.getByRole("button", { name: "Reject" }).click();
    await expect(screen.locator(".ap-item", { hasText: "Hold the finance deploy" })).toHaveCount(0);
    await expect(screen.locator(".ap-item", { hasText: "Promote the test week" })).toBeVisible();
    expect(decisions).toEqual([
      { taskId: "TASK-230", gateId: "apg_reject", decision: "rejected", note: "not yet" },
    ]);
  });

  test("each gate's evidence link opens that task's evidence bundle", async ({ page }) => {
    const { screen, sheet } = await openApprovals(page);
    await screen.locator(".ap-item", { hasText: "Promote the test week" }).click();
    await sheet.getByRole("link", { name: /Evidence: Evidence-gated test week for Product Development/ }).click();
    await expect(page).toHaveURL(/screen=task/);
    await expect(page).toHaveURL(/taskId=TASK-227/);
    await expect(page).toHaveURL(/focus=evidence/);
    const evidence = page.locator("#task-evidence");
    await expect(evidence).toBeVisible();
    await expect(evidence).toContainText("Evidence bundle");
    await expect(evidence).toContainText("Evidence-gated test week for Product Development (Jun 29).");
  });
});
