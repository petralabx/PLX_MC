import { expect, test } from "@playwright/test";

import { openSidebar, waitForHydration } from "./helpers";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
// A scariest-first mix (as the API sorts): over-budget, degraded automated
// vendor, live automated vendor, manual vendor with no budget.

const VENDORS = {
  cursor: {
    id: "cursor",
    name: "Cursor",
    category: "ai",
    adapter: "cursor",
    billing: "usage",
    console_url: "https://cursor.com/dashboard",
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic (Claude)",
    category: "ai",
    adapter: "anthropic",
    billing: "usage",
    notes: "Org cost report via the Admin API.",
  },
  aws: {
    id: "aws",
    name: "Amazon Web Services",
    category: "cloud",
    adapter: "aws",
    billing: "usage",
  },
  adobe: {
    id: "adobe",
    name: "Adobe",
    category: "creative",
    adapter: "manual",
    billing: "subscription",
  },
};

const FIXTURE_ROWS = [
  // rank 0 — over budget
  {
    vendor: VENDORS.cursor,
    sourceStatus: "live",
    spendCents: 120_000,
    estimated: true,
    snapshotCount: 1,
    budget: {
      vendorId: "cursor",
      monthlyBudgetCents: 100_000,
      warnPct: 0.8,
      criticalPct: 0.95,
      updatedBy: "vince",
      updatedAt: "2026-07-01T00:00:00Z",
    },
    periodBudgetCents: 100_000,
    utilization: 1.2,
    alert: "over",
    lastRefresh: {
      id: "vcr-1",
      vendorId: "cursor",
      status: "ok",
      snapshotCount: 1,
      createdAt: "2026-07-15T08:00:00Z",
    },
  },
  // rank 1 — degraded automated source (missing admin key)
  {
    vendor: VENDORS.anthropic,
    sourceStatus: "degraded",
    degradedReason: "key_missing",
    degradedNote:
      "Anthropic (Claude) adapter credentials are not configured — spend shown from manual entries only.",
    spendCents: 0,
    estimated: false,
    snapshotCount: 0,
    budget: null,
    periodBudgetCents: null,
    utilization: null,
    alert: "none",
    lastRefresh: null,
  },
  // rank 2 — healthy live vendor under budget
  {
    vendor: VENDORS.aws,
    sourceStatus: "live",
    spendCents: 181_900,
    estimated: true,
    snapshotCount: 15,
    budget: {
      vendorId: "aws",
      monthlyBudgetCents: 400_000,
      warnPct: 0.8,
      criticalPct: 0.95,
      updatedBy: "vince",
      updatedAt: "2026-07-01T00:00:00Z",
    },
    periodBudgetCents: 400_000,
    utilization: 0.4547,
    alert: "ok",
    lastRefresh: {
      id: "vcr-2",
      vendorId: "aws",
      status: "ok",
      snapshotCount: 15,
      createdAt: "2026-07-15T08:00:00Z",
    },
  },
  // rank 3 — manual vendor, no budget
  {
    vendor: VENDORS.adobe,
    sourceStatus: "manual",
    spendCents: 0,
    estimated: false,
    snapshotCount: 0,
    budget: null,
    periodBudgetCents: null,
    utilization: null,
    alert: "none",
    lastRefresh: null,
  },
];

const FIXTURE_INDEX = {
  period: { period: "mtd", start: "2026-07-01", end: "2026-07-16" },
  rows: FIXTURE_ROWS,
  totals: {
    spendCents: 301_900,
    budgetedSpendCents: 301_900,
    periodBudgetCents: 500_000,
    warn: 0,
    critical: 0,
    over: 1,
  },
};

const ANTHROPIC_DETAIL = {
  row: FIXTURE_ROWS[1],
  snapshots: [],
  refreshLog: [
    {
      id: "vcr-3",
      vendorId: "anthropic",
      status: "degraded",
      message: "[key_missing] ANTHROPIC_ADMIN_API_KEY is not configured.",
      snapshotCount: 0,
      createdAt: "2026-07-15T08:00:00Z",
    },
  ],
};

// ─── Test suite ───────────────────────────────────────────────────────────────

test.describe("ai spend screen", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/vendor-spend?*", (route) => {
      if (route.request().method() !== "GET") {
        return route.fulfill({ status: 405, body: "Method Not Allowed" });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: FIXTURE_INDEX }),
      });
    });

    await page.route("**/api/vendor-spend/anthropic?*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: ANTHROPIC_DETAIL }),
      })
    );

    await page.goto("/");
    await waitForHydration(page);
    await openSidebar(page, "AI Spend");
    await expect(page.locator("[data-testid='ai-spend-screen']")).toBeVisible();
  });

  test("renders every vendor row scariest-first with honest source pills", async ({ page }) => {
    const rows = page.locator("[data-testid='vs-row']");
    await expect(rows).toHaveCount(FIXTURE_ROWS.length);

    await expect(rows.nth(0)).toHaveAttribute("data-alert", "over");
    await expect(rows.nth(1)).toHaveAttribute("data-source", "degraded");
    await expect(rows.nth(1)).toContainText("API · DEGRADED");
    await expect(rows.nth(3)).toContainText("MANUAL");
  });

  test("alert banner and stat cards surface the over-budget vendor", async ({ page }) => {
    const banner = page.locator(".vs-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("1 over budget");

    const stats = page.locator(".vs-stat");
    await expect(stats.nth(0)).toContainText("$3,019.00");
    await expect(stats.nth(2)).toContainText("1"); // alerting
  });

  test("sidebar badge shows the alerting vendor count", async ({ page }) => {
    const navItem = page.locator("nav.mc-side a", { hasText: "AI spend" });
    await expect(navItem.locator(".badge")).toContainText("1");
  });

  test("period tabs re-query the API with the chosen period", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/vendor-spend?")) requests.push(req.url());
    });
    await page.locator(".vs-tab", { hasText: "Year to date" }).click();
    await expect(page.locator(".vs-tab.on")).toContainText("Year to date");
    expect(requests.some((u) => u.includes("period=ytd"))).toBe(true);
  });

  test("clicking a degraded vendor opens detail with the loud degraded panel", async ({ page }) => {
    await page.locator("[data-testid='vs-row'][data-vendor='anthropic']").click();

    const detail = page.locator("[data-testid='vs-detail']");
    await expect(detail).toBeVisible();

    const panel = page.locator("[data-testid='vs-degraded-panel']");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("key_missing");

    // Budget editor + manual entry stay available for a degraded vendor.
    await expect(page.locator("[data-testid='vs-budget-editor']")).toBeVisible();
    await expect(page.locator("[data-testid='vs-manual-form']")).toBeVisible();

    await page.locator(".vs-back").click();
    await expect(page.locator("[data-testid='vs-table']")).toBeVisible();
  });

  test("recommend-only agent panel carries no action controls", async ({ page }) => {
    const stub = page.locator(".vs-agent-stub");
    await expect(stub).toBeVisible();
    await expect(stub).toContainText("Read-only in v1");
    await expect(stub.locator("button, a")).toHaveCount(0);
  });
});
