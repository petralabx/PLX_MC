// TASK-3913 — POST /api/cursor/ci-scorecard (MCP-authenticated, one stored
// snapshot per window) and GET /api/ci-scorecard (session read, graded). No
// database: the store's process-local fallback stands in for mc_events.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mcp/audit", () => ({ recordMcpToolCall: async () => null }));
vi.mock("@/lib/routing/mutations/actors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/routing/mutations/actors")>()),
  requireSessionActor: vi.fn(async () => ({})),
}));

import { GET } from "@/app/api/ci-scorecard/route";
import { POST } from "@/app/api/cursor/ci-scorecard/route";
import { resetMemorySnapshots } from "@/lib/ci-scorecard/store";
import { MAX_SNAPSHOT_BYTES } from "@/lib/mcp/ci-scorecard-actions";

const ctx = { params: Promise.resolve({}) };

const summary = (p50: number | null, p90: number | null) => ({ n: 10, p50, p90 });

function repo(landingP90: number) {
  return {
    merged: 40,
    open_to_merge_hours: summary(0.8, 6),
    dependabot_open_to_merge_hours: summary(20, 100),
    landing_wait_minutes: summary(5, landingP90),
    landing_wait_minutes_non_dependabot: summary(4, landingP90),
    runs: {
      runs: 400,
      pr_ci_first_attempt: { n: 100, failed: 4 },
      compliance_first_attempt: { n: 100, failed: 6 },
      passed_on_rerun: 2,
    },
    bypass_merges: 0,
    open: { non_draft: 6, auto_merge_armed: 3, green_unmerged: [] },
  };
}

function snapshot(start: string, end: string, landingP90 = 25) {
  return { window: { start, end }, repos: { PLX_MC: repo(landingP90), "agentic-swarm": repo(landingP90) }, errors: [] };
}

function post(body: unknown, key = "test-mcp-key"): Promise<Response> {
  return POST(
    new Request("http://test/api/cursor/ci-scorecard", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "x-mc-operator-email": "vince@petrasoap.com",
        "x-mc-repo": "petralabx/agentic-swarm",
        "x-mc-runtime": "claude-code",
        "x-mc-worker-id": "w1",
      },
      body: JSON.stringify(body),
    }),
    ctx
  );
}

const get = (qs = "") => GET(new Request(`http://test/api/ci-scorecard${qs}`), ctx);

beforeEach(() => {
  vi.stubEnv("PLX_MC_MCP_ENABLED", "1");
  vi.stubEnv("PLX_MC_MCP_API_KEY", "test-mcp-key");
  vi.stubEnv("PLX_MC_ALLOWED_USERS", "vince@petrasoap.com");
  resetMemorySnapshots();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/cursor/ci-scorecard", () => {
  it("stores a week once and grades it; a replay of the same window is a no-op", async () => {
    const body = { snapshot: snapshot("2026-10-19T12:45:00Z", "2026-10-26T12:45:00Z") };
    const first = await post(body);
    expect(first.status).toBe(200);
    const json = (await first.json()) as { data: Record<string, unknown> };
    expect(json.data).toMatchObject({
      recorded: true,
      noop: false,
      windowStart: "2026-10-19T12:45:00Z",
      windowEnd: "2026-10-26T12:45:00Z",
      phase: 1,
      overall: 100,
    });

    const replay = (await (await post(body)).json()) as { data: Record<string, unknown> };
    expect(replay.data).toMatchObject({ recorded: false, noop: true });
    const read = (await (await get()).json()) as { data: { history: unknown[] } };
    expect(read.data.history).toHaveLength(1);
  });

  it("refuses a snapshot that does not match weekly_metrics.py's shape", async () => {
    const resp = await post({ snapshot: { window: { start: "2026-10-19T12:45:00Z" }, repos: {} } });
    expect(resp.status).toBe(400);
    expect(((await resp.json()) as { error: { code: string } }).error.code).toBe("invalid_request");
  });

  it("refuses a snapshot over the size cap", async () => {
    const body = snapshot("2026-10-19T12:45:00Z", "2026-10-26T12:45:00Z");
    const padded = { ...body, errors: Array.from({ length: 20 }, () => "x".repeat(2000)) };
    (padded.repos.PLX_MC as Record<string, unknown>).filler = "y".repeat(MAX_SNAPSHOT_BYTES);
    const resp = await post({ snapshot: padded });
    expect(resp.status).toBe(413);
    expect(((await resp.json()) as { error: { code: string } }).error.code).toBe("payload_too_large");
  });

  it("refuses a caller without the MCP key", async () => {
    const resp = await post({ snapshot: snapshot("2026-10-19T12:45:00Z", "2026-10-26T12:45:00Z") }, "wrong-key");
    expect(resp.status).toBe(401);
  });
});

describe("GET /api/ci-scorecard", () => {
  it("has no latest week before the first snapshot", async () => {
    const resp = await get();
    expect(resp.status).toBe(200);
    expect(((await resp.json()) as { data: unknown }).data).toEqual({ phase: 1, latest: null, history: [] });
  });

  it("returns the newest week's cards and the weekly scores, oldest first", async () => {
    await post({ snapshot: snapshot("2026-10-12T12:45:00Z", "2026-10-19T12:45:00Z", 50) });
    await post({ snapshot: snapshot("2026-10-19T12:45:00Z", "2026-10-26T12:45:00Z", 25) });
    const json = (await (await get()).json()) as {
      data: {
        latest: { windowEnd: string; cards: { id: string; metrics: { id: string; trend: string | null }[] }[] };
        history: { windowEnd: string; overall: number }[];
      };
    };
    expect(json.data.latest.windowEnd).toBe("2026-10-26T12:45:00Z");
    expect(json.data.latest.cards.map((c) => c.id)).toEqual(["PLX_MC", "agentic-swarm", "fleet"]);
    const landing = json.data.latest.cards[0].metrics.find((m) => m.id === "landing-wait-p90");
    expect(landing?.trend).toBe("better");
    expect(json.data.history.map((w) => w.windowEnd)).toEqual(["2026-10-19T12:45:00Z", "2026-10-26T12:45:00Z"]);
    expect(json.data.history[0].overall).toBeLessThan(json.data.history[1].overall);
  });

  it("bounds the history with ?weeks", async () => {
    await post({ snapshot: snapshot("2026-10-12T12:45:00Z", "2026-10-19T12:45:00Z") });
    await post({ snapshot: snapshot("2026-10-19T12:45:00Z", "2026-10-26T12:45:00Z") });
    const json = (await (await get("?weeks=1")).json()) as { data: { history: { windowEnd: string }[] } };
    expect(json.data.history.map((w) => w.windowEnd)).toEqual(["2026-10-26T12:45:00Z"]);
  });

  it.each(["0", "53", "-1", "abc", "1.5"])("rejects weeks=%s with 400", async (v) => {
    const resp = await get(`?weeks=${v}`);
    expect(resp.status).toBe(400);
    expect(((await resp.json()) as { error: { code: string } }).error.code).toBe("invalid_query");
  });
});
