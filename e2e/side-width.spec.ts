// The zoned sidebar's width and rail (TASK-3957; portal ADR-011 v2, Width; MC
// ADR-006), in the zoned shell (opted in per browser, as UAT does): the
// splitter's keys, drag and double-click, collapsing to the rail with Enter, [
// and the top bar's button, what the rail shows (stars with digits, the
// Projects flyout, labels on hover and focus), the page keeping 560px beside an
// open pane, and the choice surviving a reload, painted onto <html> before the
// app hydrates. Each test gets a fresh browser context, so a fresh width.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { waitForHydration } from "./helpers";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

test.use({ contextOptions: { reducedMotion: "reduce" } });

const optIn = (page: Page) => page.addInitScript(() => window.localStorage.setItem("mc.nav.zones", "1"));

async function open(page: Page, width: number, url = "/?screen=home") {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(url);
  await waitForHydration(page);
}

const side = (page: Page) => page.locator("nav.mc-side");
const splitter = (page: Page) => page.getByRole("separator", { name: "Resize sidebar" });
const sideWidth = async (page: Page) => Math.round((await side(page).boundingBox())!.width);
const rail = (page: Page) => page.evaluate(() => document.documentElement.getAttribute("data-mc-side"));

async function setStars(page: Page, stars: string[]) {
  const current = ((await (await page.request.get("/api/stars")).json()) as { data: { stars: string[] } }).data.stars;
  for (const key of current) expect((await page.request.patch("/api/stars", { data: { op: "remove", key } })).status()).toBe(200);
  for (const key of stars) expect((await page.request.patch("/api/stars", { data: { op: "add", key } })).status()).toBe(200);
}

