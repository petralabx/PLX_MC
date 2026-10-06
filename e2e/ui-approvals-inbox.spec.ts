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
  await expect(screen.getByRole("heading", { name: "Approvals" })).toBeVisible();
  await expect(screen.getByText("Promote the test week")).toBeVisible();
  await expect(screen.getByText("Hold the finance deploy")).toBeVisible();
  return { ...stub, screen };
}

test.describe("approvals inbox — approve and reject", () => {
  test("approve posts the decision and drops only that row", async ({ page }) => {
    const { decisions, screen } = await openApprovals(page);
    const row = screen.locator(".ap-item", { hasText: "Promote the test week" });
    await expect(
      row.getByRole("link", { name: /Evidence: Evidence-gated test week for Product Development/ })
    ).toBeVisible();
    await row.getByRole("button", { name: "Approve" }).click();
    await expect(screen.locator(".ap-item", { hasText: "Promote the test week" })).toHaveCount(0);
    await expect(screen.locator(".ap-item", { hasText: "Hold the finance deploy" })).toBeVisible();
    expect(decisions).toEqual([{ taskId: "TASK-227", gateId: "apg_approve", decision: "approved" }]);
  });

  test("reject posts the decision, including the note, and drops only that row", async ({ page }) => {
    const { decisions, screen } = await openApprovals(page);
    const row = screen.locator(".ap-item", { hasText: "Hold the finance deploy" });
    await expect(
      row.getByRole("link", { name: /Evidence: Evidence-gated test week for Finance/ })
    ).toBeVisible();
    await row.getByPlaceholder("Optional decision note").fill("not yet");
    await row.getByRole("button", { name: "Reject" }).click();
    await expect(screen.locator(".ap-item", { hasText: "Hold the finance deploy" })).toHaveCount(0);
    await expect(screen.locator(".ap-item", { hasText: "Promote the test week" })).toBeVisible();
    expect(decisions).toEqual([
      { taskId: "TASK-230", gateId: "apg_reject", decision: "rejected", note: "not yet" },
    ]);
  });

  test("each row's evidence link opens that task's evidence bundle", async ({ page }) => {
    const { screen } = await openApprovals(page);
    const row = screen.locator(".ap-item", { hasText: "Promote the test week" });
    await row.getByRole("link", { name: /Evidence: Evidence-gated test week for Product Development/ }).click();
    await expect(page).toHaveURL(/screen=task/);
    await expect(page).toHaveURL(/taskId=TASK-227/);
    await expect(page).toHaveURL(/focus=evidence/);
    const evidence = page.locator("#task-evidence");
    await expect(evidence).toBeVisible();
    await expect(evidence).toContainText("Evidence bundle");
    await expect(evidence).toContainText("Evidence-gated test week for Product Development (Jun 29).");
  });
});
