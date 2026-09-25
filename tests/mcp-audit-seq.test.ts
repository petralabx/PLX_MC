// recordMcpToolCall must return the seq of the event it just appended — not
// the oldest mcp.tool.invoked row (eventsAfter(0, 1) is ascending).
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/compliance/repo", () => ({
  appendEvent: vi.fn(async () => "4242"),
  eventsAfter: vi.fn(async () => [{ seq: "1", kind: "mcp.tool.invoked" }]),
}));

import { recordMcpToolCall } from "@/lib/mcp/audit";
import type { McpIdentity } from "@/lib/mcp/auth";

const identity = {
  operatorEmail: "vince@example.com",
  runtime: "claude-code",
  workerId: "w1",
  repo: "petralabx/PLX_MC",
  servicePrincipalId: "sp_mcp_claude_code",
  actor: { kind: "service", id: "sp_mcp_claude_code", status: "active" },
} as McpIdentity;

describe("recordMcpToolCall", () => {
  it("returns the seq of the event it appended", async () => {
    const seq = await recordMcpToolCall({ tool: "mc_self_check", identity, requestId: "req-1", ok: true, durationMs: 3 });
    expect(seq).toBe("4242");
  });
});
