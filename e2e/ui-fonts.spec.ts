import { expect, test } from "@playwright/test";

import { gotoBoard, gotoSkillsDirectory, openSidebar, waitForHydration } from "./helpers";

// Brand font invariant (G1, ui-ux-design-loop): every rendered text node must
// compute to one of the three brand families loaded by app/layout.tsx —
// maziusDisplay (next/font/local), Inter, or JetBrains Mono. Form elements do
// NOT inherit fonts per the UA stylesheet, so any <button>/<input> missing a
// font-family silently renders Arial/Times (regression 2026-07-02: SOP + skill
// row titles); the .mc form-element reset in mc-surface.css guards this, and
// this spec guards the reset.

const BRAND_FAMILIES = ["maziusDisplay", "Inter", "JetBrains Mono"];

async function offBrandFonts(page: import("@playwright/test").Page): Promise<string[]> {
  return page.evaluate((ok) => {
    const bad = new Set<string>();
    for (const el of document.querySelectorAll("body *")) {
      if (!(el instanceof HTMLElement)) continue;
      if (!el.innerText || !el.innerText.trim()) continue;
      const fam = getComputedStyle(el).fontFamily;
      if (ok.some((f) => fam.startsWith(f) || fam.startsWith(`"${f}"`))) continue;
      const cls = typeof el.className === "string" ? el.className : "";
      bad.add(`${fam.slice(0, 40)} @ <${el.tagName.toLowerCase()} class="${cls.slice(0, 50)}">`);
    }
    return [...bad];
  }, BRAND_FAMILIES);
}

test.describe("brand font invariant", () => {
  test("inbox renders only brand fonts", async ({ page }) => {
    await page.goto("/");
    await waitForHydration(page);
    expect(await offBrandFonts(page)).toEqual([]);
  });

  test("board renders only brand fonts", async ({ page }) => {
    await gotoBoard(page);
    expect(await offBrandFonts(page)).toEqual([]);
  });

  test("skills directory renders only brand fonts", async ({ page }) => {
    await gotoSkillsDirectory(page);
    expect(await offBrandFonts(page)).toEqual([]);
  });

  test("SOP guide renders only brand fonts", async ({ page }) => {
    await page.goto("/");
    await waitForHydration(page);
    await openSidebar(page, "SOP guide");
    await expect(page.locator("[data-testid='gs-screen']")).toBeVisible();
    expect(await offBrandFonts(page)).toEqual([]);
  });
});
