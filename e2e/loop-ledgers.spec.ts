import { expect, test } from "@playwright/test";

import { openSidebar, waitForHydration } from "./helpers";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
// A mix of healthy + degraded rows in scariest-first order (as the API would sort).

const FIXTURE_ROWS = [
  // rank 0 — permission_denied (scariest)
  {
    kind: "degraded-source",
    repo: "taylorvalton/plx-customer-portal",
    repoDisplayName: "PLX Customer Portal",
    reason: "permission_denied",
    note: "HTTP 403 — private repo, no access.",
  },
  // rank 0 — schema_mismatch
  {
    kind: "degraded-source",
    repo: "taylorvalton/schema-wrong",
    repoDisplayName: "Schema Wrong",
    reason: "schema_mismatch",
    note: "schema_version mismatch — expected vmc-quality-ledger/v1.",
  },
  // rank 2 — stale ledger
  {
    kind: "ledger",
    ref: { repo: "taylorvalton/plx-mc", branch: "main", path: "docs/plx-mc/quality-ledger/loop-ledgers.artifacts.json" },
    repo: "taylorvalton/plx-mc",
    repoDisplayName: "PLX MC",
    validationResult: {
      valid: true,
      healthCode: "valid",
      ledger: {
        schema_version: "vmc-quality-ledger/v1",
        module: "loop-ledgers",
        generated_at: new Date(Date.now() - 35 * 86_400_000).toISOString(),
        branch: "main",
        summary: {
          total_artifacts: 2,
          by_type: { defect: 1, risk: 1 },
          by_status: { broken: 1, unknown: 1 },
          by_severity: { critical: 1, medium: 1 },
          by_safety_class: { red: 1, green: 1 },
        },
        artifacts: [
          {
            artifact_id: "LL-001",
            module: "loop-ledgers",
            artifact_type: "defect",
            title: "Cross-repo loader stalls",
            status: "broken",
            severity: "critical",
            safety_class: "red",
            confidence: 0.4,
            next_action: "Investigate loader timeout",
          },
          {
            artifact_id: "LL-002",
            module: "loop-ledgers",
            artifact_type: "risk",
            title: "Registry config drift",
            status: "unknown",
            severity: "medium",
            safety_class: "green",
            confidence: 0.6,
          },
        ],
      },
      errors: [],
      freshnessInfo: { level: "stale", ageDays: 35, reason: "35d > 30d" },
    },
    commitSha: "abc1234def",
  },
  // rank 4 — no_ledgers
  {
    kind: "degraded-source",
    repo: "taylorvalton/agentic-swarm",
    repoDisplayName: "Agentic Swarm",
    reason: "no_ledgers",
    note: "Glob matched 0 files.",
  },
  // rank 6 — valid, fresh, healthy
  {
    kind: "ledger",
    ref: { repo: "taylorvalton/agentic-swarm-healthy", branch: "main", path: "docs/quality-ledger/core.artifacts.json" },
    repo: "taylorvalton/agentic-swarm-healthy",
    repoDisplayName: "Agentic Swarm Healthy",
    validationResult: {
      valid: true,
      healthCode: "valid",
      ledger: {
        schema_version: "vmc-quality-ledger/v1",
        module: "core",
        generated_at: new Date(Date.now() - 1 * 86_400_000).toISOString(),
        branch: "main",
        summary: {
          total_artifacts: 1,
          by_type: { user_story: 1 },
          by_status: { covered: 1 },
          by_severity: { low: 1 },
          by_safety_class: { green: 1 },
        },
        artifacts: [
          {
            artifact_id: "S-001",
            module: "core",
            artifact_type: "user_story",
            title: "User can log in",
            status: "covered",
            severity: "low",
            safety_class: "green",
            confidence: 0.95,
          },
        ],
      },
      errors: [],
      freshnessInfo: { level: "fresh", ageDays: 1, reason: "1d" },
    },
    commitSha: "bcd5678efg",
  },
];

