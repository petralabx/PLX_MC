import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import type { GoalsPage } from "../src/lib/reporting/goals";
import { waitForHydration } from "./helpers";
import { SHIPMENT_LINES, goalsPage, gotoGoals, mockGoalsApi } from "./helpers/goals";

// What shipped (TASK-3144) on Goals & Production, against the 2026-10-14
// fixture with M1–M7 entered: an invoice opens, by mouse or keyboard, to its Sage
// lines (items and charges) and says whether they add up to it; the three that
// don't are marked on their rows and show both figures; the search finds item
// codes and descriptions; the lines are fetched once, apart from the page; while
// the login can't read them, an opened invoice says what it lacks; a failed fetch
// says so and Retry recovers. Axe-clean in light and dark. No sideways page
// scrolling at desktop, tablet and phone widths with invoices open is checked by
// e2e/ui-goals-responsive.spec.ts.

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const section = (page: Page) => page.getByTestId("goals-shipments");
const list = (page: Page) => section(page).getByRole("region", { name: "Shipment list" });
const toggle = (page: Page, invoice: string) => list(page).getByRole("button", { name: `Lines of invoice ${invoice}` });
const opened = (page: Page, invoice: string) => list(page).locator(`#goals-lines-sage-${invoice}`);
const cells = (page: Page, invoice: string, row: number) => opened(page, invoice).locator("tbody tr").nth(row).locator("th, td");

const WAITING: GoalsPage = goalsPage({}, undefined, undefined, {
  access: "missing",
  missing: ["sage.oe_invoice_header.invuniq", "sage.oe_invoice_detail.invuniq", "sage.oe_invoice_detail.extinvmisc"],
  lines: 0,
});

