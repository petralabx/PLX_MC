import { readFileSync } from "node:fs";
import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { gotoRoutingInbox, mockRoutingInboxApi } from "./helpers";
import { expectSurfaceNoHorizontalOverflow } from "./helpers/ui-loop-surfaces";

const ROUTE = "/?screen=routing-inbox";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOT_DIR = ".orchestrator/mc-brand-ui/routing-inbox";

function allowedRuleIds(): Set<string> {
  try {
    const raw = JSON.parse(readFileSync(join(process.cwd(), "e2e/ui-a11y-allowlist.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const entry = raw[ROUTE] ?? raw["/routing-inbox"];
    return new Set(Array.isArray(entry) ? (entry as string[]) : []);
  } catch {
    return new Set();
  }
}

test.describe("routing inbox UI (P9)", () => {
  test.beforeEach(async ({ page }) => {
    await mockRoutingInboxApi(page);
    await gotoRoutingInbox(page);
  });

  test("shows personal / scoped / Unrouted queues and proposal detail", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /Routing inbox/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Needs your decision/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Unrouted/i })).toBeVisible();
    const row = page.locator(".ri-row", { hasText: "Wire routing inbox" });
    await expect(row).toBeVisible();
    await row.click();
    const detail = page.getByLabel("Proposal detail");
    await expect(detail.getByText("Accountable", { exact: true })).toBeVisible();
    await expect(detail.getByText("sync_stale", { exact: true })).toBeVisible();
    await expect(detail.getByRole("button", { name: "Accept" }).first()).toBeVisible();
  });

  test("keyboard: arrow keys move between queue tabs", async ({ page }) => {
    const personal = page.getByRole("tab", { name: /Needs your decision/i });
    await personal.focus();
    await expect(personal).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: /Project-scoped/i })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  test("no horizontal overflow (desktop/tablet/mobile)", async ({ page }, testInfo) => {
    await page.screenshot({ path: `${SHOT_DIR}/${testInfo.project.name}.png`, fullPage: true });
    await expectSurfaceNoHorizontalOverflow(
      page,
      "routing-inbox-screen",
      `routing-inbox/${testInfo.project.name}`
    );
  });

  test("axe: no violations on routing inbox surface", async ({ page }) => {
    const allowed = allowedRuleIds();
    const results = await new AxeBuilder({ page })
      .include('[data-testid="routing-inbox-screen"]')
      .withTags(TAGS)
      .analyze();
    const violations = results.violations.filter((v) => !allowed.has(v.id));
    expect(violations).toEqual([]);
  });
});
