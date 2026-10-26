// Starred (TASK-3842) in the browser, in the zoned shell (opted in per browser,
// as UAT does): the top bar's star toggle, the Projects page rows, the Starred
// zone after My work, the icon rail's Starred button, the phone More sheet,
// the cap, and a star that survives a reload and another device. The harness
// has no database, so /api/stars keeps the operator's stars in the server's
// memory (src/lib/stars/store.ts), and a new browser context is another device.
// Every test starts and ends with no stars, so no other spec ever sees one.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

import { waitForHydration } from "./helpers";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

test.use({ contextOptions: { reducedMotion: "reduce" } });

const optIn = (page: Page) => page.addInitScript(() => window.localStorage.setItem("mc.nav.zones", "1"));
// The API takes one change at a time: clear the list, then add each star.
async function setStars(page: Page, stars: string[]) {
  const current = ((await (await page.request.get("/api/stars")).json()) as { data: { stars: string[] } }).data.stars;
  for (const key of current) expect((await page.request.patch("/api/stars", { data: { op: "remove", key } })).status()).toBe(200);
  for (const key of stars) expect((await page.request.patch("/api/stars", { data: { op: "add", key } })).status()).toBe(200);
}

async function open(page: Page, width: number, url: string) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(url);
  await waitForHydration(page);
}

const side = (page: Page) => page.locator("nav.mc-side");
const starred = (page: Page) => side(page).getByRole("group", { name: "Starred", exact: true });
const pageStar = (page: Page, label: string) => page.locator("header.mc-top").getByRole("button", { name: `Star ${label}` });

async function anotherDevice(browser: Browser, baseURL: string | undefined) {
  const context = await browser.newContext({ baseURL, reducedMotion: "reduce" });
  const page = await context.newPage();
  await optIn(page);
  return { context, page };
}

