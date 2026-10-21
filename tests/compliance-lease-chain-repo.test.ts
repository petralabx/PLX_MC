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
  query: async (text: string, params: unknown[] = []) => {
    h.calls.push({ text, params });
    return h.results.shift() ?? [];
  },
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
    h.results = [[{ pr: 3410 }]];
    expect(await bindDispatchHeadPr(input)).toBe(3410);
    expect(h.calls).toHaveLength(1);
    const sql = squash(h.calls[0].text);
    expect(sql).toContain("UPDATE mc_dispatch_heads SET pr = $3 WHERE dispatch_id = $1 AND head_sha = $2 AND pr IS NULL");
    expect(sql).toContain("'checkout.head_bound'");
    expect(h.calls[0].params).toEqual(["dsp_abc1234", "a".repeat(40), 3410, "compliance-gate"]);
  });

  it("reports the PR that already holds the head instead of rebinding it", async () => {
    h.results = [[], [{ pr: 9999 }]];
    expect(await bindDispatchHeadPr(input)).toBe(9999);
    expect(squash(h.calls[1].text)).toBe("SELECT pr FROM mc_dispatch_heads WHERE dispatch_id = $1 AND head_sha = $2");
    expect(h.calls[1].params).toEqual(["dsp_abc1234", "a".repeat(40)]);
  });

  it("returns null for a head that is not recorded", async () => {
    expect(await bindDispatchHeadPr(input)).toBeNull();
  });
});
