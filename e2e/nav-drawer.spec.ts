import { expect, test } from "@playwright/test";

import { waitForHydration } from "./helpers";

// Wave 6 — colleague UX: at <=1024px the sidebar is a slide-in drawer behind a
// topbar hamburger (docs/design-system/RESPONSIVE.md §3 drawer protocol), not
// a horizontal strip. Like ui-project-responsive.spec.ts this walks the
// configured tablet/phone widths itself, so it runs in the default project.
const TOUCH_VIEWPORTS = [
  { name: "tablet", width: 820, height: 1180 },
  { name: "mobile", width: 393, height: 851 },
] as const;

test.describe("nav drawer (tablet / phone)", () => {
  for (const vp of TOUCH_VIEWPORTS) {
    test(`hamburger opens a keyboard-operable drawer at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/");
      await waitForHydration(page);

      const hamburger = page.getByTestId("nav-drawer-toggle");
      const drawer = page.locator("nav.mc-side");
      await expect(hamburger).toBeVisible();
      await expect(drawer).toBeHidden();

      // Open: focus moves into the drawer and the page behind stops scrolling.
      await hamburger.click();
      await expect(hamburger).toHaveAttribute("aria-expanded", "true");
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole("button", { name: "Close navigation" })).toBeFocused();
      await expect(page.locator("body")).toHaveClass(/mc-sb-open/);
      const box = await drawer.boundingBox();
      expect(box, "drawer box").not.toBeNull();
      expect(box!.width).toBeLessThanOrEqual(Math.min(280, vp.width * 0.85) + 1);
      const item = await drawer.getByRole("link", { name: "Board" }).boundingBox();
      expect(item!.height, "nav item touch target").toBeGreaterThanOrEqual(44);

      // Esc closes and hands focus back to the hamburger.
      await page.keyboard.press("Escape");
      await expect(hamburger).toHaveAttribute("aria-expanded", "false");
      await expect(hamburger).toBeFocused();
      await expect(drawer).toBeHidden();
      await expect(page.locator("body")).not.toHaveClass(/mc-sb-open/);

      // A backdrop tap closes (tap beside the drawer, not on it).
      await hamburger.click();
      await page
        .getByTestId("nav-drawer-scrim")
        .click({ position: { x: vp.width - 10, y: Math.round(vp.height / 2) } });
      await expect(hamburger).toHaveAttribute("aria-expanded", "false");

      // The close button closes.
      await hamburger.click();
      await drawer.getByRole("button", { name: "Close navigation" }).click();
      await expect(hamburger).toHaveAttribute("aria-expanded", "false");

      // Any nav item navigates and closes.
      await hamburger.click();
      await drawer.getByRole("link", { name: "Board" }).click();
      await expect(page.locator("[data-testid='board-screen']")).toBeVisible();
      await expect(hamburger).toHaveAttribute("aria-expanded", "false");
      await expect(drawer).toBeHidden();
    });
  }

  test("desktop keeps the fixed sidebar and no hamburger", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    await waitForHydration(page);
    await expect(page.getByTestId("nav-drawer-toggle")).toBeHidden();
    await expect(page.locator("nav.mc-side")).toBeVisible();
    await expect(page.getByTestId("nav-drawer-scrim")).toHaveCount(0);
  });
});
