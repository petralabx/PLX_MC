import { expect, test } from "@playwright/test";

import { openSidebar, waitForHydration } from "./helpers";

// MC-SOP-Guide (governance-sops) — full-stack E2E against the REAL API: the dev
// server reads the committed registry + docs/COLLABORATOR-SOP.md, so this
// exercises registry → loader → markdown parser → API → UI end to end. It also
// captures index + detail screenshots to the gitignored .orchestrator evidence
// dir (project-orchestrator handoff artifact).

const EVID = ".orchestrator/governance-sops/evidence";

test.describe("MC-SOP-Guide (governance-sops)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForHydration(page);
    await openSidebar(page, "SOP guide");
    await expect(page.locator("[data-testid='gs-screen']")).toBeVisible();
  });

  test("sidebar item lives in System of record and is active", async ({ page }) => {
    const navItem = page.locator("nav.mc-side button", { hasText: "SOP guide" });
    await expect(navItem).toBeVisible();
    await expect(navItem).toHaveClass(/active/);
  });

  test("index lists the seed catalog; active SOPs are ready", async ({ page }) => {
    const rows = page.locator("[data-testid='gs-row']");
    await expect(rows).toHaveCount(7);

    const collab = page.locator("[data-testid='gs-row'][data-slug='mc-sop-collaborator']");
    await expect(collab).toBeVisible();
    await expect(collab).toHaveAttribute("data-state", "ready");
    await expect(collab).toContainText("Collaborator SOP");
    await expect(collab).toContainText("Active");

    const skills = page.locator("[data-testid='gs-row'][data-slug='mc-sop-skills']");
    await expect(skills).toBeVisible();
    await expect(skills).toHaveAttribute("data-state", "ready");
    await expect(skills).toContainText("Company Skills SOP");
    await expect(skills).toContainText("Active");

    const agentPr = page.locator("[data-testid='gs-row'][data-slug='mc-sop-agent-pr']");
    await expect(agentPr).toBeVisible();
    await expect(agentPr).toHaveAttribute("data-state", "ready");

    // A planned entry renders as a calm "coming soon" row (visible, not hidden).
    const planned = page.locator("[data-testid='gs-row'][data-state='planned']").first();
    await expect(planned).toBeVisible();
    await expect(planned).toContainText("Coming soon");

    await page.screenshot({ path: `${EVID}/index.png`, fullPage: true });
  });

  test("search filters the catalog", async ({ page }) => {
    await page.locator(".gs-search-input").fill("rollback");
    const rows = page.locator("[data-testid='gs-row']");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Rollback");
  });

  test("opens the Collaborator SOP and renders PLX markdown (table + folio)", async ({ page }) => {
    await page.locator("[data-testid='gs-row'][data-slug='mc-sop-collaborator']").click();

    const detail = page.locator("[data-testid='gs-detail-view']");
    await expect(detail).toBeVisible();
    await expect(detail.locator(".gs-doc-title")).toContainText("Collaborator SOP");

    // Folio strip carries the owner in mono.
    await expect(page.locator(".gs-folio")).toContainText("Vince");

    // The reader rendered the SOP markdown — a GFM table is present.
    const reader = page.locator("[data-testid='gs-reader']");
    await expect(reader).toBeVisible();
    await expect(reader.locator("table.gs-table").first()).toBeVisible();
    // …and at least one heading anchored for the TOC.
    await expect(reader.locator("h2.gs-h").first()).toBeVisible();

    await page.screenshot({ path: `${EVID}/detail.png`, fullPage: true });

    // Back returns to the index.
    await page.locator(".gs-back").first().click();
    await expect(page.locator("[data-testid='gs-index-table']")).toBeVisible();
    await expect(detail).not.toBeVisible();
  });

  test("opens the Company Skills SOP and renders bootstrap guidance", async ({ page }) => {
    await page.locator("[data-testid='gs-row'][data-slug='mc-sop-skills']").click();

    const detail = page.locator("[data-testid='gs-detail-view']");
    await expect(detail).toBeVisible();
    await expect(detail.locator(".gs-doc-title")).toContainText("Company Skills SOP");

    const reader = page.locator("[data-testid='gs-reader']");
    await expect(reader).toContainText("plx-cursor-skills");
    await expect(reader.locator("table.gs-table").first()).toBeVisible();
  });

  test("opens the Agent PR SOP and renders checkout guidance", async ({ page }) => {
    await page.locator("[data-testid='gs-row'][data-slug='mc-sop-agent-pr']").click();

    const detail = page.locator("[data-testid='gs-detail-view']");
    await expect(detail).toBeVisible();
    await expect(detail.locator(".gs-doc-title")).toContainText("Agent PR");

    const reader = page.locator("[data-testid='gs-reader']");
    await expect(reader).toContainText("MC-Checkout");
    await expect(reader.locator("table.gs-table").first()).toBeVisible();
  });

  test("a planned SOP opens a calm no-content panel (loud-but-not-error)", async ({ page }) => {
    await page.locator("[data-testid='gs-row'][data-state='planned']").first().click();
    const panel = page.locator("[data-testid='gs-nocontent']");
    await expect(panel).toBeVisible();
    await expect(panel).toHaveClass(/planned/);
    await expect(panel).toContainText("config/governance-sops-registry.json");
  });

  test("read-only lens — no editing affordances", async ({ page }) => {
    const screen = page.locator("[data-testid='gs-screen']");
    await expect(screen.locator("textarea")).toHaveCount(0);
    // The only input on the screen is the catalog search box.
    await expect(screen.locator("input:not(.gs-search-input)")).toHaveCount(0);
    await expect(screen.locator("[contenteditable='true']")).toHaveCount(0);
  });
});
