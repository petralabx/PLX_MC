import { expect, test } from "@playwright/test";

import { gotoBoard, openSidebar } from "./helpers";

// SPEC §3.A (Module F) — Saved views & filter persistence (localStorage).
//   • The live FilterState + groupBy persist per screen and survive a RELOAD
//     (the headline fix vs. Cycle-1's reset-on-reload). This is pure localStorage,
//     so it works OFFLINE — unlike the Cycle-1 drag-persistence assertion that
//     needs a live Postgres /api/state (that one is honestly test.skip()'d).
//   • Named views save / clear / re-apply via the "Views ▾" switcher.
//   • The "• modified" dirty cue appears when the live filter diverges from the
//     active saved view's snapshot, and clears when re-applied.
//   • A corrupt persisted blob loads clean (no crash, no console error).
//
// Deterministic offline-fixture facts (src/lib/mc-data/data.ts): 15 seed tasks;
// Priority "High" = TASK-227/230/234 = 3 (a stable, non-empty narrowing).

const VIEW_KEY = "plx_mc_view_v1:board";

// Apply the Priority · High facet on the board (15 → 3). Returns the narrowed
// count so the persistence assertions compare against the live value.
async function applyHighPriority(page: import("@playwright/test").Page): Promise<number> {
  const total = await page.locator(".mc .tcard").count();
  await page.locator(".filterbar .fb-pill", { hasText: "Priority" }).click();
  await page.locator(".filterbar .fb-pop .fb-opt", { hasText: "High" }).click();
  await expect(page.locator(".filterbar .fb-chip", { hasText: "Priority · High" })).toBeVisible();
  const narrowed = page.locator(".mc .tcard");
  await expect(async () => {
    const n = await narrowed.count();
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(total);
  }).toPass();
  return narrowed.count();
}

