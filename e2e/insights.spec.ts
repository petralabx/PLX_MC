import { expect, test } from "@playwright/test";

import { waitForHydration } from "./helpers";

// SPEC §3.B (Module E) — the Insights view: a native-SVG, current-state read over
// allTasks(). Reachable from the sidebar Views group, the ⌘K palette, and the
// `g i` chord. It renders a status donut + the Total / Overdue / Unassigned /
// Blocked KPIs + by-Initiative / by-Assignee / by-Priority breakdown bars. Every
// status/priority/assignee SEGMENT is click-to-filter: the click navigates to the
// board and applies the matching FilterState (via route.filter → WorkViews'
// sanitizeFilterState, the F↔E trust boundary). A BUCKET segment navigates to the
// bucket-scoped board (bucket is a board axis, not a FilterState facet, §3.B.5).
//
// Runs on the deterministic offline fixtures (no DB) — the 15-task go-live seed.
// Stable facts asserted below are derived from src/lib/mc-data/data.ts:
//   • 15 tasks, ALL unassigned (assignee:null) → one "Unassigned" assignee slice
//     of value 15; total KPI = 15.
//   • Priority "High" = TASK-227/230/234 = 3 tasks (a non-zero, enabled segment).
//   • Status band "To do" = backlog+planned = 13 (the dominant donut arc).

async function gotoInsights(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await waitForHydration(page);
  await page.locator("nav.mc-side button", { hasText: "Insights" }).first().click();
  // The Insights page header identifies the screen (kicker "Insights").
  await expect(page.locator(".mc-main .ph .kk")).toContainText("Insights");
}