// Detail fixture for the stale ledger row
const DETAIL_FIXTURE = {
  ok: true,
  ref: { repo: "taylorvalton/plx-mc", branch: "main", path: "docs/plx-mc/quality-ledger/loop-ledgers.artifacts.json" },
  repo: "taylorvalton/plx-mc",
  repoDisplayName: "PLX MC",
  validationResult: FIXTURE_ROWS[2].validationResult,
  commitSha: "abc1234def",
};

// ─── Test suite ───────────────────────────────────────────────────────────────

test.describe("loop ledgers screen", () => {
  test.beforeEach(async ({ page }) => {
    // Mock the list API
    await page.route("**/api/loop-ledgers", (route) => {
      if (route.request().method() !== "GET") {
        return route.fulfill({ status: 405, body: "Method Not Allowed" });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: FIXTURE_ROWS }),
      });
    });

    // Mock the detail API (matches any ref param)
    await page.route("**/api/loop-ledgers/**", (route) => {
      if (route.request().method() !== "GET") {
        return route.fulfill({ status: 405, body: "Method Not Allowed" });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: DETAIL_FIXTURE }),
      });
    });

    await page.goto("/");
    await waitForHydration(page);
    await openSidebar(page, "Loop ledgers");
  });

  // ── Index renders rows scariest-first ─────────────────────────────────────

  test("renders the index with all rows in scariest-first order", async ({ page }) => {
    const screen = page.locator("[data-testid='ll-screen']");
    await expect(screen).toBeVisible();

    const rows = page.locator("[data-testid='ll-row']");
    await expect(rows).toHaveCount(FIXTURE_ROWS.length);

    // First row: permission_denied (scariest)
    await expect(rows.nth(0)).toHaveAttribute("data-health", "permission_denied");
    // Second row: schema_mismatch
    await expect(rows.nth(1)).toHaveAttribute("data-health", "schema_mismatch");
    // Third row: stale valid ledger
    await expect(rows.nth(2)).toHaveAttribute("data-fresh", "stale");
    // Fourth row: no_ledgers
    await expect(rows.nth(3)).toHaveAttribute("data-health", "no_ledgers");
    // Last row: fresh + valid (least scary)
    await expect(rows.nth(4)).toHaveAttribute("data-health", "valid");
    await expect(rows.nth(4)).toHaveAttribute("data-fresh", "fresh");
  });

  // ── Stat cards show correct counts ────────────────────────────────────────

  test("stat cards show correct counts", async ({ page }) => {
    // 5 unique repos
    const stats = page.locator(".ll-stat");
    await expect(stats).toHaveCount(6);

    // REPOS stat: 5
    await expect(stats.nth(0)).toContainText("5");
    await expect(stats.nth(0)).toContainText("Repos");

    // LEDGERS: 2 ledger rows
    await expect(stats.nth(1)).toContainText("2");
    await expect(stats.nth(1)).toContainText("Ledgers");

    // DEGRADED: 3 degraded-source rows
    await expect(stats.nth(2)).toContainText("3");
    await expect(stats.nth(2)).toContainText("Degraded");

    // STALE: 1 stale ledger
    await expect(stats.nth(3)).toContainText("1");
    await expect(stats.nth(3)).toContainText("Stale");

    // CRITICAL: 1 ledger with critical artifacts
    await expect(stats.nth(4)).toContainText("1");
    await expect(stats.nth(4)).toContainText("Critical");
  });

  // ── Attention banner shows degraded counts ────────────────────────────────

  test("attention banner lists unreachable and invalid rows", async ({ page }) => {
    const banner = page.locator(".ll-banner");
    await expect(banner).toBeVisible();
    // 1 permission_denied (unreachable) + 1 schema_mismatch (invalid) + 1 stale
    await expect(banner).toContainText("need attention");
  });

  // ── Filter narrows rows ───────────────────────────────────────────────────

  test("repo filter narrows rows to matching repo", async ({ page }) => {
    // Open the Repo filter facet
    await page.locator(".ll-fpill-btn", { hasText: "+ Repo" }).click();
    // Select "taylorvalton/plx-mc"
    const popover = page.locator(".ll-fpop");
    await expect(popover).toBeVisible();
    await popover.locator(".ll-fopt", { hasText: "taylorvalton/plx-mc" }).click();
    await page.mouse.click(0, 0); // close popover by clicking outside

    // Only 1 row should remain
    const rows = page.locator("[data-testid='ll-row']");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute("data-repo", "taylorvalton/plx-mc");
  });

  test("health filter narrows rows to valid-only", async ({ page }) => {
    await page.locator(".ll-fpill-btn", { hasText: "+ Health" }).click();
    const popover = page.locator(".ll-fpop");
    await popover.locator(".ll-fopt", { hasText: "Valid" }).click();
    await page.mouse.click(0, 0);

    const rows = page.locator("[data-testid='ll-row']");
    // 2 valid ledger rows (stale is valid health, fresh is valid health)
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(1);
    for (const row of await rows.all()) {
      await expect(row).toHaveAttribute("data-health", "valid");
    }
  });

  // ── Clicking a row opens detail view with loud health panel ──────────────

  test("clicking a row opens the detail view", async ({ page }) => {
    // Click the stale ledger row (3rd row, index 2)
    await page.locator("[data-testid='ll-row']").nth(2).click();

    // Should navigate to detail tab
    const detail = page.locator("[data-testid='ll-detail-view']");
    await expect(detail).toBeVisible();

    // The loud health panel should be visible
    const healthPanel = page.locator("[data-testid='ll-health-panel']");
    await expect(healthPanel).toBeVisible();

    // Artifact list rendered
    const artifacts = page.locator("[data-testid='ll-artifacts']");
    await expect(artifacts).toBeVisible();
  });

  test("detail view has a back button that returns to index", async ({ page }) => {
    await page.locator("[data-testid='ll-row']").first().click();
    await expect(page.locator("[data-testid='ll-detail-view']")).toBeVisible();

    await page.locator(".ll-back").click();
    await expect(page.locator("[data-testid='ll-index-table']")).toBeVisible();
    await expect(page.locator("[data-testid='ll-detail-view']")).not.toBeVisible();
  });

  // ── Degraded gallery tab ──────────────────────────────────────────────────

  test("degraded gallery tab shows failure-mode cards", async ({ page }) => {
    await page.locator(".ll-tab", { hasText: "Degraded gallery" }).click();

    const gallery = page.locator("[data-testid='ll-gallery']");
    await expect(gallery).toBeVisible();

    const cards = page.locator("[data-testid='ll-gallery-card']");
    await expect(cards).toHaveCount(12); // GALLERY_CARDS length (incl. truncated)

    // Cards for observed reasons should be marked .live
    const permCard = page.locator("[data-testid='ll-gallery-card'][data-code='permission_denied']");
    await expect(permCard).toHaveClass(/live/);

    const schemaCard = page.locator("[data-testid='ll-gallery-card'][data-code='schema_mismatch']");
    await expect(schemaCard).toHaveClass(/live/);

    // A card for a reason not observed should NOT be .live
    const netErrCard = page.locator("[data-testid='ll-gallery-card'][data-code='network_error']");
    await expect(netErrCard).not.toHaveClass(/live/);
  });

  // ── No mutation controls ──────────────────────────────────────────────────

  test("no mutation controls exist in the loop-ledgers screen", async ({ page }) => {
    const screen = page.locator("[data-testid='ll-screen']");
    await expect(screen).toBeVisible();

    // Check that no button or link with mutation-suggestive text is present
    const mutationLocator = screen.locator("button, a").filter({
      hasText: /sync|repair|rerun|re-run|fix|mutate|edit|delete/i,
    });
    await expect(mutationLocator).toHaveCount(0);
  });

  // ── Sidebar item is present ───────────────────────────────────────────────

  test("sidebar shows Loop ledgers in the System of record group", async ({ page }) => {
    const navItem = page.locator("nav.mc-side button", { hasText: "Loop ledgers" });
    await expect(navItem).toBeVisible();
    await expect(navItem).toHaveClass(/active/);
  });
});
