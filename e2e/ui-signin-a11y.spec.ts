import { readFileSync } from "node:fs";
import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const ROUTE = "/signin";
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

function summarize(violations: AxeViolation[]): string {
  if (violations.length === 0) return "no violations";
  return violations.map((v) => `${v.id} (${v.impact ?? "?"}) x${v.nodes.length}: ${v.help}`).join("\n");
}

test.describe("sign-in a11y (G4)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/signin");
    await expect(page.locator("[data-testid='signin-screen']")).toBeVisible();
  });

  test("sign-in card has no axe violations", async ({ page }) => {
    const allowed = allowedRuleIds();
    const results = await new AxeBuilder({ page })
      .include('[data-testid="signin-screen"]')
      .withTags(TAGS)
      .analyze();
    const violations = (results.violations as AxeViolation[]).filter((v) => !allowed.has(v.id));
    expect(violations, summarize(violations)).toEqual([]);
  });
});
