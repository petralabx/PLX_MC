// UI-loop route descriptors for MC surfaces (G2/G4 traceability).
// Most MC screens live inside the shell sidebar, not dedicated URLs.
// Gate specs navigate via sidebar labels documented here.

import type { Page } from "@playwright/test";

export const mcShellRoutes = [
  { path: "/", name: "inbox", sidebar: "Inbox", testId: "inbox-screen" },
  {
    path: "/?screen=approvals",
    name: "approvals",
    sidebar: "Approvals",
    testId: "approvals-screen",
  },
  { path: "/", name: "board", sidebar: "Board", testId: "board-screen" },
  { path: "/", name: "insights", sidebar: "Insights", testId: "insights-screen" },
  { path: "/", name: "ai-spend", sidebar: "AI Spend", testId: "ai-spend-screen" },
  { path: "/", name: "sync-console", sidebar: "Sync", testId: "sync-console-screen" },
  { path: "/", name: "repos", sidebar: "Repos", testId: "repos-screen" },
  { path: "/", name: "skills-directory", sidebar: "Skills directory", testId: "sk-screen" },
  { path: "/", name: "loop-ledgers", sidebar: "Loop ledgers", testId: "ll-screen" },
  { path: "/", name: "governance-sops", sidebar: "SOP guide", testId: "gs-screen" },
  { path: "/", name: "architecture", sidebar: "Architecture", testId: "arch-screen" },
  { path: "/", name: "task-detail", sidebar: "Board", testId: "task-detail-screen", note: "Open via board card click" },
  { path: "/", name: "command-palette", sidebar: "", testId: "cmdk", note: "Open via ControlOrMeta+k" },
] as const;

export const mcAuthRoutes = [{ path: "/signin", name: "sign-in", testId: "signin-screen" }] as const;

export const approvalsInboxRoute = mcShellRoutes.find((route) => route.name === "approvals")!;

export interface E2EApprovalGate {
  id: string;
  reason: string;
  requestedBy: string;
  requestedAt: string;
  status: "pending";
  requestedRuntime?: string;
}

export interface E2EApprovalRow {
  taskId: string;
  taskTitle: string;
  stage: string;
  gate: E2EApprovalGate;
  evidence: { summary: string; itemKeys: string[] } | null;
}

export interface E2EApprovalDecision {
  taskId: string;
  gateId: string;
  decision: "approved" | "rejected";
  note?: string;
}

/**
 * Stub GET /api/approvals and POST /api/approvals/decide on the local Playwright
 * server. A decision drops that gate from the next list response. Never reaches
 * a live Mission Control host.
 */
export async function mockApprovalsApi(
  page: Page,
  initial: E2EApprovalRow[]
): Promise<{ decisions: E2EApprovalDecision[] }> {
  const decisions: E2EApprovalDecision[] = [];
  let approvals = initial.map((row) => ({ ...row, gate: { ...row.gate } }));

  await page.route(/\/api\/approvals\/decide$/, async (route) => {
    const body = route.request().postDataJSON() as E2EApprovalDecision;
    decisions.push(body);
    approvals = approvals.filter((row) => row.gate.id !== body.gateId);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: { gate: { id: body.gateId, status: body.decision }, taskId: body.taskId },
      }),
    });
  });

  await page.route(/\/api\/approvals(\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { approvals } }),
    });
  });

  return { decisions };
}

export { loopLedgersRoutes } from "./loop-ledgers.routes";
