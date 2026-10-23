import { expect, test, type Page } from "@playwright/test";

import { waitForHydration } from "./helpers";
import { approvalsInboxRoute } from "./helpers/ui-loop/mc.routes";

// TASK-3721: the Approvals decision desk end to end — answering my own
// question (mouse and keys), a colleague's read-only question with Remind under
// My projects, the Decided record, and the phone queue → sheet → queue flow.
// Every Approvals API is stubbed on the local server; the e2e viewer is the
// dormant operator ("vince"), so questions addressed to vince are "mine".

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

const G07 = "Setup data decided 18 Oct: Vince signs the account and dimension tables (G0.7)";

function question(id: string, addressee: string, text: string, askedAt: string, over: Record<string, unknown> = {}) {
  return {
    id,
    addressee,
    text,
    options: [] as string[],
    askedBy: "cos@petrasoap.com",
    askedByPrincipal: "sp_mcp_claude_code",
    askedRuntime: "claude-code",
    askedAt,
    status: "open",
    ...over,
  };
}

const V5 = question("q_v5", "vince", "Put a DIVISION default on PHSI's PLX and PETRA partner cards now?", hoursAgo(2), {
  options: [
    "Yes: put a DIVISION default on PHSI's PLX and PETRA partner cards now",
    "No: staff fill DIVISION on each PHSI intercompany line",
    "Later: decide when the PHSI book is built",
  ],
  recommended: 0,
  recommendationReason: "It fills DIVISION on every PHSI intercompany line without typing.",
  context: "In BC, an intercompany partner card is PHSI's record of a book it trades with.",
});
const V6 = question("q_v6", "vince", "Leave accounts 11306, 21145 and 41905 out of the new books?", hoursAgo(3), {
  options: ["Leave them out, as drafted", "Create them Blocked"],
  recommended: 0,
});
const STEPHEN = question("q_2fa", "stephen", "Turn on two-factor sign-in for every portal customer at go-live?", hoursAgo(96), {
  options: ["Yes, at go-live", "Yes, 30 days after go-live", "No, staff accounts only"],
});

const GATE_ROW = {
  taskId: "TASK-3302",
  taskTitle: "Validate ledgers: reject duplicate migration prefixes",
  stage: "review",
  evidence: null,
  gate: {
    id: "apg_7k2m",
    reason: "Approve the merge of PR #412 into PLX_MC?",
    requestedBy: "agent:e2e",
    requestedRuntime: "cursor",
    requestedAt: hoursAgo(5),
    status: "pending",
  },
};

interface Posted {
  answers: Record<string, unknown>[];
  reminders: Record<string, unknown>[];
}

async function stubDesk(page: Page): Promise<Posted> {
  const posted: Posted = { answers: [], reminders: [] };
  let mine = [
    { taskId: "TASK-3296", taskTitle: G07, stage: "backlog", question: V5 },
    { taskId: "TASK-3296", taskTitle: G07, stage: "backlog", question: V6 },
  ];
  let stephen = { ...STEPHEN };
  const json = (data: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify({ data }) });

  await page.route(/\/api\/approvals(\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill(json({ approvals: [GATE_ROW] }));
  });
  await page.route(/\/api\/questions(\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill(json({ questions: mine }));
  });
  await page.route(/\/api\/questions\/answer$/, async (route) => {
    const body = route.request().postDataJSON() as { questionId: string };
    posted.answers.push(body);
    mine = mine.filter((row) => row.question.id !== body.questionId);
    await route.fulfill(json({ question: { id: body.questionId, status: "answered" }, taskId: "TASK-3296" }));
  });
  await page.route(/\/api\/questions\/remind$/, async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    posted.reminders.push(body);
    stephen = { ...stephen, reminders: [{ by: "vince", at: new Date().toISOString(), commentId: "CMT-r1" }] } as typeof stephen;
    await route.fulfill(json({ question: stephen }));
  });
  await page.route(/\/api\/approvals\/projects$/, async (route) => {
    await route.fulfill(
      json({
        projects: [{ id: "PRJ-PORTAL-GOLIVE", name: "PLX Portal Go-Live", reasons: ["owner"] }],
        questions: [
          { taskId: "TASK-3305", taskTitle: "Portal sign-in hardening", stage: "build", projectId: "PRJ-PORTAL-GOLIVE", question: stephen },
        ],
        gates: [],
      })
    );
  });
  await page.route(/\/api\/approvals\/decided(\?.*)?$/, async (route) => {
    await route.fulfill(
      json({
        decided: [
          {
            kind: "question",
            taskId: "TASK-3296",
            taskTitle: G07,
            decidedAt: hoursAgo(20),
            question: question("q_v4", "vince", "Restrict DIVISION with an Allowed Values Filter?", hoursAgo(30), {
              options: ["Yes", "No"],
              status: "answered",
              answer: { choice: 0, answeredBy: "vince", answeredAt: hoursAgo(20), commentId: "CMT-a1" },
            }),
          },
        ],
      })
    );
  });
  return posted;
}

