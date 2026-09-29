// Fleet P8 (D12): POST /api/cursor/agent-report records one agent.report event
// per run. The route is built like session-telemetry. The fake mc_events table
// below runs the real appendEvent / eventsAfter SQL shapes: a keyed replay does
// nothing, and GET /api/events?kind= filters by kind.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type EventRow = {
  seq: string;
  ts: Date;
  kind: string;
  actor: string;
  repo: string | null;
  task_id: string | null;
  pr: string | null;
  payload: Record<string, unknown>;
  dedup_key: string | null;
};

const h = vi.hoisted(() => ({
  rows: [] as EventRow[],
}));

vi.mock("@/lib/db", () => ({
  query: async (text: string, params: unknown[] = []) => {
    if (text.includes("INSERT INTO mc_events")) {
      const [kind, actor, repo, taskId, pr, payload, dedupKey] = params as [
        string,
        string,
        string | null,
        string | null,
        string | null,
        string,
        string | null,
      ];
      // ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING
      if (dedupKey && h.rows.some((row) => row.dedup_key === dedupKey)) return [];
      const seq = String(h.rows.length + 1);
      h.rows.push({
        seq,
        ts: new Date("2026-09-29T12:00:00Z"),
        kind,
        actor,
        repo,
        task_id: taskId,
        pr,
        payload: JSON.parse(payload) as Record<string, unknown>,
        dedup_key: dedupKey,
      });
      return [{ seq }];
    }
    if (text.includes("FROM mc_events") && text.includes("seq > $1")) {
      const [after, limit, kind] = params as [number, number, string | null];
      return h.rows
        .filter((row) => Number(row.seq) > after && (kind === null || row.kind === kind))
        .slice(0, limit);
    }
    throw new Error(`unexpected SQL in test: ${text}`);
  },
}));

vi.mock("@/lib/compliance/go-live-announcer", () => ({
  announceGoLiveEventSafe: async () => undefined,
}));

vi.mock("@/lib/mcp/audit", () => ({
  recordMcpToolCall: async () => null,
}));

vi.mock("@/lib/permissions/decision-log", () => ({
  recordPermissionDecision: vi.fn(async () => true),
}));

import { POST } from "@/app/api/cursor/agent-report/route";
import { GET as eventsGet } from "@/app/api/events/route";

const ctx = { params: Promise.resolve({}) };

const KEYS = {
  sp_mcp_claude_code: "claude-key",
  sp_mcp_agent_runner: "runner-key",
  sp_mcp_portal: "portal-key",
};

function req(body: unknown, key = "runner-key"): Request {
  return new Request("http://test/api/cursor/agent-report", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "x-mc-operator-email": "vince@petrasoap.com",
      "x-mc-repo": "petralabx/agent-runner",
      "x-mc-runtime": "agent-runner",
      "x-mc-worker-id": "w1",
    },
    body: JSON.stringify(body),
  });
}

const REPORT = {
  agentSlug: "hasitha-fernando",
  loopId: "daily-digest",
  runId: "run-0001",
  title: "Daily digest",
  markdown: "# Digest\n\nThree tasks moved to review.",
};

async function reportEvents() {
  const resp = await eventsGet(
    new Request("http://test/api/events?kind=agent.report"),
    ctx
  );
  expect(resp.status).toBe(200);
  const json = (await resp.json()) as {
    data: { events: { kind: string; actor: string; payload: Record<string, unknown> }[] };
  };
  return json.data.events;
}

