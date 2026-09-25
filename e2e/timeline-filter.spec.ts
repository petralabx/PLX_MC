import { expect, test } from "@playwright/test";

import { TASKS } from "../src/lib/mc-data/data";
import { gotoBoard } from "./helpers";

// SPEC §3.G (Module G) — the timeline obeys the shared FilterState.
//   • Cycle-1 left the filter bar HIDDEN on the timeline and rendered the full
//     baseTasks scope. Cycle-2 wires <FilterBar> above the timeline too and feeds
//     TimelineView the same filtered `visible` set, so one FilterState narrows
//     all three lenses (board / list / timeline). A "Due" preset facet is the
//     timeline's natural filter.
//   • The two former dead palette stubs are now real per-task spine actions
//     ("Mark <id> done" → stage verified; "Assign <id> to me" → the viewer),
//     routed through the frozen mutation spine.
//
// Determinism: offline fixtures (src/lib/mc-data/data.ts). The "Next cycle
// (Jun 15–28)" preset = {dueStart:15,dueEnd:28} on the June-grid dueDay scale.
// Seed tasks due Jun 15 (TASK-221/222/223) + Jun 22 (TASK-224/225) fall in range;
// everything from Jun 29 on (dueDay ≥ 59) is excluded → a strict, stable narrow.

const PATCH_RE = /\/api\/tasks\/[^/]+$/;

// A PATCH success mock (mirrors drag.spec.ts): with no Postgres the real PATCH
// 500s and the spine would roll the optimistic edit back. To exercise the SUCCESS
// path deterministically, echo the fixture task with the request's patch applied
// in the standard { data } envelope — exactly what a persisting engine returns.
async function mockPatchSuccess(page: import("@playwright/test").Page) {
  await page.route(PATCH_RE, async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    const id = new URL(route.request().url()).pathname.split("/").pop()!;
    const { actor, ...patch } = JSON.parse(route.request().postData() ?? "{}");
    void actor;
    const base = TASKS.find((t) => t.id === id);
    const task = { ...base, ...patch, id };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: task }),
    });
  });
}

// Switch to the timeline lens and confirm it mounted (its bucket/track grid).
async function gotoTimeline(page: import("@playwright/test").Page) {
  await page.locator(".tb .vsw button", { hasText: /^Timeline$/ }).click();
  await expect(page.locator(".mc .tl")).toBeVisible();
}

// Timeline task rows (one ".row" per task in the filtered `visible` set, grouped
// by bucket). Bucket group headers are ".grp" (no ".row"), so this counts tasks.
function timelineRows(page: import("@playwright/test").Page) {
  return page.locator(".mc .tl .row");
}

