// EN-007 P4 — the event-export contract (the Second-Brain feed). Query parsing
// is pure; listEvents is checked against a mocked repo seam (no DB) to prove the
// query (afterSeq/limit/kind) is passed through to the keyset reader unchanged.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseEventsQuery } from "@/lib/compliance/events";

const calls = vi.hoisted(() => ({ args: [] as { afterSeq: number; limit: number; kind: string | null }[] }));

vi.mock("@/lib/compliance/repo", () => ({
  async eventsAfter(afterSeq: number, limit: number, kind: string | null) {
    calls.args.push({ afterSeq, limit, kind });
    return [];
  },
}));

import { listEvents } from "@/lib/compliance/service";

beforeEach(() => {
  calls.args.length = 0;
});

describe("parseEventsQuery", () => {
  it("applies defaults", () => {
    expect(parseEventsQuery(new URLSearchParams())).toEqual({ afterSeq: 0, limit: 100, kind: null });
  });

  it("clamps limit to 500, floors after at 0, and passes kind", () => {
    expect(parseEventsQuery(new URLSearchParams("after=-5&limit=9999&kind=gate.blocked"))).toEqual({
      afterSeq: 0,
      limit: 500,
      kind: "gate.blocked",
    });
  });

  it("treats garbage / empty values as defaults", () => {
    expect(parseEventsQuery(new URLSearchParams("after=abc&limit=&kind="))).toEqual({
      afterSeq: 0,
      limit: 100,
      kind: null,
    });
  });

  it("keeps a valid window and floors fractional cursors", () => {
    expect(parseEventsQuery(new URLSearchParams("after=12.9&limit=50&kind=pr.merged"))).toEqual({
      afterSeq: 12,
      limit: 50,
      kind: "pr.merged",
    });
  });
});

describe("listEvents", () => {
  it("passes the query through to the keyset reader unchanged", async () => {
    await listEvents({ afterSeq: 10, limit: 50, kind: "pr.merged" });
    expect(calls.args[0]).toEqual({ afterSeq: 10, limit: 50, kind: "pr.merged" });
  });
});
