// TASK-633 — mc_report_session_telemetry: MCP-authenticated append-only
// telemetry event with per-session dedup.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  events: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/compliance/repo", () => ({
  // Same dedupKey = no-op, like the mc_events unique index.
  appendEvent: async (e: Record<string, unknown>) => {
    if (e.dedupKey && h.events.some((x) => x.dedupKey === e.dedupKey)) return;
    h.events.push(e);
  },
}));

vi.mock("@/lib/mcp/audit", () => ({
  recordMcpToolCall: async () => null,
}));

import { POST } from "@/app/api/cursor/session-telemetry/route";
import { POST as mcpPost } from "@/app/api/cursor/mcp/route";

const ctx = { params: Promise.resolve({}) };

function req(body: unknown): Request {
  return new Request("http://test/api/cursor/session-telemetry", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": "test-mcp-key",
      "x-mc-operator-email": "vince@petrasoap.com",
      "x-mc-repo": "petralabx/PLX_MC",
      "x-mc-runtime": "claude-code",
      "x-mc-worker-id": "w1",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("PLX_MC_MCP_ENABLED", "1");
  vi.stubEnv("PLX_MC_MCP_API_KEY", "test-mcp-key");
  vi.stubEnv("PLX_MC_ALLOWED_USERS", "vince@petrasoap.com");
  h.events.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/cursor/session-telemetry", () => {
  it("records one deduped telemetry event attributed to the runtime", async () => {
    const resp = await POST(
      req({
        sessionId: "sess-1",
        taskId: "TASK-1",
        checkoutId: "dsp_1",
        model: "claude-fable",
        tokensIn: 120000,
        tokensOut: 8000,
        costCents: 240,
      }),
      ctx
    );
    expect(resp.status).toBe(200);
    expect(h.events).toHaveLength(1);
    expect(h.events[0]).toMatchObject({
      kind: "agent.session_telemetry",
      actor: "claude-code",
      repo: "petralabx/PLX_MC",
      taskId: "TASK-1",
      dedupKey: "telemetry:sess-1",
    });
    expect(h.events[0].payload).toMatchObject({
      tokensIn: 120000,
      tokensOut: 8000,
      costCents: 240,
      operator: "vince@petrasoap.com",
    });
  });

  it("rejects negative or missing token counts", async () => {
    const resp = await POST(req({ sessionId: "s", tokensIn: -1, tokensOut: 0 }), ctx);
    expect(resp.status).toBe(400);
    expect(h.events).toHaveLength(0);
  });

  it("requires MCP auth", async () => {
    const bad = new Request("http://test/api/cursor/session-telemetry", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "wrong" },
      body: JSON.stringify({ sessionId: "s", tokensIn: 1, tokensOut: 1 }),
    });
    const resp = await POST(bad, ctx);
    expect(resp.status).toBe(401);
  });
});

describe("mc_report_session_telemetry over HTTP MCP", () => {
  async function call(args: Record<string, unknown>, id = 1) {
    const res = await mcpPost(
      new Request("http://test/api/cursor/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "x-api-key": "test-mcp-key",
          "x-mc-operator-email": "vince@petrasoap.com",
          "x-mc-repo": "petralabx/PLX_MC",
          "x-mc-runtime": "chatgpt",
          "x-mc-worker-id": "w1",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "mc_report_session_telemetry", arguments: args } }),
      })
    );
    const json = (await res.json()) as { result: { content: { text: string }[]; isError?: boolean } };
    return { isError: json.result.isError === true, text: json.result.content[0].text, body: json.result.isError ? {} : JSON.parse(json.result.content[0].text) };
  }

  it("records the same deduped event as the REST route", async () => {
    const out = await call({ sessionId: "sess-m", taskId: "TASK-9", tokensIn: 10, tokensOut: 5, costCents: 3 });
    expect(out.isError).toBe(false);
    expect(out.body.data).toEqual({ recorded: true, sessionId: "sess-m" });
    await call({ sessionId: "sess-m", tokensIn: 10, tokensOut: 5 }, 2);
    expect(h.events).toHaveLength(1);
    expect(h.events[0]).toMatchObject({
      kind: "agent.session_telemetry",
      actor: "chatgpt",
      taskId: "TASK-9",
      dedupKey: "telemetry:sess-m",
    });
  });

  it("rejects invalid token counts without writing", async () => {
    const out = await call({ sessionId: "s", tokensIn: -1, tokensOut: 0 });
    expect(out.isError).toBe(true);
    expect(h.events).toHaveLength(0);
  });
});
