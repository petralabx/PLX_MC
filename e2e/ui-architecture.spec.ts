import { readFileSync } from "node:fs";
import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { expectSurfaceNoHorizontalOverflow } from "./helpers/ui-loop-surfaces";

const ROUTE = "/?screen=architecture";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOT_DIR = ".orchestrator/interactive-architecture-visualization/P2/screenshots";

function allowedRuleIds(): Set<string> {
  try {
    const raw = JSON.parse(
      readFileSync(join(process.cwd(), "e2e/ui-a11y-allowlist.json"), "utf8")
    ) as Record<string, unknown>;
    const entry = raw[ROUTE];
    return new Set(Array.isArray(entry) ? (entry as string[]) : []);
  } catch {
    return new Set();
  }
}

async function gotoArchitecture(page: import("@playwright/test").Page): Promise<void> {
  await page.goto(ROUTE);
  await expect(page.locator("[data-mc-ready='true']")).toBeAttached({ timeout: 30_000 });
  await expect(page.locator("[data-testid='arch-screen']")).toBeVisible();
  await expect(page.locator("[data-testid='arch-canvas']")).toBeVisible({
    timeout: 20_000,
  });
}

test.describe("architecture responsive (G3)", () => {
  test.beforeEach(async ({ page }) => {
    await gotoArchitecture(page);
  });

  test("architecture view: no horizontal overflow", async ({ page }, testInfo) => {
    await page.screenshot({
      path: `${SHOT_DIR}/${testInfo.project.name}.png`,
      fullPage: true,
    });
    await expectSurfaceNoHorizontalOverflow(
      page,
      "arch-screen",
      `architecture/${testInfo.project.name}`
    );
  });

  test("detail panel fits narrow viewport", async ({ page }, testInfo) => {
    if (testInfo.project.name === "chromium") return;
    await page.locator("[data-testid^='arch-node-']").first().click();
    await expect(page.locator("[data-testid='arch-detail']")).toBeVisible();
    await expectSurfaceNoHorizontalOverflow(
      page,
      "arch-screen",
      `architecture/detail/${testInfo.project.name}`
    );
  });
});

test.describe("architecture a11y (G4)", () => {
  test.beforeEach(async ({ page }) => {
    await gotoArchitecture(page);
  });

  test("architecture view has no axe violations", async ({ page }) => {
    const allowed = allowedRuleIds();
    const results = await new AxeBuilder({ page })
      .include('[data-testid="arch-screen"]')
      .withTags(TAGS)
      .analyze();
    const violations = results.violations.filter((v) => !allowed.has(v.id));
    expect(violations).toEqual([]);
  });

  test("keyboard focus reaches canvas controls", async ({ page }) => {
    await page.locator("[data-testid='arch-export-svg']").focus();
    await expect(page.locator("[data-testid='arch-export-svg']")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator("[data-testid='arch-print']")).toBeFocused();
  });
});
