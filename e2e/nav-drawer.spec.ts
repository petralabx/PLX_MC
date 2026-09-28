import { expect, test, type Page } from "@playwright/test";

import { waitForHydration } from "./helpers";

// ADR-005 nav forms below 1025px: the tablet keeps a 64px icon rail whose
// toggle expands it into the labelled drawer; the phone has bottom tabs and
// reaches the same drawer (Projects, Initiatives) from More → All screens.
// The drawer protocol is unchanged (docs/design-system/RESPONSIVE.md §3): the
// close button, Esc, a backdrop tap and any nav item dismiss it, focus moves
// in and back, and the page behind stops scrolling. Like
// ui-project-responsive.spec.ts this walks its widths itself, so it runs in the
// default project.
const TABLET = { width: 820, height: 1180 };
const PHONE = { width: 393, height: 851 };

async function expectDrawerProtocol(page: Page, vp: { width: number; height: number }, open: () => Promise<void>, trigger: () => ReturnType<Page["locator"]>) {
  const drawer = page.locator("nav.mc-side");

  // Open: focus moves into the drawer and the page behind stops scrolling.
  await open();
  await expect(drawer).toHaveClass(/\bopen\b/);
  await expect(drawer.getByRole("button", { name: "Close navigation" })).toBeFocused();
  await expect(page.locator("body")).toHaveClass(/mc-lock/);
  const box = await drawer.boundingBox();
  expect(box, "drawer box").not.toBeNull();
  expect(box!.width).toBeLessThanOrEqual(Math.min(320, vp.width * 0.85) + 1);
  const item = await drawer.getByRole("link", { name: "Board" }).boundingBox();
  expect(item!.height, "nav item touch target").toBeGreaterThanOrEqual(44);
  // Projects and initiatives live in the drawer (spec Q2).
  await expect(drawer.getByRole("group", { name: "Initiatives" })).toBeVisible();

  // Esc closes and hands focus back to what opened it.
  await page.keyboard.press("Escape");
  await expect(drawer).not.toHaveClass(/\bopen\b/);
  await expect(trigger()).toBeFocused();
  await expect(page.locator("body")).not.toHaveClass(/mc-lock/);

  // A backdrop tap closes (tap beside the drawer, not on it).
  await open();
  await page
    .getByTestId("nav-drawer-scrim")
    .click({ position: { x: vp.width - 10, y: Math.round(vp.height / 2) } });
  await expect(drawer).not.toHaveClass(/\bopen\b/);

  // The close button closes.
  await open();
  await drawer.getByRole("button", { name: "Close navigation" }).click();
  await expect(drawer).not.toHaveClass(/\bopen\b/);

  // Any nav item navigates and closes.
  await open();
  await drawer.getByRole("link", { name: "List" }).click();
  await expect(page.locator("[data-testid='board-screen'][data-mc-view='list']")).toBeVisible();
  await expect(drawer).not.toHaveClass(/\bopen\b/);
}

test.describe("nav drawer (tablet / phone)", () => {
  test("tablet: the icon rail's toggle opens a keyboard-operable drawer", async ({ page }) => {
    await page.setViewportSize(TABLET);
    await page.goto("/");
    await waitForHydration(page);

    const toggle = page.getByTestId("nav-drawer-toggle");
    const rail = page.locator("nav.mc-side");
    await expect(toggle).toBeVisible();
    await expect(rail).toBeVisible();
    expect((await rail.boundingBox())!.width, "icon rail width").toBeLessThanOrEqual(65);
    await expect(page.locator("nav.mc-tabs")).toBeHidden();

    await expectDrawerProtocol(
      page,
      TABLET,
      async () => {
        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-expanded", "true");
      },
      () => toggle
    );
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("phone: More → All screens opens the same drawer", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto("/");
    await waitForHydration(page);

    const more = page.locator("nav.mc-tabs").getByRole("button", { name: "More" });
    await expect(page.locator("nav.mc-side")).toBeHidden();
    await expect(page.getByTestId("nav-drawer-toggle")).toBeHidden();
    await expect(more).toBeVisible();

    await expectDrawerProtocol(
      page,
      PHONE,
      async () => {
        await more.click();
        await page.getByRole("dialog", { name: "More" }).getByRole("button", { name: /All screens/ }).click();
        await expect(page.getByRole("dialog", { name: "More" })).toHaveCount(0);
      },
      () => more
    );
  });

  test("desktop keeps the fixed sidebar — no rail toggle, no tabs, no scrim", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    await waitForHydration(page);
    await expect(page.getByTestId("nav-drawer-toggle")).toBeHidden();
    await expect(page.locator("nav.mc-side")).toBeVisible();
    await expect(page.locator("nav.mc-tabs")).toBeHidden();
    await expect(page.getByTestId("nav-drawer-scrim")).toHaveCount(0);
  });
});
