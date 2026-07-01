import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

const OVERFLOW_TOLERANCE_PX = 2;

export async function expectSurfaceNoHorizontalOverflow(
  page: Page,
  testId: string,
  label: string
): Promise<void> {
  const overflow = await page.evaluate((id) => {
    const el = document.querySelector<HTMLElement>(`[data-testid='${id}']`);
    if (!el) return { scrollWidth: 0, clientWidth: 1 };
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  }, testId);
  expect(
    overflow.scrollWidth,
    `${label}: surface overflows — scrollWidth ${overflow.scrollWidth} > clientWidth ${overflow.clientWidth}`
  ).toBeLessThanOrEqual(overflow.clientWidth + OVERFLOW_TOLERANCE_PX);
}

const CATALOG_FIXTURE = {
  meta: {
    sourceRepo: "taylorvalton/plx-cursor-skills",
    version: "1.0.0",
    gitRef: "f5013b3014f024a1828a9d273d93e7bfc8872271",
    pinTag: "v1.0.0",
    packageId: "plx-engineering-core",
    state: "ready",
  },
  skills: [
    {
      id: "create-skill",
      name: "Create Skill",
      description: "Guide for authoring Cursor skills.",
      status: "published",
      tags: ["authoring"],
    },
  ],
};

export async function mockSkillsDirectoryApi(page: Page): Promise<void> {
  await page.route("**/api/skills-directory", (route) => {
    if (route.request().method() !== "GET") {
      return route.fulfill({ status: 405, body: "Method Not Allowed" });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: CATALOG_FIXTURE }),
    });
  });

  await page.route("**/api/skills-directory/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/submissions")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [] }),
      });
    }
    if (url.pathname.match(/\/api\/skills-directory\/[^/]+$/)) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            ok: true,
            skill: CATALOG_FIXTURE.skills[0],
            manifestVersion: "1.0.0",
            toc: [],
            nodes: [{ type: "paragraph", text: [{ type: "text", value: "Skill body." }] }],
          },
        }),
      });
    }
    return route.continue();
  });
}
