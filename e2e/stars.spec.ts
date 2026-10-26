// Starred (TASK-3842; v2, TASK-3956) in the browser, in the zoned shell (opted
// in per browser, as UAT does): the top bar's star toggle, each sidebar row's
// star and Shift S, the Starred zone after My work with its count and g digits,
// moving a star with Alt and an arrow or by dragging, the icon rail's Starred
// button, the phone More sheet, the cap of 10, and a star that survives a
// reload and another device. A deleted record's star needs live data, which
// the harness never has, so tests/mc-stars.test.ts covers it. The harness
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
// The zone's name carries its count ("Starred, 2 of 10"; Chrome puts a space
// between the heading's flex items).
const starred = (page: Page) => side(page).getByRole("group", { name: /^Starred\s*, \d+ of 10$/ });
// Each copy's label (and mark), without its g digit.
const copies = (page: Page) => starred(page).locator(".star-row .nm");
const TEN = ["home", "mine", "approvals", "board", "goals", "help", "dashboard", "feed", "sync", "matrix"].map((s) => `screen:${s}`);
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
    await expect(copies(page)).toHaveText(["Goals & production"]);
    await expect(side(page).locator(".grp > .h")).toHaveText([/^My work$/, /^Starred1 \/ 10/, /^Plan$/, /^Reporting$/, /^Knowledge/]);
    // The copy is never the current row: Reporting's Goals row is.
    await expect(side(page).locator('[aria-current="page"]')).toHaveText(["Goals & production"]);
    await expect(starred(page).locator('[aria-current="page"]')).toHaveCount(0);

    await page.reload();
    await waitForHydration(page);
    await expect(copies(page)).toHaveText(["Goals & production"]);

    // Board, List and Timeline are one All work star.
    await page.goto("/?screen=list");
    await waitForHydration(page);
    await pageStar(page, "All work").click();
    await expect(copies(page)).toHaveText(["Goals & production", "All work"]);
    await page.goto("/?screen=timeline");
    await waitForHydration(page);
    await expect(pageStar(page, "All work")).toHaveAttribute("aria-pressed", "true");
    await pageStar(page, "All work").click();
    await expect(copies(page)).toHaveText(["Goals & production"]);

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
      await expect(copies(page)).toHaveText(["Help and shortcuts", "Goals & production"]);
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
    await expect(copies(page)).toHaveText(["WMS Integration", "PLX Portal Go-Live"]);
    const results = await new AxeBuilder({ page }).withTags(TAGS).include(".mc-chrome").include("nav.mc-side").analyze();
    expect(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual([]);
  });

  test("an eleventh star is refused with a notice, and nothing changes", async ({ page }) => {
    await setStars(page, TEN);
    await open(page, 1440, "/?screen=insights");
    const toggle = pageStar(page, "Insights");
    await expect(toggle).toHaveAttribute("title", "Starred is full: unstar one to add another");
    await toggle.click();
    await expect(page.locator(".mc-notices")).toContainText("Starred is full. Unstar one to add another.");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(starred(page).getByRole("link")).toHaveCount(10);
    await expect(starred(page).locator(".h-cnt")).toContainText("10 / 10");
  });

  test("1440: g then a digit opens the star in that slot, and g 0 the tenth", async ({ page }) => {
    await setStars(page, TEN);
    await open(page, 1440, "/?screen=insights");
    await expect(starred(page).locator(".cnt.key > [aria-hidden]")).toHaveText(["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]);
    await page.keyboard.press("g");
    await page.keyboard.press("0");
    await expect(page).toHaveURL(/\?screen=matrix$/);
    await page.keyboard.press("g");
    await page.keyboard.press("2");
    await expect(page).toHaveURL(/\?screen=mine$/);
  });

  test("1440: a row's star shows on hover, and Shift S stars the focused row, else the page", async ({ page }) => {
    await open(page, 1440, "/?screen=home");
    const allWork = side(page).locator("#mc-nav-plan > .tree-row").filter({ has: page.getByRole("link", { name: "All work" }) });
    const rowStar = allWork.getByRole("button", { name: "Star All work", exact: true });
    await expect(rowStar).toHaveCSS("opacity", "0");
    await allWork.hover();
    await expect(rowStar).toHaveCSS("opacity", "1");
    await rowStar.click();
    await expect(rowStar).toHaveAttribute("aria-pressed", "true");
    await expect(copies(page)).toHaveText(["All work"]);

    // With the page focused, Shift S stars the page.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Shift+S");
    await expect(pageStar(page, "Home")).toHaveAttribute("aria-pressed", "true");
    await expect(copies(page)).toHaveText(["All work", "Home"]);

    // In the sidebar's tree, Shift S stars the focused row instead, and unstars a copy.
    await side(page).getByRole("link", { name: "Goals & production" }).first().focus();
    await page.keyboard.press("Shift+S");
    await expect(copies(page)).toHaveText(["All work", "Home", "Goals & production"]);
    await expect(pageStar(page, "Home")).toHaveAttribute("aria-pressed", "true");
    await starred(page).getByRole("link", { name: "All work" }).focus();
    await page.keyboard.press("Shift+S");
    await expect(copies(page)).toHaveText(["Home", "Goals & production"]);
  });

  test("1440: Alt with ↑ or ↓ moves a focused star, and dragging one moves it; the order stays after a reload", async ({ page }) => {
    await setStars(page, ["screen:goals", "screen:help", "project:PRJ-PORTAL-GOLIVE"]);
    await open(page, 1440, "/?screen=home");
    await starred(page).getByRole("link", { name: "Goals & production" }).focus();
    await page.keyboard.press("Alt+ArrowDown");
    await expect(copies(page)).toHaveText(["Help and shortcuts", "Goals & production", "PLX Portal Go-Live"]);
    // Focus stays on the star that moved, so it can keep moving.
    await expect(starred(page).getByRole("link", { name: "Goals & production" })).toBeFocused();
    await page.keyboard.press("Alt+ArrowDown");
    await expect(copies(page)).toHaveText(["Help and shortcuts", "PLX Portal Go-Live", "Goals & production"]);
    // Past the end does nothing.
    await page.keyboard.press("Alt+ArrowDown");
    await expect(copies(page)).toHaveText(["Help and shortcuts", "PLX Portal Go-Live", "Goals & production"]);
    await expect(starred(page).locator(".cnt.key > [aria-hidden]")).toHaveText(["1", "2", "3"]);

    await starred(page).getByRole("link", { name: "Goals & production" }).dragTo(starred(page).getByRole("link", { name: "Help and shortcuts" }));
    await expect(copies(page)).toHaveText(["Goals & production", "Help and shortcuts", "PLX Portal Go-Live"]);
    await page.reload();
    await waitForHydration(page);
    await expect(copies(page)).toHaveText(["Goals & production", "Help and shortcuts", "PLX Portal Go-Live"]);
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
    await expect(copies(page)).toHaveText(["Goals & production", "PLX Portal Go-Live"]);
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
