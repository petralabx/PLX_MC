import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Playwright web server lifecycle", () => {
  it("routes canonical E2E gates through the bounded server owner", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    const preflight = readFileSync("scripts/preflight.sh", "utf8");

    expect(packageJson.scripts["test:e2e"]).toBe("node scripts/run-playwright.mjs");
    expect(preflight).toContain("npm run test:e2e");
    expect(preflight).not.toContain("npx playwright test");
  });
});
