import { expect, test } from "@playwright/test";

import { PROJECTS } from "../src/lib/mc-data/data";
import { FIXTURE_PROJECT_NAME, gotoProject } from "./helpers/project";

// Mission Control text (TASK-4390): a description written with a little
// markdown shows its structure, and its references are links. The e2e server
// runs DB-less, so the project save is answered here with the saved project.

const PROJECT = PROJECTS.find((p) => p.name === FIXTURE_PROJECT_NAME)!;
const DESC = [
  "**Approved.** Order: core first, then the gated write tools.",
  "",
  "**Next**",
  "",
  "- [x] Hook installed on coding-1",
  "- [ ] Central inbox, TASK-221",
  "",
  "Delivered by petralabx/agentic-swarm#1731.",
  "Second line stays on its own line.",
].join("\n");

test.describe("mc text", () => {
  test("a project description renders its structure, and its references are links", async ({ page }) => {
    await page.route(`**/api/projects/${PROJECT.id}`, async (route) => {
      if (route.request().method() !== "PATCH") return route.fallback();
      const patch = JSON.parse(route.request().postData() ?? "{}") as { desc?: string };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { ...PROJECT, desc: patch.desc } }) });
    });
    await gotoProject(page);
    await page.locator(".mc .ph .tl-link", { hasText: "Edit" }).click();
    await page.getByLabel("Edit project description").fill(DESC);
    await page.locator(".mc .ph .desc-edit-acts .btn", { hasText: "Save" }).click();

    const desc = page.getByTestId("project-desc");
    await expect(desc.locator("p").first().locator("strong")).toHaveText("Approved.");
    await expect(desc.locator("p.mct-h")).toHaveText("Next");
    await expect(desc.locator("li.mct-check")).toHaveCount(2);
    await expect(desc.locator("li.mct-check").first()).toContainText("Done:");
    const pr = desc.getByRole("link", { name: "agentic-swarm#1731" });
    await expect(pr).toHaveAttribute("href", "https://github.com/petralabx/agentic-swarm/pull/1731");
    await expect(pr).toHaveAttribute("target", "_blank");
    // A single line break stays one.
    expect(await desc.locator("p").last().evaluate((el) => (el as HTMLElement).innerText)).toBe(
      "Delivered by agentic-swarm#1731.\nSecond line stays on its own line."
    );

    // A task id is a chip that opens the task inside Mission Control.
    const chip = desc.getByRole("link", { name: "TASK-221" });
    await expect(chip).toHaveAttribute("href", "/?screen=task&taskId=TASK-221");
    await chip.click();
    await expect(page).toHaveURL(/[?&]screen=task&taskId=TASK-221/);
  });
});