test.describe("goals shipment lines", () => {
  test("an invoice opens to its items and charges, which add up to it, and the keyboard closes and opens it", async ({ page }) => {
    const api = await mockGoalsApi(page);
    await gotoGoals(page);
    const button = toggle(page, "IN1000180398");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(button).toHaveAttribute("aria-controls", "goals-lines-sage-IN1000180398");
    const lines = opened(page, "IN1000180398");
    await expect(lines.getByRole("table", { name: "Lines of invoice IN1000180398, in USD" })).toBeVisible();
    // Fetched when the list mounted (twice under React's development Strict Mode, which mounts it twice).
    const fetched = api.linesFetched();
    expect(fetched).toBeGreaterThanOrEqual(1);
    await expect(lines.locator("tbody tr")).toHaveCount(4);
    await expect(cells(page, "IN1000180398", 0)).toHaveText(["Item", "FP-2006", "Bar soap 100 g", "400", "CSE", "39.26", "15,704.00", "12.50"]);
    await expect(cells(page, "IN1000180398", 3)).toHaveText(["Charge", "FRT", "Freight", "", "", "", "1,250.00", ""]);
    await expect(lines).toContainText(
      "These lines add up to the invoice: item lines less their discounts come to its product value, 31,394.40 USD, and charges to its other charges, 1,250.00 USD."
    );

    await button.focus();
    await page.keyboard.press("Enter");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(lines).toHaveCount(0);
    await page.keyboard.press("Space");
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(opened(page, "IN1000180398").locator("tbody tr")).toHaveCount(4);

    // A second invoice with a fuel surcharge, and a search: opening, closing and searching fetch nothing more.
    await toggle(page, "IN1000180379").click();
    await expect(cells(page, "IN1000180379", 3)).toHaveText(["Charge", "FUEL", "Fuel surcharge", "", "", "", "41.95", ""]);
    await section(page).getByLabel("Search shipments").fill("bar soap");
    await expect(section(page).getByText("Showing 13 of 72 shipments")).toBeVisible();
    await section(page).getByLabel("Search shipments").fill("");
    expect(api.linesFetched()).toBe(fetched);
    // Shipments entered by hand have no lines to open.
    const m003 = list(page).locator("tbody tr.hand", { hasText: "PO0104001" });
    await expect(m003.getByRole("button")).toHaveCount(0);
  });

  test("the invoices whose lines don't add up are marked, and opened they show both figures", async ({ page }) => {
    await mockGoalsApi(page);
    await gotoGoals(page);
    await expect(section(page).getByTestId("goals-lines-note")).toHaveText(
      "3 invoices’ lines don’t add up to the invoice. They’re marked “Lines don’t add up”; open one to see both figures."
    );
    const marked = list(page).locator("tbody tr").filter({ has: page.locator(".pv-chip.hot") });
    // The mark sits under the invoice's number, in its row header.
    await expect(marked.locator("th[scope='row']")).toHaveText([
      "IN1000180353 Lines don’t add up",
      "IN1000180370 Lines don’t add up",
      "IN1000180368 Lines don’t add up",
    ]);

    await toggle(page, "IN1000180368").click();
    const short = opened(page, "IN1000180368");
    await expect(short.getByRole("note")).toContainText("These lines don’t add up to the invoice.");
    await expect(short).toContainText("Item lines less their discounts come to 4,442.40 CAD; the invoice’s product value is 7,164.80 CAD.");
    await toggle(page, "IN1000180370").click();
    await expect(opened(page, "IN1000180370")).toContainText("Charges come to 18.35 CAD; the invoice’s other charges are 19.35 CAD.");
    await toggle(page, "IN1000180353").click();
    await expect(opened(page, "IN1000180353")).toContainText("Sage has no lines for this invoice.");
    await expect(opened(page, "IN1000180353")).toContainText("the invoice’s product value is 16,588.00 CAD.");
  });

  test("the search finds item codes and descriptions in the lines", async ({ page }) => {
    await mockGoalsApi(page);
    await gotoGoals(page);
    const search = section(page).getByLabel("Search shipments");
    const invoices = list(page).locator("tbody th[scope='row']");
    await search.fill("desert breeze");
    await expect(invoices).toHaveText(["IN1000180349", "IN1000180391"]);
    await expect(section(page).getByText("Showing 2 of 72 shipments")).toBeVisible();
    await search.fill("tp-dbs-1l");
    await expect(invoices).toHaveText(["IN1000180349", "IN1000180391"]);
    await search.fill("fuel surcharge");
    await expect(invoices).toHaveText(["IN1000180379", "IN1000180418"]);
    await section(page).getByRole("button", { name: /^USD/ }).click();
    await expect(invoices).toHaveText(["IN1000180418"]);
  });

  test("while the login can't read the lines, an opened invoice says what it lacks, and none are fetched", async ({ page }) => {
    const api = await mockGoalsApi(page, WAITING);
    await gotoGoals(page);
    await expect(section(page).getByTestId("goals-lines-note")).toHaveText(
      "Item details are waiting for read access to Sage invoice lines. Open an invoice to see what the reporting login can’t read yet."
    );
    await toggle(page, "IN1000180398").click();
    const waiting = opened(page, "IN1000180398");
    await expect(waiting).toContainText("Item details are waiting for read access to Sage invoice lines.");
    await expect(waiting).toContainText("sage.oe_invoice_header: invuniq");
    await expect(waiting).toContainText("sage.oe_invoice_detail: invuniq, extinvmisc");
    await expect(waiting).toContainText("readonly-grants-shipment-lines.sql");
    expect(api.linesFetched()).toBe(0);
    // Everything else is there.
    await expect(list(page).locator("tbody tr:not(.gp-lines-row)")).toHaveCount(72);
    await expect(page.getByTestId("goals-card-revenue")).toContainText("$408,628 of $1,000,000");
  });

  test("a failed fetch says so in place, and Retry loads the lines", async ({ page }) => {
    await mockGoalsApi(page, goalsPage(), { status: 500, code: "internal", message: "Internal error." });
    await gotoGoals(page);
    const note = section(page).getByTestId("goals-lines-note");
    await expect(note).toContainText("Couldn’t load the invoice lines: Internal error.");
    await toggle(page, "IN1000180398").click();
    await expect(opened(page, "IN1000180398")).toContainText("Couldn’t load the invoice lines: Internal error.");
    // The newest route wins: the next fetch succeeds.
    await page.route("**/api/reporting/goals/runs/*/shipment-lines", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { access: "read", missing: [], lines: SHIPMENT_LINES } }) })
    );
    await note.getByRole("button", { name: "Retry" }).click();
    await expect(opened(page, "IN1000180398").locator("tbody tr")).toHaveCount(4);
    await expect(note).toContainText("3 invoices’ lines don’t add up to the invoice.");
  });

  for (const mode of ["light", "dark"] as const) {
    test(`has no axe violations in ${mode} mode, with invoices open and while waiting`, async ({ page }) => {
      const scan = async () => {
        if (mode === "dark") await page.locator(".mc").first().evaluate((el) => el.classList.add("dark"));
        const results = await new AxeBuilder({ page }).include('[data-testid="goals-shipments"]').withTags(TAGS).analyze();
        expect(results.violations).toEqual([]);
      };
      await mockGoalsApi(page);
      await gotoGoals(page);
      for (const invoice of ["IN1000180398", "IN1000180368", "IN1000180353", "IN1000180417"]) await toggle(page, invoice).click();
      await expect(list(page).locator("tr.gp-lines-row")).toHaveCount(4);
      await scan();

      await page.unrouteAll({ behavior: "ignoreErrors" });
      await mockGoalsApi(page, WAITING);
      await page.reload();
      await waitForHydration(page);
      await toggle(page, "IN1000180398").click();
      await expect(opened(page, "IN1000180398")).toContainText("Item details are waiting");
      await scan();
    });
  }
});