async function openDesk(page: Page, viewport = { width: 1440, height: 900 }) {
  await page.setViewportSize(viewport);
  const posted = await stubDesk(page);
  await page.goto(approvalsInboxRoute.path);
  await waitForHydration(page);
  const screen = page.getByTestId(approvalsInboxRoute.testId);
  await expect(screen.getByRole("heading", { level: 1, name: /Three decisions waiting on you/ })).toBeVisible();
  return { posted, screen, sheet: screen.getByTestId("decision-sheet") };
}

test.describe("approvals decision desk", () => {
  test("answering my question posts the choice and moves to the next item", async ({ page }) => {
    const { posted, screen, sheet } = await openDesk(page);
    await screen.locator(".ap-item", { hasText: "DIVISION default" }).click();
    await expect(sheet.getByTestId("question-card")).toBeVisible();
    await expect(sheet.getByText("intercompany partner card")).toBeVisible();
    await sheet.getByLabel(/Yes: put a DIVISION default/).check();
    await sheet.getByRole("button", { name: "Send answer" }).click();
    await expect(screen.getByText("Answer posted to TASK-3296.")).toBeVisible();
    expect(posted.answers).toEqual([expect.objectContaining({ taskId: "TASK-3296", questionId: "q_v5", choice: 0 })]);
    await expect(screen.locator(".ap-item", { hasText: "DIVISION default" })).toHaveCount(0);
    // Auto-advance: the next open item, V6, is now in the sheet.
    await expect(sheet.getByRole("heading", { name: /Leave accounts 11306/ })).toBeVisible();
  });

  test("keys pick an option and Ctrl+Enter sends it, only while focus is in the screen", async ({ page }) => {
    const { posted, screen, sheet } = await openDesk(page);
    await screen.locator(".ap-item", { hasText: "Leave accounts 11306" }).click();
    await page.keyboard.press("2");
    await expect(sheet.getByLabel("Create them Blocked")).toBeChecked();
    await page.keyboard.press("Control+Enter");
    await expect.poll(() => posted.answers.length).toBe(1);
    expect(posted.answers[0]).toMatchObject({ questionId: "q_v6", choice: 1 });
  });

  test("My projects shows a colleague's question read-only, with Remind", async ({ page }) => {
    const { posted, screen, sheet } = await openDesk(page);
    await screen.getByRole("button", { name: /My projects/ }).click();
    await screen.locator(".ap-item", { hasText: "two-factor sign-in" }).click();
    const colleague = sheet.getByTestId("colleague-question");
    await expect(colleague).toBeVisible();
    await expect(colleague.getByText("Only Stephen Alton can answer this.")).toBeVisible();
    await expect(sheet.locator("input[type=radio]")).toHaveCount(0);
    await expect(sheet.getByRole("button", { name: "Send answer" })).toHaveCount(0);
    await sheet.getByRole("button", { name: "Remind Stephen" }).click();
    await expect(sheet.getByRole("button", { name: "Reminder sent" })).toBeDisabled();
    expect(posted.reminders).toEqual([{ taskId: "TASK-3305", questionId: "q_2fa" }]);
  });

  test("Decided shows what I answered", async ({ page }) => {
    const { screen, sheet } = await openDesk(page);
    await screen.getByRole("button", { name: /^Decided/ }).click();
    await screen.locator(".ap-item", { hasText: "Allowed Values Filter" }).click();
    await expect(sheet.getByTestId("decided-record")).toBeVisible();
    await expect(sheet.getByTestId("decided-record").getByText("Yes", { exact: true })).toBeVisible();
  });

  test("Ctrl/Cmd+Enter never approves a gate; only a click on Approve does", async ({ page }) => {
    const { screen, sheet } = await openDesk(page);
    const decisions: unknown[] = [];
    await page.route(/\/api\/approvals\/decide$/, async (route) => {
      decisions.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: {} }) });
    });
    await screen.locator(".ap-item", { hasText: "Approve the merge" }).click();
    await expect(sheet.getByTestId("approval-gate")).toBeVisible();
    await page.keyboard.press("Control+Enter");
    await page.keyboard.press("Meta+Enter");
    await sheet.getByLabel("Decision note").focus();
    await page.keyboard.press("Control+Enter");
    // Positive control: the same probe sees a decision made with the button.
    await sheet.getByRole("button", { name: "Approve", exact: true }).click();
    await expect.poll(() => decisions.length).toBe(1);
    expect(decisions[0]).toMatchObject({ gateId: "apg_7k2m", decision: "approved" });
  });

  test("phone: a link to a question that is not open shows the queue, not another sheet", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await stubDesk(page);
    await page.goto(`${approvalsInboxRoute.path}&question=q_gone`);
    await waitForHydration(page);
    const screen = page.getByTestId(approvalsInboxRoute.testId);
    await expect(screen.getByText(/The linked question is not open for you/)).toBeVisible();
    await expect(screen.getByTestId("decision-queue")).toBeVisible();
    await expect(screen.getByRole("button", { name: "Back to queue" })).toBeHidden();
    await screen.getByTestId("decision-queue").locator(".ap-item", { hasText: "DIVISION default" }).click();
    await expect(screen.getByRole("button", { name: "Back to queue" })).toBeVisible();
  });

  test("phone: the queue opens one sheet at a time and Back returns to it", async ({ page }) => {
    const { screen, sheet } = await openDesk(page, { width: 390, height: 844 });
    const queue = screen.getByTestId("decision-queue");
    await queue.locator(".ap-item", { hasText: "DIVISION default" }).click();
    await expect(sheet.getByRole("button", { name: "Back to queue" })).toBeVisible();
    await expect(queue).toBeHidden();
    await sheet.getByRole("button", { name: "Back to queue" }).click();
    await expect(queue).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  // TASK-3559: gateLink() sends an approver straight to one gate.
  test("a gate link opens that gate's sheet, not the first item in the queue", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await stubDesk(page);
    await page.goto(`${approvalsInboxRoute.path}&gate=${GATE_ROW.gate.id}`);
    await waitForHydration(page);
    const screen = page.getByTestId(approvalsInboxRoute.testId);
    const sheet = screen.getByTestId("decision-sheet");
    await expect(sheet.getByTestId("approval-gate")).toBeVisible();
    await expect(sheet.getByRole("heading", { name: GATE_ROW.gate.reason })).toBeVisible();
  });

  test("phone: a link to a gate that is not waiting shows the queue and says why", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await stubDesk(page);
    await page.goto(`${approvalsInboxRoute.path}&gate=apg_gone`);
    await waitForHydration(page);
    const screen = page.getByTestId(approvalsInboxRoute.testId);
    await expect(screen.getByText(/The linked gate is not waiting for a decision/)).toBeVisible();
    await expect(screen.getByTestId("decision-queue")).toBeVisible();
    await expect(screen.getByRole("button", { name: "Back to queue" })).toBeHidden();
  });
});
