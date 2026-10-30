// W04: every agent-fixable MC error tells the agent its next step, the same way
// on the MCP tools and on the cursor REST routes. The codes are read from the
// source, so a new ApiError code fails here until it gets a hint, or a reason on
// the no-hint list for codes an agent cannot fix.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/permissions/decision-log", () => ({ recordPermissionDecision: vi.fn(async () => true) }));
vi.mock("@/lib/mcp/audit", () => ({ recordMcpToolCall: vi.fn(async () => "1") }));

import { POST as mcpPost } from "@/app/api/cursor/mcp/route";
import { ApiError } from "@/lib/api/route";
import { ERROR_HINTS, NO_HINT_CODES, errorHint, mcpToolErrorResult } from "@/lib/mcp/envelope";
import { cursorRoute } from "@/lib/mcp/route";

const ROOT = join(__dirname, "..");

/** The files whose refusals reach an agent: src/lib/mcp/ and the compliance service. */
function sourceFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith(".ts")) files.push(path);
    }
  };
  walk(join(ROOT, "src/lib/mcp"));
  files.push(join(ROOT, "src/lib/compliance/service.ts"));
  return files;
}

/** Every code passed to `new ApiError(...)`, including calls split over lines. */
function thrownCodes(): Map<string, string[]> {
  const codes = new Map<string, string[]>();
  for (const file of sourceFiles()) {
    for (const m of readFileSync(file, "utf8").matchAll(/new ApiError\(\s*["'`]([A-Za-z0-9_]+)["'`]/g)) {
      codes.set(m[1], [...(codes.get(m[1]) ?? []), relative(ROOT, file)]);
    }
  }
  return codes;
}

const ACTION_VERBS =
  /^(Ask|Attach|Call|Check|Finish|Fix|Leave|Link|Pass|Post|Raise|Retry|Rewrite|Run|Send|Start|Submit|Upload|Use|Wait)\b/;

describe("error hints cover every thrown code (W04)", () => {
  it("reads the codes from the source", () => {
    const codes = thrownCodes();
    // A broken scan would make the next test pass vacuously.
    expect(codes.size).toBeGreaterThan(40);
    expect(codes.has("invalid_checkout")).toBe(true);
    expect(codes.has("evidence_store_unavailable")).toBe(true); // built by the unavailable() helper
  });

  it("gives every thrown code a hint, or a reason it has none", () => {
    const uncovered = [...thrownCodes()]
      .filter(([code]) => !(code in ERROR_HINTS) && !(code in NO_HINT_CODES))
      .map(([code, files]) => `${code} (${[...new Set(files)].join(", ")})`);
    expect(uncovered).toEqual([]);
  });

  it("never both hints a code and lists it as having no hint", () => {
    expect(Object.keys(ERROR_HINTS).filter((code) => code in NO_HINT_CODES)).toEqual([]);
  });

  it("writes each hint as one sentence that starts with the step", () => {
    for (const [code, hint] of Object.entries(ERROR_HINTS)) {
      expect(hint, code).toMatch(ACTION_VERBS);
      expect(hint.endsWith("."), code).toBe(true);
      expect(hint.slice(0, -1), code).not.toMatch(/[.!?]\s+[A-Z]/);
    }
  });

  it("gives each no-hint code its reason", () => {
    for (const [code, reason] of Object.entries(NO_HINT_CODES)) {
      expect(reason.trim().length, code).toBeGreaterThan(0);
      expect(errorHint(code), code).toBeUndefined();
    }
  });
});

const KEY = "hint-test-key";

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "x-api-key": KEY,
    "x-mc-operator-email": "vince@petrasoap.com",
    "x-mc-repo": "petralabx/PLX_MC",
    ...extra,
  };
}

beforeEach(() => {
  vi.stubEnv("PLX_MC_MCP_ENABLED", "1");
  vi.stubEnv("PLX_MC_MCP_API_KEY", KEY);
  vi.stubEnv("PLX_MC_MCP_AGENT_KEYS", "");
  vi.stubEnv("PLX_MC_MCP_SHARED_KEY_ENABLED", "1");
  vi.stubEnv("PLX_MC_ALLOWED_USERS", "vince@petrasoap.com");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("REST and MCP callers get the same hint (W04)", () => {
  it("adds the hint to a cursor REST error", async () => {
    const handler = cursorRoute("mc_checkout_task", async () => {
      throw new ApiError("checkout_held", "Task TASK-1 already has a live checkout.", 409);
    });
    const res = await handler(new Request("http://localhost/api/cursor/checkout", { method: "POST", headers: headers() }), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: "checkout_held", message: "Task TASK-1 already has a live checkout.", hint: ERROR_HINTS.checkout_held },
    });
  });

  it("adds the same hint to the MCP tool error", () => {
    const result = mcpToolErrorResult(new ApiError("checkout_held", "Task TASK-1 already has a live checkout.", 409));
    expect(JSON.parse(result.content[0].text)).toMatchObject({ error: { hint: ERROR_HINTS.checkout_held } });
  });

  it("adds the hint when the MCP endpoint refuses a request before any tool runs", async () => {
    const res = await mcpPost(
      new Request("http://localhost/api/cursor/mcp", {
        method: "POST",
        headers: headers({ "x-mc-operator-email": "" }),
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      })
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: "missing_operator", message: "X-MC-Operator-Email is required.", hint: ERROR_HINTS.missing_operator },
    });
  });

  it("sends no hint for a code an agent cannot fix", async () => {
    const res = await mcpPost(
      new Request("http://localhost/api/cursor/mcp", {
        method: "POST",
        headers: headers({ "x-api-key": "wrong-key" }),
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      })
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "invalid_api_key", message: "Invalid or missing MCP API key." } });
  });
});