test.describe("saved views & filter persistence", () => {
  test("a filter survives a full reload (localStorage persistence — offline)", async ({ page }) => {
    await gotoBoard(page);
    const narrowed = await applyHighPriority(page);

    // The headline Module-F fix: a full reload restores the exact filter. The
    // persist effect writes after hydrate; assert the key landed before reloading
    // so we're testing real persistence, not a race.
    await expect
      .poll(async () => page.evaluate((k) => window.localStorage.getItem(k), VIEW_KEY))
      .not.toBeNull();

    // Route state is React-local (the app reboots to the Inbox on a hard
    // reload), so the documented Module-F acceptance is reload + return to the
    // board (SPEC §3.A.8: "a reload AND a nav away-and-back restores the exact
    // {groupBy, filters}"). Re-open the board after the reload.
    await page.reload();
    await openSidebar(page, "Board");
    await expect(page.getByText("Group by")).toBeVisible();

    // The chip + the narrowed board are restored from localStorage, no re-apply.
    await expect(page.locator(".filterbar .fb-chip", { hasText: "Priority · High" })).toBeVisible();
    await expect(page.locator(".mc .tcard")).toHaveCount(narrowed);
  });

  test("save a named view, clear, then re-apply it from the Views switcher", async ({ page }) => {
    await gotoBoard(page);
    const narrowed = await applyHighPriority(page);

    // Open the "Views ▾" switcher and save the current state as a named view.
    const viewsTrigger = page.locator(".fb-views .fb-viewstrigger");
    await expect(viewsTrigger).toBeVisible();
    await viewsTrigger.click();
    const pop = page.locator(".fb-views-pop");
    await expect(pop).toBeVisible();
    await pop.locator(".fb-viewname").fill("High priority");
    await pop.locator(".fb-viewsavebtn").click();

    // The switcher trigger now labels the active view by name (and the popover
    // closes after save is unaffected — the trigger reflects activeViewId).
    await expect(viewsTrigger).toContainText("High priority");

    // Clear all filters → the board widens back to the full set, chip gone.
    await page.locator(".filterbar .fb-clear", { hasText: "Clear filters" }).click();
    await expect(page.locator(".filterbar .fb-chip")).toHaveCount(0);
    const full = await page.locator(".mc .tcard").count();
    expect(full).toBeGreaterThan(narrowed);

    // Re-apply the saved view from the switcher → the filter returns.
    await viewsTrigger.click();
    await expect(page.locator(".fb-views-pop")).toBeVisible();
    await page.locator(".fb-views-pop .fb-viewapply", { hasText: "High priority" }).click();
    await expect(page.locator(".filterbar .fb-chip", { hasText: "Priority · High" })).toBeVisible();
    await expect(page.locator(".mc .tcard")).toHaveCount(narrowed);
  });

  test("the '• modified' dirty cue appears when the active filter diverges, and clears on re-apply", async ({
    page,
  }) => {
    await gotoBoard(page);
    await applyHighPriority(page);

    // Save the current state as a named view → it becomes the active view, and
    // (live state == saved snapshot) so NO dirty dot yet.
    const viewsTrigger = page.locator(".fb-views .fb-viewstrigger");
    await viewsTrigger.click();
    const pop = page.locator(".fb-views-pop");
    await pop.locator(".fb-viewname").fill("High only");
    await pop.locator(".fb-viewsavebtn").click();
    await expect(viewsTrigger).toContainText("High only");
    await expect(viewsTrigger.locator(".fb-dirty")).toHaveCount(0);

    // Diverge from the saved snapshot — add a second facet (Stage · In QA). The
    // live state now differs from the saved view → the "• modified" dot appears.
    await page.locator(".filterbar .fb-pill", { hasText: "Stage" }).click();
    await page.locator(".filterbar .fb-pop .fb-opt", { hasText: "In QA" }).click();
    await expect(page.locator(".filterbar .fb-chip", { hasText: "Stage · In QA" })).toBeVisible();
    await expect(viewsTrigger.locator(".fb-dirty")).toBeVisible();

    // Re-applying the saved view restores its snapshot and clears the dirty cue.
    await viewsTrigger.click();
    await page.locator(".fb-views-pop .fb-viewapply", { hasText: "High only" }).click();
    await expect(page.locator(".filterbar .fb-chip", { hasText: "Stage · In QA" })).toHaveCount(0);
    await expect(viewsTrigger.locator(".fb-dirty")).toHaveCount(0);
  });

  test("a corrupt persisted blob loads clean — no crash, no console error", async ({ page }) => {
    // SPEC §3.A.7: seed a corrupt last-used blob BEFORE the app boots; the pure
    // deserializeView returns null on bad JSON, so the board loads at defaults.
    // An UNCAUGHT page error is the real crash signal we guard against.
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    // Console errors too — but the offline harness deliberately runs with no
    // Postgres, so GET /api/state 500s by design (see playwright.config.ts); that
    // documented resource-load noise is filtered out, not a Module-F failure.
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      if (/\/api\/state/.test(text)) return; // documented offline fallback
      if (/Failed to load resource.*500/i.test(text)) return; // the same 500, surfaced as a resource error
      // Home's "What needs me" reads session-gated approvals / routing; with no
      // Entra session in this harness they 403 by design (Home shows its error
      // state). Filter only those URLs so any other resource error still fails.
      if (
        /Failed to load resource.*403/i.test(text) &&
        /\/api\/(approvals|routing\/inbox)\b/.test(msg.location().url)
      ) {
        return;
      }
      consoleErrors.push(text);
    });
    await page.addInitScript((k) => {
      window.localStorage.setItem(k, "{bad json");
    }, VIEW_KEY);

    await gotoBoard(page);
    // Loads clean at defaults: cards render, no active filter chip, default Band
    // axis (3 columns). The corrupt blob degraded to defaults, never threw.
    await expect(page.locator(".mc .tcard").first()).toBeVisible();
    await expect(page.locator(".filterbar .fb-chip")).toHaveCount(0);
    await expect(page.locator(".mc .board .bcol")).toHaveCount(3);

    expect(pageErrors, `unexpected uncaught page errors: ${pageErrors.join(" | ")}`).toEqual([]);
    expect(consoleErrors, `unexpected console errors: ${consoleErrors.join(" | ")}`).toEqual([]);
  });
});
