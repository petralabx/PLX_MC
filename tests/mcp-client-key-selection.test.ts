import { describe, expect, it } from "vitest";

import {
  MCP_CURSOR_PRINCIPAL_ID,
  resolveMcpClientKey,
  resolveMcpPrincipalId,
  selectMcpKeyFromSecret,
} from "../tools/plx-mc-mcp/lib/key-resolution.mjs";

describe("MCP client principal selection", () => {
  it("defaults Cursor runtimes to the shared compatibility principal", () => {
    expect(resolveMcpPrincipalId({ MC_RUNTIME: "cursor" })).toBe(
      MCP_CURSOR_PRINCIPAL_ID
    );
    expect(resolveMcpPrincipalId({ MC_RUNTIME: "cursor-cloud" })).toBe(
      MCP_CURSOR_PRINCIPAL_ID
    );
  });

  it("maps known dedicated runtimes and honors an explicit principal", () => {
    expect(resolveMcpPrincipalId({ MC_RUNTIME: "claude-code" })).toBe(
      "sp_mcp_claude_code"
    );
    expect(resolveMcpPrincipalId({ MC_RUNTIME: "hermes" })).toBe(
      "sp_mcp_claude_code"
    );
    expect(resolveMcpPrincipalId({ MC_RUNTIME: "codex" })).toBe("sp_mcp_codex");
    expect(resolveMcpPrincipalId({ MC_RUNTIME: "swarm" })).toBe("sp_mcp_swarm");
    expect(
      resolveMcpPrincipalId({
        MC_RUNTIME: "local",
        MC_MCP_PRINCIPAL_ID: "sp_mcp_claude_code",
      })
    ).toBe("sp_mcp_claude_code");
  });

  it("rejects principal ids outside the reviewed registry", () => {
    expect(() =>
      resolveMcpPrincipalId({ MC_MCP_PRINCIPAL_ID: "sp_unreviewed" })
    ).toThrow("unsupported_mcp_principal_id");
  });
});

describe("MCP client key resolution", () => {
  it("keeps the shared environment key for Cursor", () => {
    expect(
      resolveMcpClientKey(
        {
          PLX_MC_MCP_API_KEY: "shared-key",
        },
        MCP_CURSOR_PRINCIPAL_ID
      )
    ).toBe("shared-key");
  });

  it("never falls back to the shared key for a dedicated principal", () => {
    expect(
      resolveMcpClientKey(
        {
          PLX_MC_MCP_API_KEY: "shared-key",
        },
        "sp_mcp_claude_code"
      )
    ).toBe("");
  });

  it("accepts an explicit consumer key for any reviewed principal", () => {
    expect(
      resolveMcpClientKey(
        {
          MC_MCP_API_KEY: "dedicated-key",
          PLX_MC_MCP_API_KEY: "shared-key",
        },
        "sp_mcp_claude_code"
      )
    ).toBe("dedicated-key");
  });

  it("selects Cursor only from the compatibility object", () => {
    expect(
      selectMcpKeyFromSecret(
        { PLX_MC_MCP_API_KEY: "shared-key" },
        MCP_CURSOR_PRINCIPAL_ID
      )
    ).toBe("shared-key");
  });

  it("selects dedicated principals only from the registry object", () => {
    expect(
      selectMcpKeyFromSecret(
        {
          sp_mcp_claude_code: "claude-key",
          sp_mcp_codex: "codex-key",
        },
        "sp_mcp_codex"
      )
    ).toBe("codex-key");
    expect(
      selectMcpKeyFromSecret(
        { PLX_MC_MCP_API_KEY: "shared-key" },
        "sp_mcp_codex"
      )
    ).toBe("");
  });
});
