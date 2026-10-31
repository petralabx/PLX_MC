import { expect, test } from "@playwright/test";

import { waitForHydration } from "./helpers";
import { gotoGoals, mockGoalsApi, openGoalsTab } from "./helpers/goals";

// Section tabs (TASK-4094): every report section is one click, the goal cards
// stay on screen, and the URL keeps the section. `/?screen=goals` still opens,
// on Revenue → How it adds up (TASK-4373).

const SECTIONS: { name: string; testId: string; heading: string; tab: string }[] = [
  { name: "Revenue: How it adds up", testId: "goals-breakdown", heading: "How the Revenue headline adds up", tab: "" },
  { name: "Revenue: By class", testId: "goals-classes", heading: "Revenue by customer class", tab: "classes" },
  { name: "Revenue: Shipments", testId: "goals-shipments", heading: "Shipments this month", tab: "shipments" },
  { name: "Revenue: By customer", testId: "goals-customers", heading: "Revenue by customer", tab: "customers" },
  { name: "Revenue: Forecast", testId: "goals-forecast", heading: "Revenue forecast", tab: "forecast" },
  { name: "Batches: Day by day", testId: "goals-daily", heading: "Day by day", tab: "daily" },
  { name: "Batches: By size", testId: "goals-sizes", heading: "Batches completed by size", tab: "sizes" },
  { name: "Batches: Scheduled", testId: "goals-scheduled", heading: "Scheduled from today by size", tab: "scheduled" },
  { name: "Batches: Batch list", testId: "goals-batches", heading: "Batch list", tab: "batches" },
  { name: "Truckloads: By customer", testId: "goals-truckloads", heading: "Truckloads by customer", tab: "truckloads" },
  { name: "Entries: By hand", testId: "goals-entries", heading: "Entries by hand", tab: "entries" },
  { name: "Rules: Rules", testId: "goals-rules", heading: "How these numbers are worked out", tab: "rules" },
];

test.describe("goals section navigation", () => {
  test("every section opens in one click and the URL follows; the plain goals link stays", async ({ page }) => {
    await mockGoalsApi(page);
    await gotoGoals(page);
    await expect(page.getByRole("tab", { name: "Revenue: How it adds up" })).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(/\?screen=goals$/);
    await expect(page.getByTestId("goals-breakdown")).toBeVisible();
    await page.getByRole("tab", { name: "Revenue: How it adds up" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Revenue: By class" })).toBeFocused();
    await expect(page).toHaveURL(/[?&]tab=classes\b/);
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("tab", { name: "Revenue: How it adds up" })).toBeFocused();
    await expect(page).toHaveURL(/\?screen=goals$/);

    for (const section of SECTIONS) {
      await openGoalsTab(page, section.name);
      await expect(page.getByTestId(section.testId).getByRole("heading", { level: 2, name: section.heading })).toBeVisible();
      if (section.tab) await expect(page).toHaveURL(new RegExp(`[?&]tab=${section.tab}\\b`));
      else await expect(page).toHaveURL(/\?screen=goals$/);
      // One section at a time: the others are not on the page.
      for (const other of SECTIONS) {
        if (other.testId === section.testId) continue;
        await expect(page.getByTestId(other.testId)).toHaveCount(0);
      }
    }
  });

  test("a section link opens that section, and an unknown tab opens the default", async ({ page }) => {
    await mockGoalsApi(page);
    await page.goto("/?screen=goals&tab=batches&fx=sage");
    await waitForHydration(page);
    await expect(page.getByTestId("goals-batches")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Batches: Batch list" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("button", { name: /^Sage rate/ })).toHaveAttribute("aria-pressed", "true");

    await page.goto("/?screen=goals&tab=nope");
    await waitForHydration(page);
    await expect(page.getByTestId("goals-breakdown")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Revenue: How it adds up" })).toHaveAttribute("aria-selected", "true");
  });

  test("the goal cards stay on screen while a long section scrolls and when the tab changes", async ({ page }) => {
    await mockGoalsApi(page);
    await gotoGoals(page, "Batches: Batch list");
    const card = page.getByTestId("goals-card-revenue");
    await expect(card).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
    const stuck = await card.boundingBox();
    const viewport = page.viewportSize()!;
    expect(stuck).toBeTruthy();
    expect(stuck!.y).toBeGreaterThanOrEqual(0);
    expect(stuck!.y).toBeLessThan(viewport.height / 2);
    await openGoalsTab(page, "Revenue: Shipments");
    const after = await card.boundingBox();
    expect(after).toBeTruthy();
    expect(after!.y).toBeGreaterThanOrEqual(0);
    expect(after!.y).toBeLessThan(viewport.height / 2);
    await expect(page.getByTestId("goals-shipments")).toBeVisible();
  });

  test("the rate switch keeps the open section", async ({ page }) => {
    await mockGoalsApi(page);
    await gotoGoals(page, "Revenue: Forecast");
    await page.getByRole("button", { name: /^Sage rate/ }).click();
    await expect(page).toHaveURL(/[?&]fx=sage\b/);
    await expect(page).toHaveURL(/[?&]tab=forecast\b/);
    await expect(page.getByTestId("goals-forecast")).toContainText("Sage rate 1.25");
    await expect(page.getByTestId("goals-card-revenue")).toBeVisible();
  });

  test("screenshots at desktop and phone width", async ({ page }) => {
    await mockGoalsApi(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoGoals(page);
    await expect(page.getByTestId("goals-card-revenue")).toBeVisible();
    await page.screenshot({ path: "/opt/cursor/artifacts/goals-nav-desktop.png" });
    await openGoalsTab(page, "Batches: Day by day");
    await expect(page.getByTestId("goals-daily")).toBeVisible();
    await page.screenshot({ path: "/opt/cursor/artifacts/goals-nav-desktop-daily.png" });
    // A fresh phone load. Resizing a wide page can leave a sideways scroll
    // offset, which would clip the left of the shot. The tab change scrolls
    // the section up under the pinned cards, which is the view to capture.
    await page.setViewportSize({ width: 393, height: 851 });
    await gotoGoals(page, "Batches: Day by day");
    await expect(page.getByTestId("goals-daily")).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.scrollX)).toBe(0);
    await page.screenshot({ path: "/opt/cursor/artifacts/goals-nav-phone-daily.png" });
    await openGoalsTab(page, "Revenue: By class");
    await expect(page.getByTestId("goals-classes")).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.scrollX)).toBe(0);
    await page.screenshot({ path: "/opt/cursor/artifacts/goals-nav-phone.png" });
  });

  test("at phone width every tab is on the page and the page does not scroll sideways", async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 851 });
    await mockGoalsApi(page);
    await gotoGoals(page);
    await expect(page.getByTestId("goals-card-line1")).toBeVisible();
    const tabs = page.getByRole("tab");
    await expect(tabs).toHaveCount(SECTIONS.length);
    for (const tab of await tabs.all()) {
      const box = await tab.boundingBox();
      expect(box, (await tab.getAttribute("aria-label")) ?? "tab").toBeTruthy();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.x).toBeGreaterThanOrEqual(-1);
      expect(box!.x + box!.width).toBeLessThanOrEqual(395);
    }
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
    await openGoalsTab(page, "Revenue: Shipments");
    await expect(page.getByTestId("goals-shipments")).toBeVisible();
    await expect(page.getByTestId("goals-card-line1")).toBeVisible();
  });
});