test.describe("Insights view", () => {
  test("reachable via the sidebar entry, with the donut, KPIs, and breakdown bars", async ({
    page,
  }) => {
    await gotoInsights(page);

    // ── Status donut renders (role="group" — arcs are interactive filter
    //    buttons, so the svg is a labelled group), with the total in its center. ─
    const donut = page.locator(".insights .donut svg[role='group']");
    await expect(donut).toBeVisible();
    await expect(donut).toHaveAttribute("aria-label", /Status:/);
    // Center KPI text = the total task count (15 in the seed fixture).
    await expect(page.locator(".insights .donut .total")).toHaveText("15");

    // ── The four KPIs render with their labels + values. ───────────────────────
    const kpis = page.locator(".insights .kpis .kpi");
    await expect(kpis).toHaveCount(4);
    const totalKpi = kpis.filter({ hasText: "Total tasks" });
    await expect(totalKpi.locator(".v")).toHaveText("15");
    // Overdue / Unassigned / Blocked KPIs are present (values are deterministic:
    // overdue=3 (Jun-15 dues < day 16), unassigned=15, blocked=0).
    await expect(kpis.filter({ hasText: "Overdue" }).locator(".v")).toHaveText("3");
    await expect(kpis.filter({ hasText: "Unassigned" }).locator(".v")).toHaveText("15");
    await expect(kpis.filter({ hasText: "Blocked" }).locator(".v")).toHaveText("0");

    // ── The three breakdown bars render (By initiative / assignee / priority). ──
    const bars = page.locator(".insights .catbar");
    await expect(bars).toHaveCount(3);
    await expect(page.locator(".insights .catbar", { hasText: "By initiative" })).toBeVisible();
    await expect(page.locator(".insights .catbar", { hasText: "By assignee" })).toBeVisible();
    const priorityBar = page.locator(".insights .catbar", { hasText: "By priority" });
    await expect(priorityBar).toBeVisible();
    // The priority bar has clickable rows (one per priority key present + zero
    // rows for absent ones, which are disabled). At least one enabled row exists.
    await expect(priorityBar.locator(".catrow:not([disabled])").first()).toBeVisible();

    // The status legend (the keyboard twin of the donut arcs) renders too.
    await expect(page.locator(".insights .clegend .row").first()).toBeVisible();
  });

  test("reachable via the `g i` view chord", async ({ page }) => {
    await page.goto("/");
    await waitForHydration(page);
    // Neutral focus (the inbox page heading — NOT an interactive row) so the bare
    // chord fires rather than being typed into a field.
    await page.locator(".mc-main .ph h1").first().click();
    await page.keyboard.press("g");
    await page.keyboard.press("i");
    await expect(page.locator(".mc-main .ph .kk")).toContainText("Insights");
    await expect(page.locator(".insights .donut svg[role='group']")).toBeVisible();
  });

  test("reachable via the ⌘K command palette", async ({ page }) => {
    await page.goto("/");
    await waitForHydration(page);
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.locator(".mc-cmdk");
    await expect(palette).toBeVisible();
    await palette.locator("input").fill("Insights");
    await palette.getByText("Go to Insights").click();
    await expect(page.locator(".mc-main .ph .kk")).toContainText("Insights");
    await expect(page.locator(".insights .donut svg[role='group']")).toBeVisible();
  });

  test("a PRIORITY segment click navigates to the board AND applies the matching filter", async ({
    page,
  }) => {
    await gotoInsights(page);

    // The "By priority" bar — click the "High" row (deterministic: 3 tasks).
    const priorityBar = page.locator(".insights .catbar", { hasText: "By priority" });
    const highRow = priorityBar.locator(".catrow", { hasText: /^High3$|High/ }).filter({
      has: page.locator(".nm", { hasText: /^High$/ }),
    });
    await expect(highRow).toBeEnabled();
    // The segment's own count, read off the row, is the subset size we expect to
    // see on the filtered board (no hard-coded magic number — read it live).
    const segCount = Number((await highRow.locator(".ct").textContent())?.trim());
    expect(segCount).toBeGreaterThan(0);
    await highRow.click();

    // Landed on the board: the Group-by toolbar is present (the WorkViews surface)
    // and the workspace kicker shows (not the Insights kicker).
    await expect(page.getByText("Group by")).toBeVisible();
    await expect(page.locator(".mc-main .ph .kk")).toContainText("Workspace");

    // The Priority · High filter chip is applied …
    await expect(page.locator(".filterbar .fb-chip", { hasText: "Priority · High" })).toBeVisible();
    // … and the board is narrowed to exactly the segment's count, every card High.
    await expect(page.locator(".mc .tcard")).toHaveCount(segCount);
    await expect(page.locator(".filterbar .fb-count")).toContainText(String(segCount));
  });

  test("a STATUS segment click navigates to the board AND applies the band's stage filter", async ({
    page,
  }) => {
    await gotoInsights(page);

    // The status legend is the keyboard-friendly twin of the donut arcs and uses
    // the same click-to-filter path. Click the "To do" band row (the dominant,
    // always-enabled band in the seed: 13 tasks across backlog+planned stages).
    const todoRow = page
      .locator(".insights .clegend .row")
      .filter({ has: page.locator(".nm", { hasText: /^To do$/ }) });
    await expect(todoRow).toBeEnabled();
    const segCount = Number((await todoRow.locator(".ct").textContent())?.trim());
    expect(segCount).toBeGreaterThan(0);
    await todoRow.click();

    // Landed on the board with one or more Stage chips applied (a band maps to N
    // stages — there is no synthetic "band" facet, §3.B.5).
    await expect(page.getByText("Group by")).toBeVisible();
    const stageChips = page.locator(".filterbar .fb-chip", { hasText: "Stage ·" });
    await expect(stageChips.first()).toBeVisible();
    // The filtered board equals the band's task count (the click-to-filter is
    // honest: the union of the band's stages == the donut segment value).
    await expect(page.locator(".mc .tcard")).toHaveCount(segCount);
    await expect(page.locator(".filterbar .fb-count")).toContainText(String(segCount));
  });

  test("the Unassigned assignee segment click scopes the board to unassigned", async ({ page }) => {
    await gotoInsights(page);

    // Every seed task is unassigned, so the assignee bar has a single "Unassigned"
    // row of value 15. The Unassigned KPI is the same click-to-filter path.
    const assigneeBar = page.locator(".insights .catbar", { hasText: "By assignee" });
    const unassignedRow = assigneeBar
      .locator(".catrow")
      .filter({ has: page.locator(".nm", { hasText: /^Unassigned$/ }) });
    await expect(unassignedRow).toBeEnabled();
    const segCount = Number((await unassignedRow.locator(".ct").textContent())?.trim());
    expect(segCount).toBeGreaterThan(0);
    await unassignedRow.click();

    await expect(page.getByText("Group by")).toBeVisible();
    // The Assignee · Unassigned chip is applied and the board shows that subset.
    await expect(
      page.locator(".filterbar .fb-chip", { hasText: "Assignee · Unassigned" })
    ).toBeVisible();
    await expect(page.locator(".mc .tcard")).toHaveCount(segCount);
  });

  test("a BUCKET segment click navigates to the board scoped to that bucket", async ({ page }) => {
    await gotoInsights(page);

    // Bucket is a board AXIS, not a FilterState facet (§3.B.5): clicking a
    // by-initiative segment navigates to the bucket-scoped board (nav by
    // bucketId), NOT a filter chip. Click the first initiative row.
    const bucketBar = page.locator(".insights .catbar", { hasText: "By initiative" });
    const firstBucketRow = bucketBar.locator(".catrow:not([disabled])").first();
    await expect(firstBucketRow).toBeVisible();
    const bucketName = ((await firstBucketRow.locator(".nm").textContent()) ?? "").trim();
    const segCount = Number((await firstBucketRow.locator(".ct").textContent())?.trim());
    expect(bucketName.length).toBeGreaterThan(0);
    expect(segCount).toBeGreaterThan(0);
    await firstBucketRow.click();

    // Landed on the bucket-scoped board: the Group-by toolbar is present, the
    // bucket scope pill shows (a "·" bucket id chip — suppressed only on My
    // Tasks), and NO filter chip was added (bucket is not a facet).
    await expect(page.getByText("Group by")).toBeVisible();
    await expect(page.locator(".mc-main .ph .pill.muted")).toBeVisible();
    await expect(page.locator(".filterbar .fb-chip")).toHaveCount(0);
    // The board is scoped to that initiative's tasks (its segment count).
    await expect(page.locator(".mc .tcard")).toHaveCount(segCount);
  });

  test("reduced-motion: the charts still render the final state (no tween dependency)", async ({
    page,
  }) => {
    // SPEC §3.B.4: the rendered (final) chart state is the default OUTSIDE the
    // prefers-reduced-motion: no-preference query, so reduced-motion users get the
    // full chart instantly. Smoke only — assert the chart renders, no tween check.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await gotoInsights(page);
    await expect(page.locator(".insights .donut svg[role='group']")).toBeVisible();
    await expect(page.locator(".insights .donut .total")).toHaveText("15");
    // At least one arc segment is painted (a non-zero band) and is interactive.
    await expect(page.locator(".insights .donut .arc[role='button']").first()).toBeVisible();
  });
});
