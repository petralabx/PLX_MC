// The page path and the ? sheet (TASK-3958; portal ADR-011 v2, zone 2 and
// Keys), in the zoned shell (opted in per browser, as UAT does): each path
// segment's menu moves the page, ? and the Help and shortcuts row open the
// sheet (also from the sidebar's tree), the sheet's keys work, and its switch
// turns the single-key shortcuts off and back on, kept across a reload. Each
// test gets a fresh browser context.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { waitForHydration } from "./helpers";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

test.use({ contextOptions: { reducedMotion: "reduce" } });

const optIn = (page: Page) => page.addInitScript(() => window.localStorage.setItem("mc.nav.zones", "1"));

async function open(page: Page, url: string, width = 1440) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(url);
  await waitForHydration(page);
}

const path = (page: Page) => page.getByRole("navigation", { name: "Page path" });
const sheet = (page: Page) => page.getByTestId("shortcuts-sheet");
// Focus on the page itself, so a key reaches the shell's handler.
const onPage = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

test.describe("page path and shortcuts", () => {
  test.beforeEach(async ({ page }) => {
    await optIn(page);
  });

  test("1440: a task page's path is Plan / project / initiative; each menu moves the page", async ({ page }) => {
    await open(page, "/?screen=task&taskId=TASK-221");
    await expect(path(page)).toContainText("Plan");
    const project = path(page).getByRole("button", { name: /^Project: PLX Portal Go-Live/ });
    const initiative = path(page).getByRole("button", { name: /^Initiative: WMS Integration/ });
    await expect(project).toBeVisible();
    await expect(initiative).toBeVisible();

    await initiative.click();
    const menu = page.locator("#mc-path-initiatives");
    await expect(menu).toBeVisible();
    await expect(menu.locator('[aria-current="true"] .nm')).toHaveText("WMS Integration");
    const names = await menu.locator(".item .nm").allInnerTexts();
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
    expect(names.length).toBeGreaterThan(1);
    const results = await new AxeBuilder({ page }).withTags(TAGS).include("header.mc-top").include("#mc-path-initiatives").analyze();
    expect(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual([]);
    await menu.getByRole("link", { name: /Decoupling API/ }).click();
    await expect(page).toHaveURL(/screen=bucket&bucketId=/);
    await expect(menu).toBeHidden();
    await expect(path(page).getByRole("button", { name: /^Initiative: Decoupling API/ })).toBeVisible();

    await project.click();
    const projects = page.locator("#mc-path-projects");
    await expect(projects.locator('[aria-current="true"] .nm')).toHaveText("PLX Portal Go-Live");
    await page.keyboard.press("Escape");
    await expect(projects).toBeHidden();
    await expect(project).toBeFocused();
    await projects.evaluate((el) => (el as HTMLElement).showPopover());
    await projects.getByRole("link", { name: /PLX Portal Go-Live/ }).click();
    await expect(page).toHaveURL(/screen=project&projectId=PRJ-PORTAL-GOLIVE/);
    await expect(path(page).getByRole("button", { name: /^Initiative:/ })).toHaveCount(0);
  });

  test("no path off the project pages, or below 1025px", async ({ page }) => {
    await open(page, "/?screen=board");
    await expect(path(page)).toHaveCount(0);
    await open(page, "/?screen=task&taskId=TASK-221", 820);
    await expect(path(page)).toBeHidden();
  });

  test("? opens the sheet from the page and from the sidebar's tree; Esc closes it; its keys work", async ({ page }) => {
    await open(page, "/?screen=home");
    await onPage(page);
    await page.keyboard.press("?");
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page).getByRole("switch", { name: /Single-key shortcuts/ })).toBeFocused();
    const results = await new AxeBuilder({ page }).withTags(TAGS).include('[data-testid="shortcuts-sheet"]').analyze();
    expect(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toBeHidden();

    await page.locator("nav.mc-side").getByRole("link", { name: "My tasks" }).focus();
    await page.keyboard.press("?");
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page)).toContainText("Board");
    await sheet(page).getByRole("button", { name: "Done" }).click();
    await expect(sheet(page)).toBeHidden();

    // A chord the sheet lists: g then b.
    await onPage(page);
    await page.keyboard.press("g");
    await page.keyboard.press("b");
    await expect(page).toHaveURL(/screen=board/);
  });

  test("the Help and shortcuts row opens the sheet, which links to the Help page", async ({ page }) => {
    await open(page, "/?screen=home");
    await page.locator("nav.mc-side").getByRole("link", { name: "Help and shortcuts" }).click();
    await expect(sheet(page)).toBeVisible();
    await expect(page).toHaveURL(/screen=home/);
    await sheet(page).getByRole("link", { name: "Help and glossary" }).click();
    await expect(sheet(page)).toBeHidden();
    await expect(page).toHaveURL(/screen=help/);
  });

  test("the switch turns single-key shortcuts off, across a reload, and back on", async ({ page }) => {
    await open(page, "/?screen=home");
    await onPage(page);
    await page.keyboard.press("?");
    const toggle = sheet(page).getByRole("switch", { name: /Single-key shortcuts/ });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(sheet(page).locator(".keys-row.off").first()).toBeVisible();
    await page.keyboard.press("Escape");

    await page.reload();
    await waitForHydration(page);
    await onPage(page);
    for (const key of ["?", "[", "/"]) await page.keyboard.press(key);
    await page.keyboard.press("g");
    await page.keyboard.press("b");
    await expect(sheet(page)).toHaveCount(0);
    await expect(page).toHaveURL(/screen=home/);
    expect(await page.evaluate(() => document.documentElement.getAttribute("data-mc-side"))).toBeNull();
    await expect(page.locator("nav.mc-side").getByRole("searchbox", { name: "Filter projects and initiatives" })).not.toBeFocused();
    await page.keyboard.press("Shift+S");
    await expect(page.locator("header.mc-top").getByRole("button", { name: "Star Home" })).toHaveAttribute("aria-pressed", "false");

    // The Help row still opens the sheet, to turn them back on.
    await page.locator("nav.mc-side").getByRole("link", { name: "Help and shortcuts" }).click();
    await sheet(page).getByRole("switch", { name: /Single-key shortcuts/ }).click();
    await page.keyboard.press("Escape");
    await onPage(page);
    await page.keyboard.press("?");
    await expect(sheet(page)).toBeVisible();
  });
});
