// Pure collaboration derivations (EN-001 / WS-3): @mention parsing and the
// unified comment + system-activity timeline merge. Kept pure and side-effect
// free so they are unit-testable without rendering React (the repo's tests are
// pure-function/store only — vitest.config.ts) and reusable by both the store
// (mention notifications) and the Timeline component.

import type { ActivityEntry, Comment } from "./types";

// Mentions are authored as `@<actorId>` tokens (the composer inserts the id,
// not the display name, so resolution is deterministic). Extract every token,
// keep only the ones that resolve to a known actor, and dedupe — never invent
// a recipient (Truth Before Action).
const MENTION_TOKEN = /@([a-z0-9][a-z0-9._-]*)/gi;

export function parseMentions(body: string, validIds: Iterable<string>): string[] {
  const valid = validIds instanceof Set ? validIds : new Set(validIds);
  const seen = new Set<string>();
  for (const match of String(body ?? "").matchAll(MENTION_TOKEN)) {
    const id = match[1].toLowerCase();
    if (valid.has(id)) seen.add(id);
  }
  return [...seen];
}

// ─── Unified timeline (comments interleaved with system activity events) ──────

// Comment timestamps use the store's stamp() format ("YYYY.MM.DD · HH:MM").
export function epochFromStamp(ts: string): number {
  const m = /^(\d{4})\.(\d{2})\.(\d{2})\s*·\s*(\d{2}):(\d{2})$/.exec(String(ts ?? "").trim());
  if (!m) return NaN;
  const [, y, mo, d, h, mi] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)).getTime();
}

// Activity entries carry only a relative `age` ("now", "2h", "3d"). Resolve the
// common shapes to an epoch so fresh events sort against fresh comments; an
// unparseable age yields NaN (sinks to the bottom, keeping its input order).
const AGE_UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

export function epochFromAge(age: string, now: number = Date.now()): number {
  const raw = String(age ?? "").trim().toLowerCase();
  if (raw === "now") return now;
  const m = /^(\d+)\s*([smhdw])$/.exec(raw);
  if (!m) return NaN;
  return now - Number(m[1]) * AGE_UNIT_MS[m[2]];
}

export type TimelineItem =
  | { kind: "comment"; at: number; comment: Comment }
  | { kind: "event"; at: number; event: ActivityEntry };

// Merge comments + activity into ONE newest-first stream (the aligned EN-001
// decision). Items with a resolvable time sort by it descending; items without
// one keep their original relative order at the tail (Array.prototype.sort is
// stable). Pure — callers pass the already-collected arrays.
export function mergeTimeline(
  comments: Comment[],
  activity: ActivityEntry[],
  now: number = Date.now()
): TimelineItem[] {
  const items: TimelineItem[] = [
    ...comments.map((comment): TimelineItem => ({ kind: "comment", at: epochFromStamp(comment.ts), comment })),
    ...activity.map((event): TimelineItem => ({ kind: "event", at: epochFromAge(event.age, now), event })),
  ];
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const aFinite = Number.isFinite(a.item.at);
      const bFinite = Number.isFinite(b.item.at);
      if (aFinite && bFinite) return b.item.at - a.item.at || a.index - b.index;
      if (aFinite) return -1;
      if (bFinite) return 1;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}
