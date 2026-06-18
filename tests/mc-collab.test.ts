// Pure collaboration helpers (EN-001 / WS-3): @mention parsing and the unified
// comment + system-activity timeline merge. These carry the real invariants
// (only resolvable mentions count; the stream is newest-first), so they are
// unit-tested without rendering React.

import { describe, expect, it } from "vitest";

import {
  epochFromAge,
  epochFromStamp,
  mergeTimeline,
  parseMentions,
  type ActivityEntry,
  type Comment,
} from "@/lib/mc-data";

describe("parseMentions", () => {
  const valid = new Set(["vince", "greg", "vibes"]);

  it("extracts only resolvable @id tokens and dedupes", () => {
    const mentions = parseMentions("@vince ping @greg and @greg again, also @vibes", valid);
    expect(mentions).toEqual(["vince", "greg", "vibes"]);
  });

  it("ignores @tokens that are not in the directory (never invents a recipient)", () => {
    expect(parseMentions("hey @nobody and @ghost", valid)).toEqual([]);
  });

  it("is case-insensitive and accepts an array of ids", () => {
    expect(parseMentions("cc @Vince", ["vince"])).toEqual(["vince"]);
  });

  it("returns [] for an empty body", () => {
    expect(parseMentions("", valid)).toEqual([]);
  });
});

describe("epoch helpers", () => {
  it("parses the stamp() format", () => {
    expect(Number.isNaN(epochFromStamp("2026.06.17 · 21:40"))).toBe(false);
    expect(Number.isNaN(epochFromStamp("not a stamp"))).toBe(true);
  });

  it("resolves relative ages against a fixed now", () => {
    const now = 1_000_000_000;
    expect(epochFromAge("now", now)).toBe(now);
    expect(epochFromAge("2h", now)).toBe(now - 2 * 3_600_000);
    expect(Number.isNaN(epochFromAge("whenever", now))).toBe(true);
  });
});

describe("mergeTimeline", () => {
  const comment = (id: string, ts: string): Comment => ({
    id,
    author: "vince",
    body: "x",
    ts,
    mentions: [],
  });
  const event = (what: string, age: string): ActivityEntry => ({ age, who: "vince", what, kind: "move" });

  it("interleaves comments and events newest-first by resolved time", () => {
    const now = epochFromStamp("2026.06.17 · 12:00");
    const items = mergeTimeline(
      [comment("CMT-1", "2026.06.17 · 09:00"), comment("CMT-2", "2026.06.17 · 11:30")],
      [event("created", "1d"), event("just now", "now")],
      now
    );
    // Newest-first: the "now" event, then the 11:30 comment, then 09:00 comment,
    // then the 1d-old event.
    expect(items.map((i) => (i.kind === "comment" ? i.comment.id : i.event.what))).toEqual([
      "just now",
      "CMT-2",
      "CMT-1",
      "created",
    ]);
  });

  it("keeps unparseable-age events at the tail in input order", () => {
    const items = mergeTimeline(
      [comment("CMT-1", "2026.06.17 · 09:00")],
      [event("legacy a", "ages ago"), event("legacy b", "long ago")]
    );
    const ids = items.map((i) => (i.kind === "comment" ? i.comment.id : i.event.what));
    expect(ids[0]).toBe("CMT-1");
    expect(ids.slice(1)).toEqual(["legacy a", "legacy b"]);
  });
});
