// TASK-632 — GET /api/agent-metrics window validation and passthrough.

import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  loadAgentOutcomes: vi.fn(),
  loadPrincipalOutcomes: vi.fn(),
}));

vi.mock("@/lib/routing/mutations/actors", () => ({ requireSessionActor: vi.fn(async () => ({})) }));
vi.mock("@/lib/routing/outcomes", () => ({
  MAX_WINDOW_DAYS: 90,
  loadAgentOutcomes: m.loadAgentOutcomes,
  loadPrincipalOutcomes: m.loadPrincipalOutcomes,
}));

import { GET } from "@/app/api/agent-metrics/route";

const call = (qs: string) =>
  GET(new Request(`http://x/api/agent-metrics${qs}`), { params: Promise.resolve({}) });

describe("GET /api/agent-metrics", () => {
  beforeEach(() => {
    m.loadAgentOutcomes.mockReset().mockResolvedValue([]);
    m.loadPrincipalOutcomes.mockReset().mockResolvedValue({ principals: [], truncated: false });
  });

  it("is unbounded without windowDays", async () => {
    const res = await call("");
    expect(res.status).toBe(200);
    expect((await res.json()).data.windowDays).toBeNull();
    expect(m.loadAgentOutcomes).toHaveBeenCalledWith({ windowDays: undefined });
  });

  it("passes a valid window to both views", async () => {
    const res = await call("?windowDays=14");
    expect((await res.json()).data.windowDays).toBe(14);
    expect(m.loadPrincipalOutcomes).toHaveBeenCalledWith({ windowDays: 14 });
  });

  it.each(["0", "91", "-1", "abc", "1.5"])("rejects windowDays=%s with 400", async (v) => {
    const res = await call(`?windowDays=${v}`);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_query");
    expect(m.loadAgentOutcomes).not.toHaveBeenCalled();
  });
});
