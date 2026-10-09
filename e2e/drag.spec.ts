import { expect, test } from "@playwright/test";

import { TASKS } from "../src/lib/mc-data/data";
import { boardColumnByName, dragCardToColumnByName, gotoBoard } from "./helpers";

// SPEC §6 #3 + #3a — Drag-to-mutate.
//   • Dragging a card to another column mutates the active-axis field
//     (stage axis: stage; the card moves to the target column and stays).
//   • A same-column drop is a no-op (no PATCH, no move).
//   • #3a: on a FAILED PATCH the optimistic edit ROLLS BACK and a non-silent
//     notice appears — and there is never a fabricated "Synced" state.
//
// Data note: the suite runs offline (no Postgres → /api/state and the real
// PATCH 500). To exercise the SUCCESS path deterministically we intercept
// `PATCH /api/tasks/:id` and return the patched task (built from the real
// fixture, exactly what a persisted server would echo) so the store's
// reconcile-to-server-truth keeps the move. The FAILURE path uses a 500.

const PATCH_RE = /\/api\/tasks\/[^/]+$/;

// A success mock: echo the fixture task with the request's patch applied, in
// the standard { data } envelope — what the engine returns after persisting.
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

test.describe("drag-to-mutate", () => {
  test("dragging a card to another stage column moves it (active-axis field mutates)", async ({
    page,
  }) => {
    await mockPatchSuccess(page);
    let patchCount = 0;
    page.on("request", (req) => {
      if (req.method() === "PATCH" && PATCH_RE.test(req.url())) patchCount += 1;
    });

    await gotoBoard(page);
    // Group by stage so each column is a single stage (the active axis = stage).
    await page.locator(".tb .seg").first().locator("button", { hasText: /^Stage$/ }).click();
    await expect(page.locator(".mc .board .bcol")).toHaveCount(10);

    // TASK-221 (WMS integration) seeds in stage "planned" → the "Planned" column.
    const planned = boardColumnByName(page, "Planned");
    await expect(planned.locator(".tcard", { hasText: "TASK-221" })).toHaveCount(1);

    // Drag it to "In QA" (stage = qa).
    await dragCardToColumnByName(page, "TASK-221", "In QA");

    // The card now lives in the In QA column and no longer in Planned — the
    // stage field mutated, optimistically then reconciled to the mocked server.
    const inQa = boardColumnByName(page, "In QA");
    await expect(inQa.locator(".tcard", { hasText: "TASK-221" })).toHaveCount(1);
    await expect(planned.locator(".tcard", { hasText: "TASK-221" })).toHaveCount(0);
    expect(patchCount).toBe(1);

    // No fabricated "Synced": the card's sync tick stays Pending (DB-only move
    // does not flip to synced; stage is SP-tier but only "pending" until a sweep).
    await expect(inQa.locator(".tcard", { hasText: "TASK-221" }).locator(".sync")).not.toContainText(
      "Synced"
    );
  });

  test("a same-column drop is a no-op (no PATCH, card stays)", async ({ page }) => {
    await mockPatchSuccess(page);
    let patchCount = 0;
    page.on("request", (req) => {
      if (req.method() === "PATCH" && PATCH_RE.test(req.url())) patchCount += 1;
    });

    await gotoBoard(page);
    await page.locator(".tb .seg").first().locator("button", { hasText: /^Stage$/ }).click();

    const planned = boardColumnByName(page, "Planned");
    await expect(planned.locator(".tcard", { hasText: "TASK-221" })).toHaveCount(1);

    // Drop TASK-221 back onto its CURRENT column ("Planned") → no-op guard.
    await dragCardToColumnByName(page, "TASK-221", "Planned");

    // Still in Planned, and crucially no PATCH was issued.
    await expect(planned.locator(".tcard", { hasText: "TASK-221" })).toHaveCount(1);
    // Give any (erroneous) network a beat to surface via the web-first retry.
    await expect(() => expect(patchCount).toBe(0)).toPass({ timeout: 2000 });
  });

  test("#3a — a failed PATCH rolls the move back and surfaces a non-silent notice", async ({
    page,
  }) => {
    // Force the mirrored PATCH to fail.
    await page.route(PATCH_RE, async (route) => {
      if (route.request().method() !== "PATCH") return route.fallback();
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "internal", message: "Induced PATCH failure." } }),
      });
    });

    await gotoBoard(page);
    await page.locator(".tb .seg").first().locator("button", { hasText: /^Stage$/ }).click();

    const planned = boardColumnByName(page, "Planned");
    const inQa = boardColumnByName(page, "In QA");
    await expect(planned.locator(".tcard", { hasText: "TASK-221" })).toHaveCount(1);

    await dragCardToColumnByName(page, "TASK-221", "In QA");

    // Rollback: the card returns to its original column (the optimistic move is
    // reverted once the PATCH rejects).
    await expect(planned.locator(".tcard", { hasText: "TASK-221" })).toHaveCount(1);
    await expect(inQa.locator(".tcard", { hasText: "TASK-221" })).toHaveCount(0);

    // A non-silent rollback notice is shown (NoticeHost), never a fabricated
    // "Synced".
    const notice = page.locator(".mc-notices .mc-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(/rolled back/i);
    await expect(planned.locator(".tcard", { hasText: "TASK-221" }).locator(".sync")).not.toContainText(
      "Synced"
    );
  });

  // SPEC §6 #3 (reload-persistence half): the anti-data-loss assertion — after a
  // successful drag, a full reload (forcing GET /api/state hydrate) must STILL
  // show the move. This requires a live Postgres-backed /api/state so the engine
  // can persist + echo the change. This environment has no Postgres (no server,
  // no admin URL, no psql), and the store deterministically re-seeds from the
  // in-memory fixture on every fresh load when /api/state 500s — so asserting
  // "persisted across reload" here would be asserting the fixture, not real
  // persistence (a fake pass). Implemented correctly and skipped with this
  // reason; the server-side persistence chain is covered programmatically by the
  // vitest `patchTask` → repo.updateEntity round-trip test (SPEC §6 server tests).
  test.skip("drag persists across a full reload (requires live Postgres /api/state)", async ({
    page,
  }) => {
    await mockPatchSuccess(page);
    await gotoBoard(page);
    await page.locator(".tb .seg").first().locator("button", { hasText: /^Stage$/ }).click();
    await dragCardToColumnByName(page, "TASK-221", "In QA");
    await expect(boardColumnByName(page, "In QA").locator(".tcard", { hasText: "TASK-221" })).toHaveCount(1);

    // The load-bearing assertion (only meaningful against a persisting backend):
    await page.reload();
    await page.locator(".tb .seg").first().locator("button", { hasText: /^Stage$/ }).click();
    await expect(boardColumnByName(page, "In QA").locator(".tcard", { hasText: "TASK-221" })).toHaveCount(1);
  });
});
