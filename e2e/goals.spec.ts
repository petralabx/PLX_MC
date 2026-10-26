import { expect, test, type Page } from "@playwright/test";

import { waitForHydration } from "./helpers";
import { goalsPage, gotoGoals, mockGoalsApi, runAt } from "./helpers/goals";

// Goals & Production page (TASK-2896) against the 2026-10-14 fixture with
// M1–M7 entered: the numbers, the batch list, the Editor refresh flow, and
// the honest states (loading, failed + Retry, not connected, no data, stale).

const screen = (page: Page) => page.locator("[data-testid='goals-screen']");

test.describe("goals & production", () => {
  test("shows this month's goals, the takeaway and where the data comes from", async ({ page }) => {
    await mockGoalsApi(page);
    await gotoGoals(page);
    await expect(screen(page).getByRole("heading", { level: 1 })).toHaveText("October 2026 goals & production");
    await expect(page.getByTestId("goals-as-of")).toHaveText(
      "Data as of Oct 14, 6:00 AM · FileMaker through Oct 14 · Sage through Oct 14"
    );
    await expect(screen(page)).toContainText(
      "91,702 kg of Line 1 bulk against 180,000 kg due so far, 3 full truckloads, and $408,628 of the $428,571 revenue due so far."
    );
    const line1 = page.getByTestId("goals-card-line1");
    await expect(line1).toContainText("91,702 of 420,000 kg");
    await expect(line1).toContainText("72,652 kg in FileMaker + 19,050 kg entered by hand");
    await expect(line1.locator(".pv-chip")).toHaveText("Behind");
    await expect(page.getByTestId("goals-card-truckloads")).toContainText("2 in Sage + 1 entered by hand");
    await expect(page.getByTestId("goals-card-revenue")).toContainText("$390,827 of $1,000,000");
    await expect(page.getByTestId("goals-card-revenue").locator(".gp-big")).toHaveAttribute(
      "title",
      "From queries revenue-by-currency, credit-notes · run #41, Oct 14, 6:00 AM"
    );
    await expect(page.getByTestId("goals-truckloads")).toContainText("From query truckloads · run #41");
    await expect(page.getByTestId("goals-behind")).toHaveCount(0);
  });

  test("reads a chart day by hovering, and offers the numbers as a table", async ({ page }) => {
    await mockGoalsApi(page);
    await gotoGoals(page);
    const chart = page.getByTestId("goals-daily").locator(".gp-chart").nth(1).locator(".colchart-plot");
    await chart.scrollIntoViewIfNeeded();
    const box = (await chart.boundingBox())!;
    // Oct 14 is column 14 of 31.
    await page.mouse.move(box.x + (box.width * 13.5) / 31, box.y + box.height / 2);
    await expect(chart.locator(".colchart-tip")).toContainText("Oct 14");
    await expect(chart.locator(".colchart-tip")).toContainText("Sage: $367,014");
    await expect(chart.locator(".colchart-tip")).toContainText("With entries by hand: $408,628");
    await page.getByText("Day-by-day numbers").click();
    await expect(page.getByRole("region", { name: "Day-by-day numbers" })).toContainText("367,014.16");
  });

  test("a tapped day keeps its read-out on a touch screen", async ({ browser }) => {
    const context = await browser.newContext({ hasTouch: true, viewport: { width: 393, height: 851 } });
    const page = await context.newPage();
    await mockGoalsApi(page);
    await gotoGoals(page);
    const chart = page.getByTestId("goals-daily").locator(".gp-chart").first().locator(".colchart-plot");
    await chart.scrollIntoViewIfNeeded();
    const box = (await chart.boundingBox())!;
    await page.touchscreen.tap(box.x + (box.width * 13.5) / 31, box.y + box.height / 2);
    await expect(chart.locator(".colchart-tip")).toContainText("Oct 14");
    await expect(chart.locator(".colchart-tip")).toContainText("By hand: 9,000 kg");
    await context.close();
  });

  test("filters, searches and sorts the batch list", async ({ page }) => {
    await mockGoalsApi(page);
    await gotoGoals(page);
    const list = page.getByTestId("goals-batches");
    const total = goalsPage().model!.batches.length;
    await expect(list.getByText(`Showing ${total} of ${total} batches`)).toBeVisible();
    await list.getByRole("button", { name: /^By hand/ }).click();
    await expect(list.getByText(`Showing 2 of ${total} batches`)).toBeVisible();
    await expect(list.locator("tbody tr.hand")).toHaveCount(2);
    await list.getByRole("button", { name: /^All/ }).click();
    await list.getByLabel("Search batches").fill("bc-26290x");
    await expect(list.locator("tbody tr")).toHaveCount(1);
    await expect(list.locator("tbody tr")).toContainText("Completed (by hand)");
    await list.getByLabel("Search batches").fill("");
    await list.getByLabel("Line 1 only (5,000 kg or more)").check();
    // 5,000 kg or more, whatever line FileMaker records: the rows the Line 1 card adds up.
    await expect(list.locator("tbody tr")).toHaveCount(goalsPage().model!.batches.filter((b) => b.line1).length);
    expect(await list.locator("tbody tr").count()).toBeLessThan(total);
    await list.getByRole("button", { name: "kg" }).click();
    await expect(list.getByRole("columnheader", { name: /kg/ })).toHaveAttribute("aria-sort", "descending");
    const kgs = await list.locator("tbody tr td.num").allTextContents();
    const values = kgs.map((v) => Number(v.replace(/,/g, "")));
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });

  test("lists this month's shipments; search and a filter change the rows and the totals", async ({ page }) => {
    await mockGoalsApi(page);
    await gotoGoals(page);
    const section = page.getByTestId("goals-shipments");
    await expect(section.getByRole("heading", { name: "Shipments this month" })).toBeVisible();
    await expect(section).toContainText("From queries shipments, truckloads, shipment-lines · run #41");
    const list = section.getByRole("region", { name: "Shipment list" });
    const totals = section.getByRole("region", { name: "Shipment totals" });
    const total = totals.locator("tfoot tr");
    await expect(section.getByText("Showing 72 of 72 shipments")).toBeVisible();
    await expect(list.locator("tbody tr")).toHaveCount(72);
    await expect(list.locator("tbody tr.hand")).toHaveCount(2);
    // With no filter the total is the Revenue card's, to the cent.
    await expect(total).toContainText("Total: 70 invoices and 2 by hand");
    await expect(total).toContainText("408,628.08");
    await expect(totals.locator("tbody tr.hand")).toContainText("41,613.92");

    await section.getByRole("button", { name: /^CAD/ }).click();
    await expect(section.getByRole("button", { name: /^CAD/ })).toHaveAttribute("aria-pressed", "true");
    await expect(section.getByText("Showing 58 of 72 shipments")).toBeVisible();
    await expect(total).toContainText("Total: 57 invoices and 1 by hand");
    await expect(total).toContainText("126,837.71");
    await expect(totals).not.toContainText("USD");

    await section.getByLabel("Search shipments").fill("remco");
    await expect(section.getByText("No shipments match these filters.")).toBeVisible();
    await expect(totals).toHaveCount(0);
    await section.getByRole("button", { name: /^USD/ }).click();
    await expect(section.getByText("Showing 8 of 72 shipments")).toBeVisible();
    await expect(list.locator("tbody tr")).toHaveCount(8);
    await expect(list.locator("tbody tr").first()).toContainText("REMCODA LLC");
    await expect(total).toContainText("Total: 8 invoices");
    await expect(total).toContainText("22,522.90");
  });

  test("an Editor refreshes and the page follows the run to its result", async ({ page }) => {
    await mockGoalsApi(page);
    let polls = 0;
    await page.route("**/api/reporting/goals/refresh", (route) =>
      route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ data: { run: runAt({ id: 42, trigger: "user", status: "running", step: "claimed", finishedAt: null }) } }),
      })
    );
    await page.route("**/api/reporting/goals/runs/42", (route) => {
      polls += 1;
      const run =
        polls === 1
          ? runAt({ id: 42, status: "running", step: "reading-sources", finishedAt: null })
          : runAt({ id: 42, status: "succeeded", startedAt: "2026-10-14T13:41:50.000Z", finishedAt: "2026-10-14T13:42:20.000Z" });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: run }) });
    });
    await gotoGoals(page);
    // The fixture's run started hours before this test's clock, so Refresh is available.
    const refresh = page.getByRole("button", { name: "Refresh" });
    await refresh.click();
    const status = page.locator("#goals-refresh-status");
    await expect(status).toHaveText("Reading FileMaker and Sage…");
    await expect(page.getByRole("button", { name: "Refreshing…" })).toBeDisabled();
    await expect(status).toHaveText("Refreshed 9:42 AM · FileMaker through Oct 14 · Sage through Oct 14");
  });

  test("tells an Editor when the 5-minute limit or a running refresh stops them", async ({ page }) => {
    await mockGoalsApi(page);
    await page.route("**/api/reporting/goals/refresh", (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "rate_limited", message: "The report refreshed less than 5 minutes ago. Try again in 3 minutes." } }),
      })
    );
    await gotoGoals(page);
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.locator("#goals-refresh-status")).toHaveText(
      "The report refreshed less than 5 minutes ago. Try again in 3 minutes."
    );
  });

  test("Viewers get no Refresh button", async ({ page }) => {
    await mockGoalsApi(page, goalsPage({ viewer: { editor: false } }));
    await gotoGoals(page);
    await expect(page.getByTestId("goals-card-line1")).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh" })).toHaveCount(0);
  });

  test("loads with skeletons; a failed load says so in place, and Retry recovers", async ({ page }) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let fail = true;
    await page.route("**/api/reporting/goals", async (route) => {
      if (!fail) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: goalsPage() }) });
      }
      await held;
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "internal", message: "Internal error." } }) });
    });
    await page.goto("/?screen=goals");
    await waitForHydration(page);
    // One skeleton per section (the revenue forecast's included), then one "Failed to load." each.
    const sections = screen(page).locator("section.gp-sec");
    await expect(sections.last()).toBeVisible();
    const sectionCount = await sections.count();
    await expect(screen(page).locator(".gp-skel")).toHaveCount(sectionCount);
    const loading = await page.getByTestId("goals-batches").boundingBox();
    release();
    await expect(page.getByText("Failed to load.")).toHaveCount(sectionCount);
    await expect(page.getByTestId("goals-as-of")).toHaveText("Couldn’t load the report: Internal error.");
    // The failed state takes the skeleton's place: nothing below moves.
    const failed = await page.getByTestId("goals-batches").boundingBox();
    expect(failed?.y).toBe(loading?.y);
    fail = false;
    await page.getByTestId("goals-truckloads").getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("goals-card-line1")).toContainText("91,702 of 420,000 kg");
    await expect(page.getByText("Failed to load.")).toHaveCount(0);
  });

  test("a section that can't render fails on its own; the rest of the page stays", async ({ page }) => {
    const broken = goalsPage();
    // A daily series the charts can't read.
    (broken.model as unknown as { daily: null }).daily = null;
    await mockGoalsApi(page, broken);
    await gotoGoals(page);
    await expect(page.getByTestId("goals-daily")).toContainText("Failed to load.");
    await expect(page.getByTestId("goals-card-line1")).toContainText("91,702 of 420,000 kg");
    await expect(page.getByTestId("goals-truckloads")).not.toContainText("Failed to load.");
  });

  test("a section that failed to render recovers when a refresh brings good data", async ({ page }) => {
    const broken = goalsPage();
    (broken.model as unknown as { daily: null }).daily = null;
    let good = false;
    await page.route("**/api/reporting/goals", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: good ? goalsPage() : broken }) })
    );
    await page.route("**/api/reporting/goals/refresh", (route) =>
      route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ data: { run: runAt({ id: 42, trigger: "user", status: "running", step: "claimed", finishedAt: null }) } }),
      })
    );
    await page.route("**/api/reporting/goals/runs/42", (route) => {
      good = true;
      const run = runAt({ id: 42, status: "succeeded", startedAt: "2026-10-14T13:41:50.000Z", finishedAt: "2026-10-14T13:42:20.000Z" });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: run }) });
    });
    await gotoGoals(page);
    await expect(page.getByTestId("goals-daily")).toContainText("Failed to load.");
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.locator("#goals-refresh-status")).toContainText("Refreshed");
    await expect(page.getByTestId("goals-daily").locator(".colchart")).toHaveCount(2);
    await expect(page.getByTestId("goals-daily")).not.toContainText("Failed to load.");
  });

  test("keeps Refresh off for 5 minutes after the run it just followed", async ({ page }) => {
    await mockGoalsApi(page);
    const startedAt = new Date().toISOString();
    await page.route("**/api/reporting/goals/refresh", (route) =>
      route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ data: { run: runAt({ id: 42, trigger: "user", status: "running", step: "claimed", startedAt, finishedAt: null }) } }),
      })
    );
    await page.route("**/api/reporting/goals/runs/42", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: runAt({ id: 42, status: "succeeded", startedAt, finishedAt: new Date().toISOString() }) }),
      })
    );
    await gotoGoals(page);
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.locator("#goals-refresh-status")).toContainText("Refreshed");
    // The reloaded page model still names the 06:00 run; the run just followed keeps the limit on.
    await expect(page.getByRole("button", { name: "Refresh" })).toBeDisabled();
  });

  test("says when the data is behind, and when the last refresh failed", async ({ page }) => {
    const view = goalsPage({
      latestAttempt: runAt({ id: 43, status: "failed", startedAt: "2026-10-14T13:10:00.000Z", finishedAt: "2026-10-14T13:12:00.000Z", error: "57014: canceling statement due to statement timeout" }),
    });
    view.model!.behind = { production: true, sage: false };
    view.model!.cutoffs = { productionCutoff: "2026-10-09", sageCutoff: "2026-10-14" };
    await mockGoalsApi(page, view);
    await gotoGoals(page);
    await expect(page.getByTestId("goals-behind")).toHaveText(
      "Data is behind. FileMaker runs through Oct 9. Anything after that is missing until the system catches up, unless your team entered it by hand."
    );
    await expect(page.getByTestId("goals-failed-run")).toContainText(
      "The last refresh, at Oct 14, 9:10 AM, failed: 57014: canceling statement due to statement timeout. This page still shows run #41"
    );
  });

  test("before the first refresh, and before the connection exists, it says so", async ({ page }) => {
    const empty = { ...goalsPage(), state: "no_data" as const, run: null, model: null, settings: null, fx: null, latestAttempt: null };
    await mockGoalsApi(page, empty);
    await gotoGoals(page);
    await expect(page.getByTestId("goals-not-ready")).toContainText("No data yet");
    await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();

    await page.unrouteAll({ behavior: "ignoreErrors" });
    await mockGoalsApi(page, { ...empty, state: "not_configured" });
    await page.reload();
    await expect(page.getByTestId("goals-not-ready")).toContainText("Not connected yet");
    await expect(page.getByRole("button", { name: "Refresh" })).toHaveCount(0);
  });

  test("without a Goals role it says what is missing instead of failing", async ({ page }) => {
    await mockGoalsApi(page, {
      status: 403,
      code: "forbidden",
      message: "Goals & production needs the Goals.Viewer or Goals.Editor Entra app role.",
    });
    await gotoGoals(page);
    await expect(page.getByTestId("goals-no-access")).toContainText(
      "Goals & production needs the Goals.Viewer or Goals.Editor Entra app role."
    );
    await expect(page.getByText("Failed to load.")).toHaveCount(0);
  });

  test("lives under Reporting in the sidebar", async ({ page }) => {
    await mockGoalsApi(page);
    await page.goto("/");
    await page.locator("[data-mc-ready='true']").waitFor({ state: "attached", timeout: 30_000 });
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("group", { name: "Reporting" })).toBeVisible();
    await nav.getByRole("link", { name: "Goals & production" }).click();
    await expect(page).toHaveURL(/\?screen=goals$/);
    await expect(page.getByTestId("goals-card-revenue")).toBeVisible();
  });
});