beforeEach(() => {
  vi.stubEnv("PLX_MC_MCP_ENABLED", "1");
  vi.stubEnv("PLX_MC_MCP_API_KEY", "");
  vi.stubEnv("PLX_MC_MCP_AGENT_KEYS", JSON.stringify(KEYS));
  vi.stubEnv("PLX_MC_ALLOWED_USERS", "vince@petrasoap.com");
  h.rows.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/cursor/agent-report", () => {
  it("records one agent.report event that GET /api/events?kind=agent.report returns", async () => {
    const resp = await POST(req(REPORT), ctx);
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as { data: Record<string, unknown> };
    expect(json.data).toMatchObject({
      recorded: true,
      agentSlug: "hasitha-fernando",
      runId: "run-0001",
    });

    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]).toMatchObject({
      kind: "agent.report",
      actor: "agent-runner",
      repo: "petralabx/agent-runner",
      dedup_key: "report:hasitha-fernando:run-0001",
    });

    const events = await reportEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "agent.report", actor: "agent-runner" });
    expect(events[0].payload).toMatchObject({
      agentSlug: "hasitha-fernando",
      loopId: "daily-digest",
      runId: "run-0001",
      title: "Daily digest",
      markdown: REPORT.markdown,
      operator: "vince@petrasoap.com",
      servicePrincipalId: "sp_mcp_agent_runner",
    });
  });

  it("adds nothing for a repeat runId", async () => {
    expect((await POST(req(REPORT), ctx)).status).toBe(200);
    const repeat = await POST(req({ ...REPORT, title: "Changed title" }), ctx);
    expect(repeat.status).toBe(200);
    const json = (await repeat.json()) as { data: Record<string, unknown> };
    expect(json.data).toMatchObject({ recorded: false });
    expect(h.rows).toHaveLength(1);
    expect(await reportEvents()).toHaveLength(1);
  });

  it("keeps separate events for another run or another agent", async () => {
    await POST(req(REPORT), ctx);
    await POST(req({ ...REPORT, runId: "run-0002" }), ctx);
    await POST(req({ ...REPORT, agentSlug: "chief-of-staff" }), ctx);
    expect(h.rows.map((row) => row.dedup_key)).toEqual([
      "report:hasitha-fernando:run-0001",
      "report:hasitha-fernando:run-0002",
      "report:chief-of-staff:run-0001",
    ]);
  });

  it("gives 401 with no auth", async () => {
    const noKey = new Request("http://test/api/cursor/agent-report", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-mc-operator-email": "vince@petrasoap.com",
        "x-mc-repo": "petralabx/agent-runner",
      },
      body: JSON.stringify(REPORT),
    });
    expect((await POST(noKey, ctx)).status).toBe(401);
    expect((await POST(req(REPORT, "wrong-key"), ctx)).status).toBe(401);
    expect(h.rows).toHaveLength(0);
  });

  it("gives 400 when the markdown is over 32 KB", async () => {
    const resp = await POST(req({ ...REPORT, markdown: "x".repeat(32 * 1024 + 1) }), ctx);
    expect(resp.status).toBe(400);
    expect(h.rows).toHaveLength(0);
  });

  it("counts the 32 KB limit in UTF-8 bytes", async () => {
    // 11,000 three-byte characters = 33,000 bytes, under 32,768 characters.
    const resp = await POST(req({ ...REPORT, markdown: "€".repeat(11_000) }), ctx);
    expect(resp.status).toBe(400);
    expect(h.rows).toHaveLength(0);
  });

  it("accepts markdown of exactly 32 KB", async () => {
    const resp = await POST(req({ ...REPORT, markdown: "x".repeat(32 * 1024) }), ctx);
    expect(resp.status).toBe(200);
    expect(h.rows).toHaveLength(1);
  });

  it("gives 400 for a missing field or a slug that could break the dedup key", async () => {
    const noMarkdown: Partial<typeof REPORT> = { ...REPORT };
    delete noMarkdown.markdown;
    expect((await POST(req(noMarkdown), ctx)).status).toBe(400);
    expect((await POST(req({ ...REPORT, agentSlug: "agent:x" }), ctx)).status).toBe(400);
    expect((await POST(req({ ...REPORT, runId: "a:b" }), ctx)).status).toBe(400);
    expect(h.rows).toHaveLength(0);
  });

  it("refuses sp_mcp_portal, which holds only task create and search", async () => {
    const resp = await POST(req(REPORT, "portal-key"), ctx);
    expect(resp.status).toBe(403);
    expect(h.rows).toHaveLength(0);
  });
});
