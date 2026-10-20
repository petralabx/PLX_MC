// TASK-3407: X-MC-Agent names a stable <runtime>/<lane> actor, and every MCP
// audit label carries it when present.
import { describe, expect, it } from "vitest";
import { mcpAuditActor, parseOperatorContext } from "@/lib/mcp/auth";

function req(extra: Record<string, string> = {}) {
  return new Request("http://localhost/api/cursor/mcp", {
    headers: {
      "x-mc-operator-email": "vince@petrasoap.com",
      "x-mc-runtime": "claude-code",
      "x-mc-repo": "petralabx/PLX_MC",
      ...extra,
    },
  });
}

describe("X-MC-Agent (TASK-3407)", () => {
  it("is optional and absent by default", () => {
    process.env.PLX_MC_ALLOWED_USERS = "vince@petrasoap.com";
    expect(parseOperatorContext(req()).agent).toBeUndefined();
  });

  it("is read when it starts with the runtime", () => {
    process.env.PLX_MC_ALLOWED_USERS = "vince@petrasoap.com";
    expect(parseOperatorContext(req({ "x-mc-agent": "claude-code/claude-uat" })).agent).toBe("claude-code/claude-uat");
  });

  it.each(["claude-code", "cursor/cip", "claude-code/has space"])("rejects %j", (value) => {
    process.env.PLX_MC_ALLOWED_USERS = "vince@petrasoap.com";
    expect(() => parseOperatorContext(req({ "x-mc-agent": value }))).toThrow(expect.objectContaining({ code: "invalid_agent" }));
  });

  it("names the lane in the audit actor when present, and keeps the legacy label otherwise", () => {
    expect(mcpAuditActor({ runtime: "claude-code", operatorEmail: "cos@petrasoap.com", agent: "claude-code/claude-uat" }))
      .toBe("claude-code/claude-uat:cos@petrasoap.com");
    expect(mcpAuditActor({ runtime: "claude-code", operatorEmail: "cos@petrasoap.com" })).toBe("claude-code:cos@petrasoap.com");
  });
});
