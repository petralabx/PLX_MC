// Fleet P8b: GET /api/cursor/agent-reports reads agent.report events with the
// same key auth as /api/cursor/tasks. Newest first, filters agentSlug and
// loopId, limit (default 20, at most 100) and a seq cursor for the next page.
// Only sp_mcp_portal holds agent_report.read. The fake mc_events table below
// runs the appendEvent and listAgentReports SQL shapes.

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
  sql: [] as string[],
}));

vi.mock("@/lib/db", () => ({
  query: async (text: string, params: unknown[] = []) => {
    h.sql.push(text);
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
      if (dedupKey && h.rows.some((row) => row.dedup_key === dedupKey)) return [];
      const seq = String(h.rows.length + 1);
      h.rows.push({
        seq,
        ts: new Date(Date.UTC(2026, 8, 30, 12, 0, h.rows.length)),
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
    if (text.includes("FROM mc_events") && text.includes("'agent.report'")) {
      // listAgentReports: $1 agentSlug, $2 loopId, $3 before seq, $4 limit.
      const [agentSlug, loopId, beforeSeq, limit] = params as [
        string | null,
        string | null,
        string | null,
        number,
      ];
      return h.rows
        .filter(
          (row) =>
            row.kind === "agent.report" &&
            (agentSlug === null || row.payload.agentSlug === agentSlug) &&
            (loopId === null || row.payload.loopId === loopId) &&
            (beforeSeq === null || Number(row.seq) < Number(beforeSeq))
        )
        .sort((a, b) => Number(b.seq) - Number(a.seq))
        .slice(0, limit)
        .map(({ seq, ts, payload }) => ({ seq, ts, payload }));
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

import { POST as reportPost } from "@/app/api/cursor/agent-report/route";
import { GET } from "@/app/api/cursor/agent-reports/route";
import { MCP_AGENT_SERVICE_PRINCIPAL_IDS } from "@/lib/permissions";

const ctx = { params: Promise.resolve({}) };
const PORTAL = "sp_mcp_portal";

const KEYS: Record<string, string> = Object.fromEntries(
  MCP_AGENT_SERVICE_PRINCIPAL_IDS.map((id) => [id, `${id}-key`])
);

function headers(key: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-api-key": key,
    "x-mc-operator-email": "vince@petrasoap.com",
    "x-mc-repo": "petralabx/PLX_MC",
    "x-mc-runtime": "portal-cos",
  };
}

type Report = {
  id: string;
  agentSlug: string;
  loopId: string;
  runId: string;
  title: string;
  markdown: string;
  createdAt: string;
};

type Page = { reports: Report[]; nextCursor: string | null; hasMore: boolean };

async function read(query = "", key = `${PORTAL}-key`) {
  const resp = await GET(
    new Request(`http://test/api/cursor/agent-reports${query}`, { headers: headers(key) }),
    ctx
  );
  const json = (await resp.json()) as { data?: Page; error?: { code: string; message: string } };
  return { status: resp.status, json };
}

function seed(agentSlug: string, loopId: string, runId: string): void {
  h.rows.push({
    seq: String(h.rows.length + 1),
    ts: new Date(Date.UTC(2026, 8, 30, 12, 0, h.rows.length)),
    kind: "agent.report",
    actor: "agent-runner",
    repo: "petralabx/agent-runner",
    task_id: null,
    pr: null,
    payload: {
      agentSlug,
      loopId,
      runId,
      title: `Report ${runId}`,
      markdown: `# ${runId}`,
      operator: "vince@petrasoap.com",
      servicePrincipalId: "sp_mcp_agent_runner",
    },
    dedup_key: `report:${agentSlug}:${runId}`,
  });
}

function seedOther(kind: string): void {
  h.rows.push({
    seq: String(h.rows.length + 1),
    ts: new Date(Date.UTC(2026, 8, 30, 12, 0, h.rows.length)),
    kind,
    actor: "cursor",
    repo: null,
    task_id: null,
    pr: null,
    payload: { agentSlug: "hasitha-fernando", loopId: "daily-digest" },
    dedup_key: null,
  });
}

beforeEach(() => {
  vi.stubEnv("PLX_MC_MCP_ENABLED", "1");
  vi.stubEnv("PLX_MC_MCP_API_KEY", "");
  vi.stubEnv("PLX_MC_MCP_AGENT_KEYS", JSON.stringify(KEYS));
  vi.stubEnv("PLX_MC_ALLOWED_USERS", "vince@petrasoap.com");
  h.rows.length = 0;
  h.sql.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/cursor/agent-reports", () => {
  it("returns a report written through POST /api/cursor/agent-report", async () => {
    const write = await reportPost(
      new Request("http://test/api/cursor/agent-report", {
        method: "POST",
        headers: headers("sp_mcp_agent_runner-key"),
        body: JSON.stringify({
          agentSlug: "hasitha-fernando",
          loopId: "daily-digest",
          runId: "run-0001",
          title: "Daily digest",
          markdown: "# Digest\n\nThree tasks moved to review.",
        }),
      }),
      ctx
    );
    expect(write.status).toBe(200);

    const { status, json } = await read();
    expect(status).toBe(200);
    expect(json.data).toEqual({
      reports: [
        {
          id: "1",
          agentSlug: "hasitha-fernando",
          loopId: "daily-digest",
          runId: "run-0001",
          title: "Daily digest",
          markdown: "# Digest\n\nThree tasks moved to review.",
          createdAt: "2026-09-30T12:00:00.000Z",
        },
      ],
      nextCursor: null,
      hasMore: false,
    });
  });

  it("returns only agent.report events, newest first", async () => {
    seed("hasitha-fernando", "daily-digest", "run-1");
    seedOther("mcp.tool.invoked");
    seed("chief-of-staff", "cos-brief", "run-2");
    seedOther("session.telemetry");
    seed("hasitha-fernando", "daily-digest", "run-3");

    const { status, json } = await read();
    expect(status).toBe(200);
    expect(json.data?.reports.map((r) => [r.id, r.runId])).toEqual([
      ["5", "run-3"],
      ["3", "run-2"],
      ["1", "run-1"],
    ]);
    expect(json.data?.hasMore).toBe(false);
    expect(json.data?.nextCursor).toBeNull();
  });

  it("filters by agentSlug and by loopId", async () => {
    seed("hasitha-fernando", "daily-digest", "run-1");
    seed("chief-of-staff", "cos-brief", "run-2");
    seed("hasitha-fernando", "weekly-review", "run-3");
    seed("chief-of-staff", "cos-brief", "run-4");

    const bySlug = await read("?agentSlug=hasitha-fernando");
    expect(bySlug.json.data?.reports.map((r) => r.runId)).toEqual(["run-3", "run-1"]);

    const byLoop = await read("?loopId=cos-brief");
    expect(byLoop.json.data?.reports.map((r) => r.runId)).toEqual(["run-4", "run-2"]);

    const both = await read("?agentSlug=hasitha-fernando&loopId=weekly-review");
    expect(both.json.data?.reports.map((r) => r.runId)).toEqual(["run-3"]);

    const none = await read("?agentSlug=nobody");
    expect(none.json.data).toEqual({ reports: [], nextCursor: null, hasMore: false });
  });

  it("returns 20 rows by default and says more rows exist", async () => {
    for (let i = 1; i <= 25; i += 1) seed("hasitha-fernando", "daily-digest", `run-${i}`);
    const { json } = await read();
    expect(json.data?.reports).toHaveLength(20);
    expect(json.data?.reports[0].runId).toBe("run-25");
    expect(json.data?.hasMore).toBe(true);
    expect(json.data?.nextCursor).toBe("6");
  });

  it("pages past the first page with the cursor until no more rows exist", async () => {
    for (let i = 1; i <= 25; i += 1) seed("hasitha-fernando", "daily-digest", `run-${i}`);
    const seen: string[] = [];
    const pages: { size: number; hasMore: boolean }[] = [];
    let cursor: string | null = null;
    do {
      const query: string = `?limit=10${cursor ? `&cursor=${cursor}` : ""}`;
      const { status, json } = await read(query);
      expect(status).toBe(200);
      const page = json.data as Page;
      seen.push(...page.reports.map((r) => r.runId));
      pages.push({ size: page.reports.length, hasMore: page.hasMore });
      cursor = page.nextCursor;
      if (!page.hasMore) expect(cursor).toBeNull();
    } while (cursor);
    expect(pages).toEqual([
      { size: 10, hasMore: true },
      { size: 10, hasMore: true },
      { size: 5, hasMore: false },
    ]);
    expect(seen).toEqual(Array.from({ length: 25 }, (_, i) => `run-${25 - i}`));
  });

  it("keeps the filter across pages", async () => {
    for (let i = 1; i <= 6; i += 1) {
      seed("hasitha-fernando", "daily-digest", `h-${i}`);
      seed("chief-of-staff", "cos-brief", `c-${i}`);
    }
    const first = await read("?agentSlug=chief-of-staff&limit=4");
    expect(first.json.data?.reports.map((r) => r.runId)).toEqual(["c-6", "c-5", "c-4", "c-3"]);
    expect(first.json.data?.hasMore).toBe(true);
    const second = await read(
      `?agentSlug=chief-of-staff&limit=4&cursor=${first.json.data?.nextCursor}`
    );
    expect(second.json.data?.reports.map((r) => r.runId)).toEqual(["c-2", "c-1"]);
    expect(second.json.data?.hasMore).toBe(false);
  });

  it("says no more rows exist when the last page is exactly full", async () => {
    for (let i = 1; i <= 4; i += 1) seed("hasitha-fernando", "daily-digest", `run-${i}`);
    const { json } = await read("?limit=4");
    expect(json.data?.reports).toHaveLength(4);
    expect(json.data?.hasMore).toBe(false);
    expect(json.data?.nextCursor).toBeNull();
  });

  it("accepts limit 100", async () => {
    for (let i = 1; i <= 101; i += 1) seed("hasitha-fernando", "daily-digest", `run-${i}`);
    const { status, json } = await read("?limit=100");
    expect(status).toBe(200);
    expect(json.data?.reports).toHaveLength(100);
    expect(json.data?.hasMore).toBe(true);
  });

  const malformed = [
    "?limit=0",
    "?limit=101",
    "?limit=-1",
    "?limit=2.5",
    "?limit=abc",
    "?limit=",
    "?cursor=abc",
    "?cursor=0",
    "?cursor=-5",
    "?cursor=1.5",
    "?cursor=",
    "?agentSlug=",
    "?agentSlug=Agent:X",
    "?agentSlug=has%20space",
    "?loopId=",
    "?loopId=a:b",
    `?loopId=${"x".repeat(121)}`,
    "?agentSlug=a&agentSlug=b",
  ];

  for (const query of malformed) {
    it(`gives 400 for ${query}`, async () => {
      seed("hasitha-fernando", "daily-digest", "run-1");
      const before = h.sql.length;
      const { status, json } = await read(query);
      expect(status).toBe(400);
      expect(json.data).toBeUndefined();
      expect(json.error?.code).toBe("invalid_request");
      // The route does not query mc_events for a malformed call.
      expect(h.sql.slice(before).some((sql) => sql.includes("'agent.report'"))).toBe(false);
    });
  }

  it("gives 401 with no key or a wrong key", async () => {
    seed("hasitha-fernando", "daily-digest", "run-1");
    const noKey = await GET(new Request("http://test/api/cursor/agent-reports"), ctx);
    expect(noKey.status).toBe(401);
    const wrong = await read("", "wrong-key");
    expect(wrong.status).toBe(401);
    expect(wrong.json.data).toBeUndefined();
  });

  it("gives 403 to every MCP principal except sp_mcp_portal", async () => {
    seed("hasitha-fernando", "daily-digest", "run-1");
    const others = MCP_AGENT_SERVICE_PRINCIPAL_IDS.filter((id) => id !== PORTAL);
    expect(others).toHaveLength(7);
    for (const principalId of others) {
      const { status, json } = await read("", `${principalId}-key`);
      expect({ principalId, status, code: json.error?.code }).toEqual({
        principalId,
        status: 403,
        code: "forbidden",
      });
      expect(json.data).toBeUndefined();
    }
  });
});
