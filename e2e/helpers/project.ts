import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

import { openSidebar, waitForHydration } from "../helpers";

// The project detail screen has no dedicated URL — reach it via its entry in
// the sidebar "Projects" group (chrome.tsx), the same pattern gotoBoard uses.
// PRJ-PORTAL-GOLIVE is the sole deterministic in-memory fixture project
// (src/lib/mc-data/data.ts), so its name is a stable navigation anchor.
export const FIXTURE_PROJECT_NAME = "PLX Portal Go-Live";

export async function gotoProject(page: Page): Promise<void> {
  await page.goto("/");
  await waitForHydration(page);
  await openSidebar(page, FIXTURE_PROJECT_NAME);
  await expect(page.locator("[data-testid='project-screen']")).toBeVisible();
}
