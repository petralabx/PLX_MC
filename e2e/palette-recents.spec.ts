// The command palette's Recent and Starred groups and the g 1 to g 6 keys
// (TASK-3853), in the zoned shell (opted in per browser, as UAT does). The
// harness has no database, so stars live in the server's memory: every test
// starts and ends with none. Recents live in this browser's storage.
import { expect, test, type Page } from "@playwright/test";

import { waitForHydration } from "./helpers";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const optIn = (page: Page) => page.addInitScript(() => window.localStorage.setItem("mc.nav.zones", "1"));
// The stars API takes one change at a time: clear the list, then add each star.
async function setStars(page: Page, stars: string[]) {
  const current = ((await (await page.request.get("/api/stars")).json()) as { data: { stars: string[] } }).data.stars;
  for (const key of current) expect((await page.request.patch("/api/stars", { data: { op: "remove", key } })).status()).toBe(200);
  for (const key of stars) expect((await page.request.patch("/api/stars", { data: { op: "add", key } })).status()).toBe(200);
}

async function open(page: Page, url: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url);
  await waitForHydration(page);
}

const palette = (page: Page) => page.getByTestId("cmdk");
const group = (page: Page, title: string) =>
  palette(page)
    .locator(".cgrp")
    .filter({ has: page.locator(".gh", { hasText: new RegExp(`^${title}$`) }) });

async function openPalette(page: Page) {
  await page.keyboard.press("ControlOrMeta+k");
  await expect(palette(page)).toBeVisible();
}

test.describe("palette recents and the g keys", () => {
  test.beforeEach(async ({ page }) => {
    await optIn(page);
    await setStars(page, []);
  });
  test.afterEach(async ({ page }) => {
    await setStars(page, []);
  });

  test("Recent lists the pages opened last, newest first, without the page under the palette", async ({ page }) => {
    await open(page, "/?screen=goals");
    await open(page, "/?screen=task&taskId=TASK-221");
    await open(page, "/?screen=insights");
    await openPalette(page);
    await expect(palette(page).locator(".gh").first()).toHaveText("Recent");
    await expect(group(page, "Recent").locator(".cres")).toHaveText([/^▸TASK-221 · /, /^◎Go to Goals & production/]);
    // Typing searches every group, as before; Recent steps aside.
    await palette(page).getByRole("textbox", { name: "Command palette search" }).fill("goals");
    await expect(group(page, "Recent")).toHaveCount(0);
    await expect(palette(page).locator(".cres").first()).toContainText("Goals");
    // A recent opens with Enter.
    await palette(page).getByRole("textbox", { name: "Command palette search" }).fill("");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/screen=task&taskId=TASK-221/);
  });

  test("g 1 to g 6 open the stars in their order, and the palette lists them with their keys", async ({ page }) => {
    await setStars(page, ["screen:goals", "project:PRJ-PORTAL-GOLIVE"]);
    await open(page, "/?screen=home");
    await page.keyboard.press("g");
    await page.keyboard.press("1");
    await expect(page).toHaveURL(/\?screen=goals$/);
    await page.keyboard.press("g");
    await page.keyboard.press("2");
    await expect(page).toHaveURL(/screen=project&projectId=PRJ-PORTAL-GOLIVE/);
    // A key with no star there does nothing.
    await page.keyboard.press("g");
    await page.keyboard.press("3");
    await expect(page).toHaveURL(/screen=project&projectId=PRJ-PORTAL-GOLIVE/);
    await openPalette(page);
    const starred = group(page, "Starred").locator(".cres");
    await expect(starred).toHaveText([/Go to Goals & production\s*g 1$/, /Project · PLX Portal Go-Live\s*g 2$/]);
  });

  test("the default shell keeps its palette, and g 1 does nothing", async ({ page: zonedPage, browser, baseURL }) => {
    // A star exists, so only the opt-in keeps Starred and g 1 out.
    await setStars(zonedPage, ["screen:goals"]);
    const plain = await browser.newContext({ baseURL, reducedMotion: "reduce" });
    try {
      const page = await plain.newPage();
      await open(page, "/?screen=goals");
      await open(page, "/?screen=home");
      await page.keyboard.press("g");
      await page.keyboard.press("1");
      await expect(page).toHaveURL(/\/$|\?screen=home$/);
      await openPalette(page);
      await expect(palette(page).locator(".gh").first()).toHaveText("Create");
      await expect(group(page, "Recent")).toHaveCount(0);
      await expect(group(page, "Starred")).toHaveCount(0);
    } finally {
      await plain.close();
    }
  });
});
