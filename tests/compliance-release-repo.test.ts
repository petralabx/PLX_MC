// TASK-2326: the dispatch-ledger SQL behind mc_release_checkout. The fake
// query records each statement so the tests can pin its guards: a manual
// release touches only an unrevoked, unreleased lease and writes its
// checkout.released event in the same statement, and a PR reopen undoes only a
// merge/close release — never a manual one.

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  calls: [] as { text: string; params: unknown[] }[],
  rows: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/db", () => ({
  query: async (text: string, params: unknown[] = []) => {
    h.calls.push({ text, params });
    return h.rows;
  },
}));

import {
  findDispatchesBySuffix,
  releaseDispatchManually,
  unreleaseDispatches,
} from "@/lib/compliance/repo";

const squash = (sql: string) => sql.replace(/\s+/g, " ");

beforeEach(() => {
  h.calls.length = 0;
  h.rows = [];
});

describe("releaseDispatchManually", () => {
  it("releases and audits in one guarded statement", async () => {
    h.rows = [{ released_at: new Date("2026-10-03T12:00:00Z"), seq: 42 }];
    const result = await releaseDispatchManually({
      id: "dsp_abc1234",
      releasedReason: "manual: stray",
      actor: "claude-code:ross@petrasoap.com",
      payload: { checkoutRef: "dsp_…1234", reason: "stray" },
    });
    expect(result).toEqual({ releasedAt: "2026-10-03T12:00:00.000Z", eventSeq: "42" });
    expect(h.calls).toHaveLength(1);
    const sql = squash(h.calls[0].text);
    expect(sql).toContain("UPDATE mc_dispatch SET released_at = now(), released_reason = $2");
    expect(sql).toContain("WHERE id = $1 AND NOT revoked AND released_at IS NULL");
    expect(sql).toContain("INSERT INTO mc_events");
    expect(sql).toContain("'checkout.released'");
    expect(sql).not.toMatch(/mc_entities|stage/);
    expect(h.calls[0].params).toEqual([
      "dsp_abc1234",
      "manual: stray",
      "claude-code:ross@petrasoap.com",
      JSON.stringify({ checkoutRef: "dsp_…1234", reason: "stray" }),
    ]);
  });

  it("returns null when the guard matched nothing", async () => {
    const result = await releaseDispatchManually({
      id: "dsp_abc1234",
      releasedReason: "manual: again",
      actor: "a",
      payload: {},
    });
    expect(result).toBeNull();
  });
});

describe("unreleaseDispatches", () => {
  it("undoes only a merge or close release", async () => {
    await unreleaseDispatches(["dsp_abc1234"], { repo: "petralabx/PLX_MC" });
    expect(squash(h.calls[0].text)).toContain("AND released_reason IN ('merged', 'closed')");
  });
});

describe("findDispatchesBySuffix", () => {
  it("scopes the suffix match to one task", async () => {
    await findDispatchesBySuffix("TASK-2279", "bn4y");
    expect(squash(h.calls[0].text)).toContain("WHERE task_id = $1 AND right(id, length($2)) = $2");
    expect(h.calls[0].params).toEqual(["TASK-2279", "bn4y"]);
  });
});