test.describe("timeline respects the shared filter", () => {
  test("a Due preset narrows the timeline (the previously-unfiltered timeline now filters)", async ({
    page,
  }) => {
    await gotoBoard(page);
    await gotoTimeline(page);

    // Unfiltered: the timeline shows every seed task as a row.
    const total = await timelineRows(page).count();
    expect(total).toBeGreaterThan(1);

    // The filter bar is now present ON the timeline (Cycle-1 hid it here). Open
    // the "Due" preset facet and apply "Next cycle (Jun 15–28)".
    const dueBtn = page.locator(".filterbar .fb-due .fb-pill");
    await expect(dueBtn).toBeVisible();
    await dueBtn.click();
    await page.locator(".filterbar .fb-due-pop .fb-opt", { hasText: "Next cycle" }).click();

    // A removable Due chip is applied and the timeline narrows (strictly fewer
    // rows than the full set — the timeline now respects the shared filter).
    await expect(page.locator(".filterbar .fb-chip", { hasText: "Due ·" })).toBeVisible();
    const narrowed = timelineRows(page);
    await expect(async () => {
      const n = await narrowed.count();
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThan(total);
    }).toPass();
  });

  test("the same Due filter narrows board + timeline identically (one filter, three lenses)", async ({
    page,
  }) => {
    await gotoBoard(page);

    // Apply the Due preset while on the board.
    await page.locator(".filterbar .fb-due .fb-pill").click();
    await page.locator(".filterbar .fb-due-pop .fb-opt", { hasText: "Next cycle" }).click();
    await expect(page.locator(".filterbar .fb-chip", { hasText: "Due ·" })).toBeVisible();
    const boardCount = await page.locator(".mc .tcard").count();
    expect(boardCount).toBeGreaterThan(0);

    // Switch to the timeline — the SAME FilterState applies; row count matches
    // the board's filtered card count (cross-lens sync, the Module-G invariant).
    await gotoTimeline(page);
    await expect(page.locator(".filterbar .fb-chip", { hasText: "Due ·" })).toBeVisible();
    await expect(timelineRows(page)).toHaveCount(boardCount);

    // Clearing the filter restores every row on the timeline.
    await page.locator(".filterbar .fb-chip", { hasText: "Due ·" }).click();
    await expect(page.locator(".filterbar .fb-chip")).toHaveCount(0);
    await expect(async () => {
      expect(await timelineRows(page).count()).toBeGreaterThan(boardCount);
    }).toPass();
  });

  test("palette spine action: 'Assign <id> to me' assigns the current user (no fabricated Synced)", async ({
    page,
  }) => {
    await mockPatchSuccess(page);
    await gotoBoard(page);

    // Group by assignee so the board has a column the reassignment can move a
    // card INTO (the seed is all-unassigned → a single "Unassigned" column).
    await page.locator(".tb .seg").first().locator("button", { hasText: /^Assignee$/ }).click();
    await expect(page.locator(".mc .board .bcol")).toHaveCount(1);
    await expect(
      page.locator(".mc .board .bcol .bhead .nm", { hasText: "Unassigned" })
    ).toBeVisible();

    // ⌘K → run "Assign TASK-221 to me" (a real per-task spine action, Module G).
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.locator(".mc-cmdk");
    await expect(palette).toBeVisible();
    await palette.locator("input").fill("Assign TASK-221 to me");
    await palette.getByText("Assign TASK-221 to me").click();
    await expect(palette).toBeHidden();

    // The reassignment lands through the spine: a "Vince" assignee column now
    // exists (the seed user's name) and TASK-221 moved out of "Unassigned".
    const assigned = page.locator(".mc .board .bcol").filter({
      has: page.locator(".bhead .nm", { hasText: "Vince" }),
    });
    await expect(assigned.locator(".tcard", { hasText: "TASK-221" })).toHaveCount(1);
    await expect(
      page
        .locator(".mc .board .bcol")
        .filter({ has: page.locator(".bhead .nm", { hasText: "Unassigned" }) })
        .locator(".tcard", { hasText: "TASK-221" })
    ).toHaveCount(0);

    // No fabricated "Synced": the Assigned-To mirror is deferred, so the card's
    // sync tick must NOT claim Synced (honest deferred-mirror copy, §3.G.2).
    await expect(
      assigned.locator(".tcard", { hasText: "TASK-221" }).locator(".sync")
    ).not.toContainText("Synced");
  });

  test("palette spine action: 'Mark <id> done' moves the task to a done-band stage", async ({
    page,
  }) => {
    await mockPatchSuccess(page);
    await gotoBoard(page);

    // Group by stage so the move to "Verified" (band=done) is observable as a
    // column change. TASK-221 seeds in "Planned".
    await page.locator(".tb .seg").first().locator("button", { hasText: /^Stage$/ }).click();
    await expect(page.locator(".mc .board .bcol")).toHaveCount(9);
    await expect(
      page
        .locator(".mc .board .bcol")
        .filter({ has: page.locator(".bhead .nm", { hasText: "Planned" }) })
        .locator(".tcard", { hasText: "TASK-221" })
    ).toHaveCount(1);

    // ⌘K → "Mark TASK-221 done" (spine action → stage verified).
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.locator(".mc-cmdk");
    await expect(palette).toBeVisible();
    await palette.locator("input").fill("Mark TASK-221 done");
    await palette.getByText("Mark TASK-221 done").click();
    await expect(palette).toBeHidden();

    // The card is now in the "Verified" stage column and no longer in "Planned".
    const verified = page
      .locator(".mc .board .bcol")
      .filter({ has: page.locator(".bhead .nm", { hasText: "Verified" }) });
    await expect(verified.locator(".tcard", { hasText: "TASK-221" })).toHaveCount(1);
    await expect(
      page
        .locator(".mc .board .bcol")
        .filter({ has: page.locator(".bhead .nm", { hasText: "Planned" }) })
        .locator(".tcard", { hasText: "TASK-221" })
    ).toHaveCount(0);
  });
});