test.describe("sidebar width", () => {
  test.beforeEach(async ({ page }) => {
    await optIn(page);
  });

  test("1440: the splitter steps with ← →, Shift, Home and End, resets on a double-click, and the width survives a reload", async ({ page }) => {
    await open(page, 1440);
    expect(await sideWidth(page)).toBe(248);
    await expect(splitter(page)).toHaveAttribute("aria-valuenow", "248");
    await splitter(page).focus();
    await page.keyboard.press("ArrowRight");
    await expect(splitter(page)).toHaveAttribute("aria-valuenow", "264");
    await page.keyboard.press("Shift+ArrowRight");
    await expect(splitter(page)).toHaveAttribute("aria-valuenow", "328");
    expect(await sideWidth(page)).toBe(328);
    await page.keyboard.press("End");
    await expect(splitter(page)).toHaveAttribute("aria-valuenow", "400");
    await page.keyboard.press("Home");
    await expect(splitter(page)).toHaveAttribute("aria-valuenow", "232");
    await page.keyboard.press("Shift+ArrowRight");
    expect(await sideWidth(page)).toBe(296);

    // Painted onto <html> before the app hydrates (ADR-006), and kept.
    await page.reload({ waitUntil: "domcontentloaded" });
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--mc-side-w"))).toBe("296px");
    await waitForHydration(page);
    expect(await sideWidth(page)).toBe(296);
    await expect(splitter(page)).toHaveAttribute("aria-valuenow", "296");

    await splitter(page).dblclick();
    await expect(splitter(page)).toHaveAttribute("aria-valuenow", "248");
    expect(await sideWidth(page)).toBe(248);
  });

  test("1440: a drag shows the width, stops at 400, and released under 160px collapses; expanding returns the width", async ({ page }) => {
    await open(page, 1440);
    const box = (await splitter(page).boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + 300;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 64, y, { steps: 4 });
    await expect(page.locator(".side-resize-w")).toHaveText("312 px");
    await page.mouse.move(x + 400, y, { steps: 4 });
    await expect(page.locator(".side-resize-w")).toHaveText("400 px");
    await page.mouse.up();
    await expect(page.locator(".side-resize-w")).toHaveCount(0);
    expect(await sideWidth(page)).toBe(400);

    const box2 = (await splitter(page).boundingBox())!;
    const x2 = box2.x + box2.width / 2;
    await page.mouse.move(x2, y);
    await page.mouse.down();
    await page.mouse.move(x2 - 300, y, { steps: 6 });
    await expect(page.locator(".side-resize-w")).toHaveText("Release to collapse");
    await page.mouse.up();
    await expect.poll(() => rail(page)).toBe("rail");
    expect(await sideWidth(page)).toBe(56);
    await page.getByRole("button", { name: "Expand sidebar" }).first().click();
    await expect.poll(() => rail(page)).toBeNull();
    expect(await sideWidth(page)).toBe(400);
  });

  test("1440: Enter, [ and the top bar's button collapse and expand; the rail survives a reload", async ({ page }) => {
    await open(page, 1440);
    await splitter(page).focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => rail(page)).toBe("rail");
    expect(await sideWidth(page)).toBe(56);
    // Focus moves to the expand button that takes the splitter's place.
    await expect(page.locator(".side-expand")).toBeFocused();
    await expect(splitter(page)).toBeHidden();
    await page.keyboard.press("Enter");
    await expect.poll(() => rail(page)).toBeNull();
    await expect(splitter(page)).toBeFocused();

    await page.locator("main").first().click({ position: { x: 600, y: 12 } });
    await page.keyboard.press("[");
    await expect.poll(() => rail(page)).toBe("rail");
    const button = page.locator("header.mc-top .side-toggle");
    await expect(button).toHaveAttribute("aria-label", "Expand sidebar");
    await expect(button).toHaveAttribute("aria-expanded", "false");

    await page.reload({ waitUntil: "domcontentloaded" });
    expect(await rail(page)).toBe("rail");
    await waitForHydration(page);
    expect(await sideWidth(page)).toBe(56);

    await button.click();
    await expect.poll(() => rail(page)).toBeNull();
    await expect(button).toHaveAttribute("aria-label", "Collapse sidebar");
    expect(await sideWidth(page)).toBe(248);
  });

  test("1440: the rail shows the stars with their digits, Projects as a flyout, and labels on hover and focus", async ({ page }) => {
    await setStars(page, ["screen:goals", "project:PRJ-PORTAL-GOLIVE"]);
    try {
      await open(page, 1440);
      await page.keyboard.press("[");
      await expect.poll(() => rail(page)).toBe("rail");
      const stars = side(page).locator(".star-row .item");
      await expect(stars).toHaveCount(2);
      await expect(stars.first()).toBeVisible();
      await expect(side(page).locator(".star-row .cnt.key > [aria-hidden]")).toHaveText(["1", "2"]);
      await expect(side(page).locator(".item.star-rail")).toBeHidden();
      await expect(side(page).locator(".tree")).toBeHidden();

      // Hover names an icon after 300ms; keyboard focus names it at once.
      await side(page).locator('a[data-tree-key="screen:mine"]').hover();
      await expect(page.locator(".rail-label")).toHaveText("My tasks");
      await page.mouse.move(900, 600);
      await expect(page.locator(".rail-label")).toHaveCount(0);

      const projects = side(page).locator(".rail-fly");
      await expect(projects).toBeVisible();
      await expect(side(page).locator('a[data-tree-key="screen:projects"]')).toBeHidden();
      await projects.click();
      const fly = page.locator("#mc-nav-projects-flyout");
      await expect(fly).toBeVisible();
      await expect(fly.getByRole("link")).toHaveText(["PLX Portal Go-Live"]);
      await fly.getByRole("searchbox", { name: "Filter projects and initiatives" }).fill("wms");
      await expect(fly.getByRole("link")).toHaveText(["PLX Portal Go-Live", "WMS Integration"]);
      await fly.getByRole("link", { name: "WMS Integration" }).click();
      await expect(page).toHaveURL(/screen=bucket&bucketId=BKT-WMS/);
      await expect(fly).toBeHidden();

      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      const focused = await page.evaluate(() => document.activeElement?.closest("nav.mc-side") !== null);
      if (focused) await expect(page.locator(".rail-label")).toBeVisible();

      const results = await new AxeBuilder({ page }).withTags(TAGS).include("nav.mc-side").include("header.mc-top").analyze();
      expect(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual([]);
    } finally {
      await setStars(page, []);
    }
  });

  // 400 + 640 + 560 is 1600, where the pane starts: the widest sidebar and pane
  // still leave the page 560px. The CSS keeps it so if a scrollbar takes room.
  test("1600: beside the widest pane, the widest sidebar still leaves the page 560px", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("mc.side.w", "400"));
    await page.addInitScript(() => window.localStorage.setItem("mc.pane.w", "640"));
    await open(page, 1600, "/?screen=board&taskId=TASK-221");
    await expect(page.locator(".mc-body")).toHaveAttribute("data-pane", "open");
    const main = Math.round((await page.locator("main").first().boundingBox())!.width);
    expect(main).toBeGreaterThanOrEqual(560);
    expect(await sideWidth(page)).toBeLessThanOrEqual(400);
  });

  test("820: no splitter and no top bar button; [ opens and closes the drawer", async ({ page }) => {
    await open(page, 820);
    await expect(splitter(page)).toBeHidden();
    await expect(page.locator("header.mc-top .side-toggle")).toBeHidden();
    await page.keyboard.press("[");
    await expect(side(page)).toHaveClass(/\bopen\b/);
    await page.keyboard.press("Escape");
    await expect(side(page)).not.toHaveClass(/\bopen\b/);
  });

  test("the default shell has no splitter and no collapse button", async ({ browser, baseURL }) => {
    const plain = await browser.newContext({ baseURL });
    try {
      const page = await plain.newPage();
      await open(page, 1440);
      await expect(page.locator(".side-resize, .side-expand, .side-toggle")).toHaveCount(0);
      await page.keyboard.press("[");
      expect(await rail(page)).toBeNull();
    } finally {
      await plain.close();
    }
  });
});
