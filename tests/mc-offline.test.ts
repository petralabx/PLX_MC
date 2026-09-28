// Wave 2 — UI trust: when GET /api/state fails the store keeps showing
// fixture/cached data that looks real, so it records the data source and the
// shell says so app-wide ("Offline — showing cached or demo data" + Retry).
// The Sync console's "Connected · Microsoft 365" is derived, never a constant.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { OfflineBanner } from "@/components/mc/chrome";
import { connectionStatus } from "@/components/mc/sync-console.freshness";
import {
  __setStateLoaderForTests,
  allTasks,
  auditLog,
  dataSource,
  hydrate,
  lastSweep,
  openConflicts,
  openErrors,
  resetStore,
  type ServerSnapshot,
} from "@/lib/mc-data/store";

beforeEach(() => resetStore());

function liveSnapshot(): ServerSnapshot {
  return {
    tasks: allTasks().slice(0, 2),
    risks: [],
    files: [],
    conflicts: openConflicts(),
    errors: openErrors(),
    audit: [{ ts: "2026.09.25 · 12:00", actor: "scribe", body: "live row", state: "synced" }],
    counts: {},
    lastSweep: "2026.09.25 · 12:00",
  };
}

const banner = () => renderToStaticMarkup(createElement(OfflineBanner));

describe("store data source", () => {
  it("starts on seed data — neither live nor (yet) offline — holding the banner's place", () => {
    expect(dataSource()).toBe("seed");
    // An empty, aria-hidden slot of the banner's height (ADR-005): if the first
    // load fails, slot → banner moves nothing on the page. No copy, no alert.
    expect(banner()).toBe('<div class="banner-slot" aria-hidden="true"></div>');
  });

  it("flips to offline when /api/state fails, and the fixture data stays on screen", async () => {
    const seeded = allTasks().length;
    __setStateLoaderForTests(async () => {
      throw new Error("HTTP 500");
    });
    await hydrate();
    expect(dataSource()).toBe("offline");
    expect(allTasks()).toHaveLength(seeded);
  });

  it("recovers to live when a retry succeeds, adopting the server snapshot", async () => {
    __setStateLoaderForTests(async () => {
      throw new Error("HTTP 500");
    });
    await hydrate();
    expect(dataSource()).toBe("offline");

    __setStateLoaderForTests(async () => liveSnapshot());
    await hydrate();
    expect(dataSource()).toBe("live");
    expect(allTasks()).toHaveLength(2);
    expect(auditLog()[0].body).toBe("live row");
    expect(lastSweep()).toBe("2026.09.25 · 12:00");
  });

  it("goes offline again if a later reload fails (cached data is labelled too)", async () => {
    __setStateLoaderForTests(async () => liveSnapshot());
    await hydrate();
    expect(dataSource()).toBe("live");
    __setStateLoaderForTests(async () => {
      throw new Error("ECONNRESET");
    });
    await hydrate();
    expect(dataSource()).toBe("offline");
  });
});

describe("OfflineBanner", () => {
  it("renders the offline copy with a Retry action only while offline", async () => {
    __setStateLoaderForTests(async () => {
      throw new Error("HTTP 500");
    });
    await hydrate();
    const html = banner();
    expect(html).toContain("Offline — showing cached or demo data");
    expect(html).toContain("Retry");
    expect(html).toContain('role="alert"');

    __setStateLoaderForTests(async () => liveSnapshot());
    await hydrate();
    expect(banner()).toBe("");
  });
});

describe("connectionStatus (Sync console · Connection)", () => {
  it("claims 'Connected · Microsoft 365' only when live data and a fresh sweep agree", () => {
    expect(connectionStatus("live", { ok: true })).toEqual({ tone: "ok", label: "Connected · Microsoft 365" });
  });

  it("never claims connected while offline, stale, or unverified", () => {
    for (const [source, freshness] of [
      ["offline", { ok: true }],
      ["offline", null],
      ["live", { ok: false }],
      ["live", null],
      ["seed", null],
    ] as const) {
      const status = connectionStatus(source, freshness);
      expect(status.tone).toBe("off");
      expect(status.label).not.toMatch(/connected/i);
    }
    expect(connectionStatus("offline", { ok: true }).label).toMatch(/offline/i);
    expect(connectionStatus("live", { ok: false }).label).toMatch(/stale/i);
    expect(connectionStatus("live", null).label).toMatch(/unverified/i);
  });
});
