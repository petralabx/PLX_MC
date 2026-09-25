import { expect, test } from "@playwright/test";

import { waitForHydration } from "./helpers";

// EN-005 — buckets are flexible: the operator can create a new initiative from
// the sidebar, it lands optimistically, the app routes to its detail, and it
// shows up in the sidebar bucket list (the single dynamic source of truth).
//
// Data note (same approach as drag.spec.ts): the suite runs dormant with no
// Entra session, so the real POST /api/buckets answers 403 and the store
// correctly rolls the optimistic bucket back — these assertions then only pass
// if they win a race against that rollback. To exercise the SUCCESS path
// deterministically, echo the bucket a persisting server would return. The
// rollback path is unit-tested (tests/mc-buckets.test.ts, mc-new-initiative).
const NAME = "E2E Test Initiative";
// The id the store derives from the name (bucketIdFromName) — echoed so the
// reconcile keeps the optimistic id the app routed to.
const BUCKET_ID = "BKT-E2E-TEST-INITIATIVE";

async function mockCreateSuccess(page: import("@playwright/test").Page) {
  await page.route(/\/api\/buckets$/, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = JSON.parse(route.request().postData() ?? "{}");
    const bucket = {
      id: BUCKET_ID,
      name: body.name,
      owner: body.owner ?? "vince",
      health: body.health ?? "track",
      target: body.target || "—",
      started: body.started || "2026.09.25",
      desc: body.desc ?? "",
      repos: body.repos ?? [],
      sync: { state: "pending", ts: "—", sp: "Roadmap · unprovisioned" },
      prd: body.prd ?? null,
      project: body.project ?? null,
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: bucket }),
    });
  });
}

test.describe("create a new initiative (EN-005)", () => {
  test("the New initiative modal creates a bucket that opens its detail + appears in the sidebar", async ({
    page,
  }) => {
    await mockCreateSuccess(page);
    await page.goto("/");
    await waitForHydration(page);

    // Open the modal from the sidebar "+ New initiative" affordance.
    await page.locator("nav.mc-side button", { hasText: "New initiative" }).click();
    const dialog = page.locator(".ntm[role='dialog']");
    await expect(dialog).toBeVisible();

    const name = NAME;
    await dialog.locator(".ntm-title").fill(name);
    await dialog.getByRole("button", { name: /Create initiative/ }).click();

    // Routes to the new bucket's detail view (header h1 = the name).
    await expect(page.locator(".mc-main .ph h1")).toContainText(name);

    // …and the initiative is now a live row in the sidebar bucket list.
    await expect(
      page.locator("nav.mc-side button .nm", { hasText: name })
    ).toBeVisible();
  });
});
