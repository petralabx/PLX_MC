import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  MCP_CURSOR_PRINCIPAL_ID,
  resolveMcpClientKey,
} from "../tools/plx-mc-mcp/lib/key-resolution.mjs";

const LAUNCH = path.resolve(__dirname, "../tools/plx-mc-mcp/launch.mjs");

describe("MCP launcher treats a partial hydrated env as missing (TASK-614)", () => {
  it.each(["", "   ", "\t\n", "${MC_MCP_API_KEY}"])(
    "resolves %j to no key",
    (value) => {
      expect(
        resolveMcpClientKey({ MC_MCP_API_KEY: value }, MCP_CURSOR_PRINCIPAL_ID)
      ).toBe("");
    }
  );

  it("does not borrow an empty shared key either", () => {
    expect(
      resolveMcpClientKey(
        { MC_MCP_API_KEY: "", PLX_MC_MCP_API_KEY: "" },
        MCP_CURSOR_PRINCIPAL_ID
      )
    ).toBe("");
  });

  it("exits non-zero instead of starting with an empty key", () => {
    // Hermetic: empty PATH dir means no aws/python can run, so no network call.
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "plx-launch-"));
    try {
      const result = spawnSync(process.execPath, [LAUNCH], {
        env: {
          NODE_ENV: "test",
          PATH: sandbox,
          HOME: sandbox,
          USERPROFILE: sandbox,
          MC_MCP_API_KEY: "",
          PLX_MC_MCP_API_KEY: "",
        },
        encoding: "utf8",
        timeout: 60_000,
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("MCP key unavailable");
    } finally {
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
