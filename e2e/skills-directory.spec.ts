import { expect, test } from "@playwright/test";

import { openSidebar, waitForHydration } from "./helpers";

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
    {
      id: "wterm-preflight",
      name: "Wterm Preflight",
      description: "Local CI gate before commit/push.",
      status: "published",
      tags: ["ci"],
    },
  ],
};

const DETAIL_FIXTURE = {
  ok: true,
  skill: CATALOG_FIXTURE.skills[0],
  manifestVersion: "1.0.0",
  toc: [{ id: "when-to-use", level: 2, text: "When to use" }],
  nodes: [
    {
      type: "heading",
      level: 1,
      id: "create-skill",
      text: [{ type: "text", value: "Create Skill" }],
    },
    {
      type: "heading",
      level: 2,
      id: "when-to-use",
      text: [{ type: "text", value: "When to use" }],
    },
    {
      type: "paragraph",
      text: [{ type: "text", value: "Use when authoring a new skill." }],
    },
  ],
};

const INSTALL_PLAN_FIXTURE = {
  mode: "install",
  sourceRepo: "taylorvalton/plx-cursor-skills",
  gitRef: "f5013b3014f024a1828a9d273d93e7bfc8872271",
  packageId: "plx-engineering-core",
  catalogVersion: "1.0.0",
  installSkillIds: ["create-skill", "wterm-preflight"],
  missingSkillIds: ["create-skill"],
  staleSkillIds: [],
  drift: { ok: false },
  scripts: {
    bash: "#!/usr/bin/env bash\nset -euo pipefail\ngit -C \"$HOME/plx-cursor-skills\" fetch origin --tags\n",
    powershell: "$ErrorActionPreference = 'Stop'\nGet-FileHash -Algorithm SHA256 .\\SKILL.md\n",
  },
};

const SYNC_CHECK_FIXTURE = {
  mode: "sync",
  sourceRepo: INSTALL_PLAN_FIXTURE.sourceRepo,
  gitRef: INSTALL_PLAN_FIXTURE.gitRef,
  packageId: INSTALL_PLAN_FIXTURE.packageId,
  catalogVersion: INSTALL_PLAN_FIXTURE.catalogVersion,
  installSkillIds: ["create-skill"],
  missingSkillIds: ["create-skill"],
  staleSkillIds: [],
  drift: { ok: false },
};

test.describe("MC Skills Directory", () => {
  test.beforeEach(async ({ page }) => {
    let submissions = [
      {
        id: "skill-sub-1",
        skillId: "create-skill",
        title: "Skill review: create-skill",
        description: "Add stronger examples.",
        submitterEmail: "vince@petrasoap.com",
        status: "pending",
        notes: "# Create Skill",
        createdAt: "2026-07-01T11:00:00.000Z",
        updatedAt: "2026-07-01T11:00:00.000Z",
      },
    ];

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
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname.endsWith("/api/skills-directory/install")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: INSTALL_PLAN_FIXTURE }),
        });
      }
      if (url.pathname.endsWith("/api/skills-directory/sync-check")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: SYNC_CHECK_FIXTURE }),
        });
      }
      if (url.pathname.endsWith("/api/skills-directory/submit")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              id: "skill-sub-new",
              skillId: "new-skill",
              title: "Skill review: new-skill",
              description: "New skill submission.",
              submitterEmail: "vince@petrasoap.com",
              status: "pending",
              notes: "# New Skill",
              createdAt: "2026-07-01T11:05:00.000Z",
              updatedAt: "2026-07-01T11:05:00.000Z",
            },
          }),
        });
      }
      if (url.pathname.endsWith("/api/skills-directory/submissions")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: submissions }),
        });
      }
      if (url.pathname.includes("/api/skills-directory/submissions/")) {
        const id = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
        const patch = JSON.parse(request.postData() ?? "{}") as { status?: string; reviewComment?: string };
        submissions = submissions.map((submission) =>
          submission.id === id
            ? {
                ...submission,
                status: patch.status ?? submission.status,
                reviewComment: patch.reviewComment,
                updatedAt: "2026-07-01T11:10:00.000Z",
              }
            : submission
        );
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: submissions.find((submission) => submission.id === id) }),
        });
      }
      if (request.method() !== "GET") {
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
    await openSidebar(page, "Skills directory");
    await expect(page.locator("[data-testid='sk-screen']")).toBeVisible();
  });

  test("sidebar item lives in System of record and is active", async ({ page }) => {
    const navItem = page.locator("nav.mc-side button", { hasText: "Skills directory" });
    await expect(navItem).toBeVisible();
    await expect(navItem).toHaveClass(/active/);
  });

  test("index lists company skills from fixture catalog", async ({ page }) => {
    const rows = page.locator("[data-testid='sk-row']");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("Create Skill");
    await expect(page.locator(".sk-meta-value").first()).toContainText("plx-cursor-skills");
  });

  test("search filters the catalog", async ({ page }) => {
    await page.locator(".gs-search-input").fill("preflight");
    await expect(page.locator("[data-testid='sk-row']")).toHaveCount(1);
    await expect(page.locator("[data-testid='sk-row']").first()).toContainText("Wterm Preflight");
  });

  test("opens a skill and renders SKILL.md reader", async ({ page }) => {
    await page.locator("[data-testid='sk-row'][data-skill-id='create-skill']").click();
    const detail = page.locator("[data-testid='sk-detail-view']");
    await expect(detail).toBeVisible();
    await expect(detail.locator(".gs-doc-title")).toContainText("Create Skill");
    await expect(page.locator("[data-testid='gs-reader']")).toContainText("When to use");

    await page.locator(".gs-back").first().click();
    await expect(page.locator("[data-testid='sk-index-table']")).toBeVisible();
  });

  test("opens install modal with copyable bash and PowerShell scripts", async ({ page }) => {
    await page.locator("[data-testid='sk-row'][data-skill-id='create-skill']").click();
    await page.locator("[data-testid='sk-install-button']").click();

    await expect(page.getByRole("dialog", { name: "Install company skills" })).toBeVisible();
    await expect(page.locator("[data-testid='sk-bash-script']")).toContainText("git -C");
    await expect(page.locator("[data-testid='sk-powershell-script']")).toContainText("Get-FileHash");

    await page.getByRole("button", { name: "Copy Bash" }).click();
    await expect(page.getByRole("button", { name: "Copied Bash" })).toBeVisible();
  });

  test("submit panel validates required skill id and SKILL.md content", async ({ page }) => {
    const submit = page
      .locator("[data-testid='sk-submit-panel']")
      .getByRole("button", { name: "Submit for review" });
    await expect(submit).toBeDisabled();

    await page.getByLabel("Skill id").fill("new-skill");
    await expect(submit).toBeDisabled();

    await page.getByLabel("Skill submission description").fill("New skill submission.");
    await page.getByLabel("SKILL.md content").fill("# New Skill\n\nUse when adding coverage.");
    await expect(submit).toBeEnabled();

    await submit.click();
    await expect(page.getByText("Submission queued:")).toBeVisible();
    await expect(page.getByText("skill-sub-new")).toBeVisible();
  });

  test("review queue is gated to approvers and can approve submissions", async ({ page }) => {
    await expect(page.locator("[data-testid='sk-review-tab']")).toBeVisible();
    await page.locator("[data-testid='sk-review-tab']").click();

    const row = page.locator("[data-testid='sk-review-row']").first();
    await expect(row).toContainText("Skill review: create-skill");
    await expect(row).toContainText("pending");

    await row.getByRole("button", { name: "Approve" }).click();
    await expect(row).toContainText("approved");
  });
});
