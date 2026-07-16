// Honesty-oracle P6 — conflict console discoverability + fail-closed staleness.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SYNC_STALE_BANNER,
  resolutionsPausedFromFreshness,
  syncStaleBannerText,
} from "@/components/mc/sync-console.freshness";
import {
  __setOpenConflictsForTests,
  auditLog,
  openConflicts,
  resetStore,
  resolveConflict,
} from "@/lib/mc-data/store";
import type { SpConflict } from "@/lib/mc-data/types";
import { evaluateSyncFreshness } from "@/lib/sync/freshness";

const m = vi.hoisted(() => ({
  checkRoutingFreshness: vi.fn(),
}));

vi.mock("@/lib/sync", () => ({
  checkRoutingFreshness: m.checkRoutingFreshness,
}));

import { GET as freshnessGet } from "@/app/api/sync/freshness/route";

const ROOT = join(import.meta.dirname, "..");

function readSrc(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

beforeEach(() => {
  resetStore();
  m.checkRoutingFreshness.mockReset();
});

describe("staleness banner helpers (fail-closed)", () => {
  it("pauses when freshness is null/unknown and when ok is false", () => {
    expect(resolutionsPausedFromFreshness(null)).toBe(true);
    expect(resolutionsPausedFromFreshness(undefined)).toBe(true);
    expect(resolutionsPausedFromFreshness({ ok: false })).toBe(true);
    expect(syncStaleBannerText({ ok: false })).toBe(SYNC_STALE_BANNER);
    expect(SYNC_STALE_BANNER).toMatch(/sync stale/i);
    expect(SYNC_STALE_BANNER).toMatch(/resolutions paused/i);
  });

  it("unlocks only when freshness reports ok", () => {
    expect(resolutionsPausedFromFreshness({ ok: true })).toBe(false);
    expect(syncStaleBannerText({ ok: true })).toBeNull();
  });

  it("maps evaluateSyncFreshness stale registers to the banner", async () => {
    const stale = await evaluateSyncFreshness({
      now: new Date("2026-07-16T18:00:00.000Z"),
      loadRegisterTimestamps: async () => ({
        projects: new Date("2026-07-16T10:00:00.000Z"),
        roadmap: new Date("2026-07-16T10:00:00.000Z"),
        todos: new Date("2026-07-16T10:00:00.000Z"),
      }),
    });
    expect(stale.ok).toBe(false);
    expect(stale.code).toBe("sync_stale");
    expect(syncStaleBannerText(stale)).toBe(SYNC_STALE_BANNER);

    const fresh = await evaluateSyncFreshness({
      now: new Date("2026-07-16T18:00:00.000Z"),
      loadRegisterTimestamps: async () => ({
        projects: new Date("2026-07-16T17:55:00.000Z"),
        roadmap: new Date("2026-07-16T17:55:00.000Z"),
        todos: new Date("2026-07-16T17:55:00.000Z"),
      }),
    });
    expect(fresh.ok).toBe(true);
    expect(syncStaleBannerText(fresh)).toBeNull();
  });
});

describe("GET /api/sync/freshness", () => {
  it("returns checkRoutingFreshness payload for the console", async () => {
    m.checkRoutingFreshness.mockResolvedValue({
      ok: false,
      code: "sync_stale",
      maxAgeMs: 360_000,
      checkedAt: "2026-07-16T18:00:00.000Z",
      registers: [],
      reasons: ["missing_register:projects"],
    });
    const resp = await freshnessGet(new Request("http://test/api/sync/freshness"), {
      params: Promise.resolve({}),
    });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.data.ok).toBe(false);
    expect(body.data.code).toBe("sync_stale");
    expect(m.checkRoutingFreshness).toHaveBeenCalledOnce();
  });
});

describe("nav + console wiring", () => {
  it("exposes Sync / Conflicts (and Review queue) in chrome + command palette", () => {
    const chrome = readSrc("src/components/mc/chrome.tsx");
    expect(chrome).toContain("Sync / Conflicts");
    expect(chrome).toContain('nav("sync")');
    expect(chrome).toMatch(/Review queue/);

    const palette = readSrc("src/components/mc/command-palette.tsx");
    expect(palette).toContain("Go to Sync / Conflicts");
    expect(palette).toContain("Go to Conflicts");
    expect(palette).toContain("Go to Review queue");
    expect(palette).toMatch(/nav\("sync"\)/);
  });

  it("SyncConsole uses openConflicts and fail-closed stale banner", () => {
    const consoleSrc = readSrc("src/components/mc/sync-console.tsx");
    expect(consoleSrc).toMatch(/openConflicts\s*\(/);
    expect(consoleSrc).toContain("sync-stale-banner");
    expect(consoleSrc).toContain("SYNC_STALE_BANNER");
    expect(consoleSrc).toContain("resolutionsPaused");
    expect(consoleSrc).toContain('disabled={resolutionsPaused}');
    expect(consoleSrc).toContain('api<SyncFreshnessResult>("/sync/freshness")');
  });
});

describe("review queue — non-seed conflict via openConflicts path", () => {
  it("injects a live conflict, surfaces it via openConflicts, and resolves through store→API path", () => {
    expect(openConflicts()).toHaveLength(0);

    const liveConflict: SpConflict = {
      id: "cf-live-p6",
      list: "todos",
      entity: "Task",
      entityId: "TASK-221",
      field: "Title",
      mcVal: "MC title",
      spVal: "SP title",
      detected: "2026-07-16T17:00:00.000Z",
      by: "vince",
      note: "inbound delta conflict (non-seed)",
    };
    __setOpenConflictsForTests([liveConflict]);

    const queued = openConflicts();
    expect(queued).toHaveLength(1);
    expect(queued[0]?.id).toBe("cf-live-p6");
    expect(queued[0]?.note).toMatch(/non-seed/);

    resolveConflict("cf-live-p6", "mc");
    expect(openConflicts()).toHaveLength(0);
    expect(auditLog().some((row) => row.body.includes("cf-live-p6") || row.body.includes("TASK-221"))).toBe(
      true
    );
  });
});
