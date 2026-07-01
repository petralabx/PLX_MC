import { readFileSync } from "node:fs";
import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { gotoSkillsDirectory } from "./helpers";
import { mockSkillsDirectoryApi } from "./helpers/ui-loop-surfaces";

const ROUTE = "/skills-directory";
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

test.describe("skills directory a11y (G4)", () => {
  test.beforeEach(async ({ page }) => {
    await mockSkillsDirectoryApi(page);
    await gotoSkillsDirectory(page);
  });

  test("skills catalog has no axe violations", async ({ page }) => {
    const allowed = allowedRuleIds();
    const results = await new AxeBuilder({ page })
      .include('[data-testid="sk-screen"]')
      .withTags(TAGS)
      .analyze();
    const violations = results.violations.filter((v) => !allowed.has(v.id));
    expect(violations).toEqual([]);
  });
});
