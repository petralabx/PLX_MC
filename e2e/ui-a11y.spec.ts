import { readFileSync } from "node:fs";
import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { mockLoopLedgers, openLoopLedgers } from "./helpers/loop-ledgers-fixtures";
import { openSidebar, waitForHydration } from "./helpers";

// G4 — accessibility gate (ui-ux-design-loop). Runs axe (WCAG 2.0/2.1 A+AA) on
// the three loop-ledgers sub-views, across the desktop/tablet/mobile project
// matrix (playwright.config.ts). Honors the route-keyed allowlist; strict by
// default — any un-allowlisted violation fails.

const ROUTE = "/loop-ledgers";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

function allowedRuleIds(): Set<string> {
  try {
    const raw = JSON.parse(readFileSync(join(process.cwd(), "e2e/ui-a11y-allowlist.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const entry = raw[ROUTE];
    return new Set(Array.isArray(entry) ? (entry as string[]) : []);
  } catch {
    return new Set();
  }
}

interface AxeViolation {
  id: string;
  impact?: string | null;
  help: string;
  nodes: unknown[];
}

async function analyze(page: Parameters<typeof mockLoopLedgers>[0]): Promise<AxeViolation[]> {
  const allowed = allowedRuleIds();
  // Scope to the loop-ledgers SURFACE — this gate owns the loop-ledgers screen,
  // not the shared MC shell chrome (topbar/sidebar), whose contrast is a separate
  // pre-existing brand-wide concern out of this loop's scope.
  const results = await new AxeBuilder({ page }).include('[data-testid="ll-screen"]').withTags(TAGS).analyze();
  return (results.violations as AxeViolation[]).filter((v) => !allowed.has(v.id));
}

function summarize(violations: AxeViolation[]): string {
  if (violations.length === 0) return "no violations";
  return violations.map((v) => `${v.id} (${v.impact ?? "?"}) x${v.nodes.length}: ${v.help}`).join("\n");
}

test.describe("loop-ledgers a11y (G4)", () => {
  test.beforeEach(async ({ page }) => {
    await mockLoopLedgers(page);
    await openLoopLedgers(page);
    await expect(page.locator("[data-testid='ll-screen']")).toBeVisible();
  });

  test("cross-repo index has no axe violations", async ({ page }) => {
    const v = await analyze(page);
    expect(v, summarize(v)).toEqual([]);
  });

  test("module detail has no axe violations", async ({ page }) => {
    // Row 2 (scariest-first order) is the stale valid ledger — clicking opens detail.
    await page.locator("[data-testid='ll-row']").nth(2).click();
    await expect(page.locator("[data-testid='ll-detail-view']")).toBeVisible();
    const v = await analyze(page);
    expect(v, summarize(v)).toEqual([]);
  });

  test("degraded gallery has no axe violations", async ({ page }) => {
    await page.locator(".ll-tab", { hasText: "Degraded gallery" }).click();
    await expect(page.locator("[data-testid='ll-gallery']")).toBeVisible();
    const v = await analyze(page);
    expect(v, summarize(v)).toEqual([]);
  });
});

// ─── G4 — governance-sops (MC-SOP-Guide) ──────────────────────────────────────
// Same gate, the SOP surface. Real API (the dev server reads the committed
// registry + docs/COLLABORATOR-SOP.md). Scoped to the SOP screen; honors the
// /governance-sops allowlist. Structural a11y stays true-zero; only the brand
// --p-muted contrast token is allowlisted (ADR-003), matching loop-ledgers.

const GS_ROUTE = "/governance-sops";

function allowedRuleIdsGs(): Set<string> {
  try {
    const raw = JSON.parse(
      readFileSync(join(process.cwd(), "e2e/ui-a11y-allowlist.json"), "utf8")
    ) as Record<string, unknown>;
    const entry = raw[GS_ROUTE];
    return new Set(Array.isArray(entry) ? (entry as string[]) : []);
  } catch {
    return new Set();
  }
}

async function analyzeGs(page: Parameters<typeof mockLoopLedgers>[0]): Promise<AxeViolation[]> {
  const allowed = allowedRuleIdsGs();
  const results = await new AxeBuilder({ page }).include('[data-testid="gs-screen"]').withTags(TAGS).analyze();
  return (results.violations as AxeViolation[]).filter((v) => !allowed.has(v.id));
}

test.describe("governance-sops a11y (G4)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForHydration(page);
    await openSidebar(page, "SOP guide");
    await expect(page.locator("[data-testid='gs-screen']")).toBeVisible();
  });

  test("SOP index has no axe violations", async ({ page }) => {
    const v = await analyzeGs(page);
    expect(v, summarize(v)).toEqual([]);
  });

  test("Collaborator SOP detail has no axe violations", async ({ page }) => {
    await page.locator("[data-testid='gs-row'][data-slug='mc-sop-collaborator']").click();
    await expect(page.locator("[data-testid='gs-detail-view']")).toBeVisible();
    const v = await analyzeGs(page);
    expect(v, summarize(v)).toEqual([]);
  });

  test("planned SOP no-content panel has no axe violations", async ({ page }) => {
    await page.locator("[data-testid='gs-row'][data-state='planned']").first().click();
    await expect(page.locator("[data-testid='gs-nocontent']")).toBeVisible();
    const v = await analyzeGs(page);
    expect(v, summarize(v)).toEqual([]);
  });
});
