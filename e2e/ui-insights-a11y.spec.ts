import { readFileSync } from "node:fs";
import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { gotoInsights } from "./helpers";

const ROUTE = "/insights";
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

test.describe("insights a11y (G4)", () => {
  test.beforeEach(async ({ page }) => {
    await gotoInsights(page);
  });

  test("insights view has no axe violations", async ({ page }) => {
    const allowed = allowedRuleIds();
    const results = await new AxeBuilder({ page })
      .include('[data-testid="insights-screen"]')
      .withTags(TAGS)
      .analyze();
    const violations = results.violations.filter((v) => !allowed.has(v.id));
    expect(violations).toEqual([]);
  });

  // Hover is a state too (WCAG 1.4.3). Test it on purpose: the scan above only
  // saw it when the sidebar click happened to leave the pointer on this KPI.
  test("a hovered Unassigned KPI keeps its contrast", async ({ page }) => {
    const allowed = allowedRuleIds();
    const kpi = page.locator('[data-testid="insights-screen"] .kpi.clickable');
    await expect(kpi).toBeEnabled();
    await kpi.hover();
    const results = await new AxeBuilder({ page })
      .include('[data-testid="insights-screen"] .kpis')
      .withTags(TAGS)
      .analyze();
    const violations = results.violations.filter((v) => !allowed.has(v.id));
    expect(violations).toEqual([]);
  });
});
