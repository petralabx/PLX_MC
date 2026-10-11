import { spawnSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SCRIPT = path.resolve(__dirname, "../tools/plx-mc-mcp/check-imports.mjs");

describe("MCP wrapper lib modules load as ESM and CommonJS (TASK-612)", () => {
  it("exits 0 and reports every lib module", () => {
    const run = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8", timeout: 30_000 });
    expect(run.status, run.stderr).toBe(0);
    for (const name of ["key-resolution", "swarm-client", "tool-errors"]) {
      expect(run.stdout).toContain(`lib/${name}.mjs`);
    }
  });
});
