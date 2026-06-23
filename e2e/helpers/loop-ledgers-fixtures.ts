import type { Page } from "@playwright/test";

import { openSidebar, waitForHydration } from "../helpers";

// Shared loop-ledgers API fixtures + mock/navigation helpers, reused by the
// behavioral spec and the ui-ux-design-loop G3/G4 gate specs so all three drive
// the same deterministic data (a mix of healthy + degraded, scariest-first).

export const FIXTURE_ROWS = [
  {
    kind: "degraded-source",
    repo: "taylorvalton/plx-customer-portal",
    repoDisplayName: "PLX Customer Portal",
    reason: "permission_denied",
    note: "HTTP 403 — private repo, no access.",
  },
  {
    kind: "degraded-source",
    repo: "taylorvalton/schema-wrong",
    repoDisplayName: "Schema Wrong",
    reason: "schema_mismatch",
    note: "schema_version mismatch — expected vmc-quality-ledger/v1.",
  },
  {
    kind: "ledger",
    ref: { repo: "taylorvalton/plx-mc", branch: "main", path: "docs/plx-mc/quality-ledger/loop-ledgers.artifacts.json" },
    repo: "taylorvalton/plx-mc",
    repoDisplayName: "PLX MC",
    validationResult: {
      valid: true,
      healthCode: "valid",
      ledger: {
        schema_version: "vmc-quality-ledger/v1",
        module: "loop-ledgers",
        generated_at: new Date(Date.now() - 35 * 86_400_000).toISOString(),
        branch: "main",
        summary: {
          total_artifacts: 2,
          by_type: { defect: 1, risk: 1 },
          by_status: { broken: 1, unknown: 1 },
          by_severity: { critical: 1, medium: 1 },
          by_safety_class: { red: 1, green: 1 },
        },
        artifacts: [
          {
            artifact_id: "LL-001",
            module: "loop-ledgers",
            artifact_type: "defect",
            title: "Cross-repo loader stalls",
            status: "broken",
            severity: "critical",
            safety_class: "red",
            confidence: 0.4,
            next_action: "Investigate loader timeout",
          },
          {
            artifact_id: "LL-002",
            module: "loop-ledgers",
            artifact_type: "risk",
            title: "Registry config drift",
            status: "unknown",
            severity: "medium",
            safety_class: "green",
            confidence: 0.6,
          },
        ],
      },
      errors: [],
      freshnessInfo: { level: "stale", ageDays: 35, reason: "35d > 30d" },
    },
    commitSha: "abc1234def",
  },
  {
    kind: "degraded-source",
    repo: "taylorvalton/agentic-swarm",
    repoDisplayName: "Agentic Swarm",
    reason: "no_ledgers",
    note: "Glob matched 0 files.",
  },
  {
    kind: "ledger",
    ref: { repo: "taylorvalton/agentic-swarm-healthy", branch: "main", path: "docs/quality-ledger/core.artifacts.json" },
    repo: "taylorvalton/agentic-swarm-healthy",
    repoDisplayName: "Agentic Swarm Healthy",
    validationResult: {
      valid: true,
      healthCode: "valid",
      ledger: {
        schema_version: "vmc-quality-ledger/v1",
        module: "core",
        generated_at: new Date(Date.now() - 1 * 86_400_000).toISOString(),
        branch: "main",
        summary: {
          total_artifacts: 1,
          by_type: { user_story: 1 },
          by_status: { covered: 1 },
          by_severity: { low: 1 },
          by_safety_class: { green: 1 },
        },
        artifacts: [
          {
            artifact_id: "S-001",
            module: "core",
            artifact_type: "user_story",
            title: "User can log in",
            status: "covered",
            severity: "low",
            safety_class: "green",
            confidence: 0.95,
          },
        ],
      },
      errors: [],
      freshnessInfo: { level: "fresh", ageDays: 1, reason: "1d" },
    },
    commitSha: "bcd5678efg",
  },
];

export const DETAIL_FIXTURE = {
  ok: true,
  ref: { repo: "taylorvalton/plx-mc", branch: "main", path: "docs/plx-mc/quality-ledger/loop-ledgers.artifacts.json" },
  repo: "taylorvalton/plx-mc",
  repoDisplayName: "PLX MC",
  validationResult: FIXTURE_ROWS[2].validationResult,
  commitSha: "abc1234def",
};

export async function mockLoopLedgers(page: Page): Promise<void> {
  await page.route("**/api/loop-ledgers", (route) => {
    if (route.request().method() !== "GET") {
      return route.fulfill({ status: 405, body: "Method Not Allowed" });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: FIXTURE_ROWS }),
    });
  });
  await page.route("**/api/loop-ledgers/**", (route) => {
    if (route.request().method() !== "GET") {
      return route.fulfill({ status: 405, body: "Method Not Allowed" });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: DETAIL_FIXTURE }),
    });
  });
}

export async function openLoopLedgers(page: Page): Promise<void> {
  await page.goto("/");
  await waitForHydration(page);
  await openSidebar(page, "Loop ledgers");
}
