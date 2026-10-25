// The "Try the new navigation" switch and its one-screen tour (TASK-3855) in
// the browser: the account menu's switch in the default shell, the tour the
// first time, a reload and another device keeping the choice, Switch back from
// the menu and from the tour, a refused save, and a browser opted in on its own
// (as the other zoned specs are) getting no tour. The harness has no database,
// so /api/nav-prefs keeps the operator's preferences in the server's memory
// (src/lib/nav-prefs/store.ts), and a new browser context is another device.
// Every test starts and ends with the switch never used and the tour unseen,
// so no other spec ever sees the tour.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { waitForHydration } from "./helpers";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

test.use({ contextOptions: { reducedMotion: "reduce" } });

async function forgetPrefs(page: Page) {
  const resp = await page.request.patch("/api/nav-prefs", { data: { zones: null, tourSeen: false } });
  expect(resp.status()).toBe(200);
}

async function prefs(page: Page) {
  return ((await (await page.request.get("/api/nav-prefs")).json()) as { data: { zones: boolean | null; tourSeen: boolean } })
    .data;
}

async function open(page: Page, width: number, url: string) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(url);
  await waitForHydration(page);
}

const body = (page: Page) => page.locator(".mc-body");
const tour = (page: Page) => page.getByRole("dialog", { name: "Here is what moved" });
const navSwitch = (page: Page) => page.getByRole("menuitemcheckbox", { name: "Try the new navigation" });

const menu = (page: Page) => page.getByRole("menu", { name: "Account" });

// Flip the switch from the account menu. The menu gives way to the tour when
// it opens; otherwise it stays open to show the switch flip, and Esc closes it.
async function flipSwitch(page: Page, from: boolean, { tourOpens = false } = {}) {
  await page.getByTestId("user-menu").click();
  await expect(navSwitch(page)).toHaveAttribute("aria-checked", String(from));
  await navSwitch(page).click();
  if (tourOpens) {
    await expect(menu(page)).toHaveCount(0);
    return;
  }
  await expect(navSwitch(page)).toHaveAttribute("aria-checked", String(!from));
  await expect(navSwitch(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
}

test.describe("the navigation switch", () => {
  test.beforeEach(async ({ page }) => {
    await forgetPrefs(page);
  });
  test.afterEach(async ({ page }) => {
    await forgetPrefs(page);
  });

  test("1440: turn it on from the account menu; the tour shows once; a reload and another device keep it", async ({
    page,
    browser,
    baseURL,
  }) => {
    await open(page, 1440, "/?screen=goals");
    await expect(body(page)).not.toHaveAttribute("data-nav", "zones");
    await flipSwitch(page, false, { tourOpens: true });
    await expect(body(page)).toHaveAttribute("data-nav", "zones");
    await expect(tour(page)).toBeVisible();
    await expect(tour(page).getByRole("button", { name: "Got it" })).toBeFocused();
    await expect(tour(page).locator("li b")).toHaveText(["My work", "Starred", "Plan", "Reporting", "Admin & health", "Search"]);
    const scan = await new AxeBuilder({ page }).include("[data-testid='nav-tour']").withTags(TAGS).analyze();
    expect(scan.violations).toEqual([]);
    await tour(page).getByRole("button", { name: "Got it" }).click();
    await expect(tour(page)).toHaveCount(0);
    await expect(page.getByTestId("user-menu")).toBeFocused();
    await expect.poll(() => prefs(page)).toEqual({ zones: true, tourSeen: true });

    await page.reload();
    await waitForHydration(page);
    await expect(body(page)).toHaveAttribute("data-nav", "zones");
    await expect(tour(page)).toHaveCount(0);

    const context = await browser.newContext({ baseURL, reducedMotion: "reduce" });
    try {
      const phone = await context.newPage();
      await open(phone, 393, "/?screen=home");
      await expect(body(phone)).toHaveAttribute("data-nav", "zones");
      await expect(tour(phone)).toHaveCount(0);
      // Switch back on the other device: this one follows on its next load.
      await flipSwitch(phone, true);
      await expect(body(phone)).not.toHaveAttribute("data-nav", "zones");
      await expect.poll(() => prefs(phone)).toEqual({ zones: false, tourSeen: true });
    } finally {
      await context.close();
    }
    await page.reload();
    await waitForHydration(page);
    await expect(body(page)).not.toHaveAttribute("data-nav", "zones");
  });

  test("393: Switch back from the tour; turning it on again shows no tour", async ({ page }) => {
    await open(page, 393, "/?screen=home");
    await flipSwitch(page, false, { tourOpens: true });
    await expect(tour(page)).toBeVisible();
    await tour(page).getByRole("button", { name: "Switch back" }).click();
    await expect(tour(page)).toHaveCount(0);
    await expect(body(page)).not.toHaveAttribute("data-nav", "zones");
    await expect.poll(() => prefs(page)).toEqual({ zones: false, tourSeen: true });
    await flipSwitch(page, false);
    await expect(body(page)).toHaveAttribute("data-nav", "zones");
    await expect(tour(page)).toHaveCount(0);
  });

  test("Esc closes the tour, and the new navigation stays", async ({ page }) => {
    await open(page, 1440, "/?screen=home");
    await flipSwitch(page, false, { tourOpens: true });
    await expect(tour(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(tour(page)).toHaveCount(0);
    await expect(body(page)).toHaveAttribute("data-nav", "zones");
    await expect.poll(() => prefs(page)).toEqual({ zones: true, tourSeen: true });
  });

  test("a refused save puts the switch back and says so", async ({ page }) => {
    await page.route("**/api/nav-prefs", (route) =>
      route.request().method() === "PATCH"
        ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "internal", message: "Internal error." } }) })
        : route.fallback()
    );
    await open(page, 1440, "/?screen=home");
    await flipSwitch(page, false, { tourOpens: true });
    await expect(page.locator(".mc-notices")).toContainText(
      "Couldn't save the navigation switch. Internal error. Your navigation is as it was."
    );
    await expect(body(page)).not.toHaveAttribute("data-nav", "zones");
    await expect(tour(page)).toHaveCount(0);
    await page.unroute("**/api/nav-prefs");
    expect(await prefs(page)).toEqual({ zones: null, tourSeen: false });
  });

  test("a browser opted in on its own keeps the new navigation with no tour, and the switch shows on", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("mc.nav.zones", "1"));
    await open(page, 1440, "/?screen=home");
    await expect(body(page)).toHaveAttribute("data-nav", "zones");
    await expect(tour(page)).toHaveCount(0);
    await page.getByTestId("user-menu").click();
    await expect(navSwitch(page)).toHaveAttribute("aria-checked", "true");
    // The arrow keys move between the menu's items.
    await expect(navSwitch(page)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(navSwitch(page)).toBeFocused();
  });
});
