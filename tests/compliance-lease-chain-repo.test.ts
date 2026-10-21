// TASK-3410: the lease-chain SQL behind bindDispatchHeadPr. The fake query
// records each statement so the test can pin the guard: a recorded head binds to
// a PR only while it has none, the bind is audited in the same statement, and a
// head another PR already holds reports that PR instead of rebinding.

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  calls: [] as { text: string; params: unknown[] }[],
  results: [] as Record<string, unknown>[][],
}));

vi.mock("@/lib/db", () => ({
  withTransaction: async (fn: (q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>) => Promise<unknown>) => fn(async (text, params = []) => {
    h.calls.push({ text, params });
    return h.results.shift() ?? [];
  }),
}));

import { bindDispatchHeadPr } from "@/lib/compliance/repo";

const squash = (sql: string) => sql.replace(/\s+/g, " ");
const input = { dispatchId: "dsp_abc1234", headSha: "a".repeat(40), pr: 3410, recordedBy: "compliance-gate" };

beforeEach(() => {
  h.calls.length = 0;
  h.results = [];
});

describe("bindDispatchHeadPr", () => {
  it("binds an unbound head and audits it in one guarded statement", async () => {
    h.results = [[{ id: input.dispatchId }], [], [{ pr: 3410 }]];
    expect(await bindDispatchHeadPr(input)).toBe(3410);
    expect(h.calls).toHaveLength(3);
    expect(squash(h.calls[0].text)).toContain("FROM mc_dispatch WHERE id = $1 FOR UPDATE");
    expect(squash(h.calls[1].text)).toContain("dispatch_id = $1 AND pr IS NOT NULL AND pr <> $2::integer");
    const sql = squash(h.calls[2].text);
    expect(sql).toContain("UPDATE mc_dispatch_heads SET pr = $3 WHERE dispatch_id = $1 AND head_sha = $2 AND pr IS NULL");
    expect(sql).toContain("'checkout.head_bound'");
    expect(h.calls[2].params).toEqual(["dsp_abc1234", "a".repeat(40), 3410, "compliance-gate"]);
  });

  it("reports the PR that already holds the head instead of rebinding it", async () => {
    h.results = [[{ id: input.dispatchId }], [{ pr: 9999 }]];
    expect(await bindDispatchHeadPr(input)).toBe(9999);
    expect(squash(h.calls[1].text)).toContain("pr IS NOT NULL AND pr <> $2::integer");
    expect(h.calls[1].params).toEqual(["dsp_abc1234", 3410]);
  });

  it("returns null for a head that is not recorded", async () => {
    expect(await bindDispatchHeadPr(input)).toBeNull();
  });
});
