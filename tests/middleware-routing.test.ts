// P6 — middleware matcher carve-out for /api/routing/propose must be exact.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("middleware routing propose carve-out", () => {
  const source = readFileSync(resolve(process.cwd(), "src/middleware.ts"), "utf8");

  it("exempts api/routing/propose exactly", () => {
    expect(source).toMatch(/api\/routing\/propose/);
    expect(source).toMatch(
      /api\/compliance\/webhook\|api\/compliance\/verify\|api\/routing\/propose\|api\/cursor/
    );
  });

  it("does not broadly exempt api/routing", () => {
    expect(source).not.toMatch(/api\/routing[^/]/);
    expect(source).toMatch(/do not broaden to `\/api\/routing\/\*`/);
  });

  it("keeps compliance checkout/complete behind the session gate", () => {
    expect(source).not.toMatch(/api\/compliance\/checkout/);
    expect(source).not.toMatch(/api\/compliance\/complete/);
  });
});