test.describe("Starred", () => {
  test.beforeEach(async ({ page }) => {
    await optIn(page);
    await setStars(page, []);
  });
  test.afterEach(async ({ page }) => {
    await setStars(page, []);
  });

  test("1440: star a page from the top bar; it sits after My work and stays after a reload", async ({ page }) => {
    await open(page, 1440, "/?screen=goals");
    const toggle = pageStar(page, "Goals & production");
    await expect(toggle).toBeEnabled();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(starred(page)).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(starred(page).getByRole("link")).toHaveText(["Goals & production"]);
    await expect(side(page).locator(".grp > .h")).toHaveText([/^My work$/, /^Starred$/, /^Plan$/, /^Reporting$/, /^Knowledge/]);
    // The copy is never the current row: Reporting's Goals row is.
    await expect(side(page).locator('[aria-current="page"]')).toHaveText(["Goals & production"]);
    await expect(starred(page).locator('[aria-current="page"]')).toHaveCount(0);

    await page.reload();
    await waitForHydration(page);
    await expect(starred(page).getByRole("link")).toHaveText(["Goals & production"]);

    // Board, List and Timeline are one All work star.
    await page.goto("/?screen=list");
    await waitForHydration(page);
    await pageStar(page, "All work").click();
    await expect(starred(page).getByRole("link")).toHaveText(["Goals & production", "All work"]);
    await page.goto("/?screen=timeline");
    await waitForHydration(page);
    await expect(pageStar(page, "All work")).toHaveAttribute("aria-pressed", "true");
    await pageStar(page, "All work").click();
    await expect(starred(page).getByRole("link")).toHaveText(["Goals & production"]);

    await page.goto("/?screen=goals");
    await waitForHydration(page);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(starred(page)).toHaveCount(0);
    await page.reload();
    await waitForHydration(page);
    await expect(starred(page)).toHaveCount(0);
  });

  test("two devices: a star from each lands, and neither overwrites the other", async ({ page, browser, baseURL }) => {
    await open(page, 1440, "/?screen=goals");
    await expect(pageStar(page, "Goals & production")).toBeEnabled();
    const other = await anotherDevice(browser, baseURL);
    try {
      // The phone stars Help while this tab still holds the list it loaded.
      await open(other.page, 393, "/?screen=help");
      await pageStar(other.page, "Help and shortcuts").click();
      await expect(pageStar(other.page, "Help and shortcuts")).toHaveAttribute("aria-pressed", "true");
      await pageStar(page, "Goals & production").click();
      await expect(starred(page).getByRole("link")).toHaveText(["Help and shortcuts", "Goals & production"]);
      await other.page.reload();
      await waitForHydration(other.page);
      await other.page.locator("nav.mc-tabs").getByRole("button", { name: "More" }).click();
      await expect(other.page.getByRole("dialog", { name: "More" }).getByRole("group", { name: "Starred" }).getByRole("link")).toHaveText([
        "Help and shortcuts",
        "Goals & production",
      ]);
    } finally {
      await other.context.close();
    }
  });

  // TASK-3996: the Projects list page is gone; each page's own star stars it.
  test("1440: star an initiative, then a project, from their pages, in the order starred", async ({ page }) => {
    await open(page, 1440, "/?screen=bucket&bucketId=BKT-WMS");
    await pageStar(page, "WMS Integration").click();
    await expect(pageStar(page, "WMS Integration")).toHaveAttribute("aria-pressed", "true");
    await open(page, 1440, "/?screen=project&projectId=PRJ-PORTAL-GOLIVE");
    await pageStar(page, "PLX Portal Go-Live").click();
    await expect(pageStar(page, "PLX Portal Go-Live")).toHaveAttribute("aria-pressed", "true");
    await expect(starred(page).getByRole("link")).toHaveText(["WMS Integration", "PLX Portal Go-Live"]);
    const results = await new AxeBuilder({ page }).withTags(TAGS).include(".mc-chrome").include("nav.mc-side").analyze();
    expect(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual([]);
  });

  test("a seventh star is refused with a notice, and nothing changes", async ({ page }) => {
    const six = ["home", "mine", "approvals", "board", "goals", "help"].map((s) => `screen:${s}`);
    await setStars(page, six);
    await open(page, 1440, "/?screen=insights");
    const toggle = pageStar(page, "Insights");
    await expect(toggle).toHaveAttribute("title", "Stars are full: unstar one first");
    await toggle.click();
    await expect(page.locator(".mc-notices")).toContainText("You can keep up to 6 stars. Unstar one first.");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(starred(page).getByRole("link")).toHaveCount(6);
  });

  test("820: the icon rail shows one Starred button, which opens the drawer with the stars", async ({ page }) => {
    await setStars(page, ["screen:goals", "project:PRJ-PORTAL-GOLIVE"]);
    await open(page, 820, "/?screen=board");
    const button = side(page).getByRole("button", { name: "Starred" });
    await expect(button).toBeVisible();
    await expect(starred(page).getByRole("link", { name: "Goals & production" })).toBeHidden();
    const box = (await button.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await button.click();
    await expect(side(page)).toHaveClass(/\bopen\b/);
    await expect(button).toBeHidden();
    await expect(starred(page).getByRole("link")).toHaveText(["Goals & production", "PLX Portal Go-Live"]);
    await starred(page).getByRole("link", { name: "Goals & production" }).click();
    await expect(page).toHaveURL(/\?screen=goals$/);
    await expect(side(page)).not.toHaveClass(/\bopen\b/);
  });

  test("393: the More sheet lists Starred first, and the top bar keeps the page's star", async ({ page }) => {
    await setStars(page, ["screen:goals", "project:PRJ-PORTAL-GOLIVE"]);
    await open(page, 393, "/?screen=home");
    await expect(pageStar(page, "Home")).toBeVisible();
    await page.locator("nav.mc-tabs").getByRole("button", { name: "More" }).click();
    const sheet = page.getByRole("dialog", { name: "More" });
    await expect(sheet.locator(".grp-h").first()).toHaveText("Starred");
    const group = sheet.getByRole("group", { name: "Starred" });
    await expect(group.getByRole("link")).toHaveText(["Goals & production", "PLX Portal Go-Live"]);
    await group.getByRole("link", { name: "PLX Portal Go-Live" }).click();
    await expect(page).toHaveURL(/screen=project&projectId=PRJ-PORTAL-GOLIVE/);
    await expect(sheet).toBeHidden();
    // The top bar fits a phone with the star in it.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  });

  test("the default shell has no stars and makes no stars request", async ({ browser, baseURL }) => {
    const plain = await browser.newContext({ baseURL });
    try {
      const page = await plain.newPage();
      const requests: string[] = [];
      page.on("request", (req) => {
        if (new URL(req.url()).pathname === "/api/stars") requests.push(req.method());
      });
      await open(page, 1440, "/?screen=goals");
      await expect(page.locator("header.mc-top .star-toggle")).toHaveCount(0);
      await expect(page.locator("#mc-nav-h-starred")).toHaveCount(0);
      expect(requests).toEqual([]);
    } finally {
      await plain.close();
    }
  });
});
