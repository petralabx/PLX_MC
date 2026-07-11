// P3 deep links — the pure Route ⇄ URL serializer/parser contract. The shell
// (shell.tsx) trusts these two functions for pushState URLs, initial-load
// adoption, and popstate replay, so the invariants live here: every Screen
// round-trips, entity ids round-trip, and garbage input NEVER escapes the
// "home" fallback (a bad URL must not crash the shell).
import { describe, expect, it } from "vitest";

import type { Route, Screen } from "@/components/mc/route";
import { SCREEN_VALUES, routeToUrl, urlToRoute } from "@/components/mc/route";

describe("routeToUrl (P3)", () => {
  it("serializes home to the bare root path", () => {
    expect(routeToUrl({ screen: "home" })).toBe("/");
  });

  it("serializes a non-home screen as a query param", () => {
    expect(routeToUrl({ screen: "board" })).toBe("/?screen=board");
  });

  it("carries entity ids as query params", () => {
    expect(routeToUrl({ screen: "task", taskId: "TASK-221" })).toBe("/?screen=task&taskId=TASK-221");
    expect(routeToUrl({ screen: "bucket", bucketId: "BKT-UAT" })).toBe("/?screen=bucket&bucketId=BKT-UAT");
    expect(routeToUrl({ screen: "project", projectId: "PRJ-1" })).toBe("/?screen=project&projectId=PRJ-1");
  });

  it("does NOT serialize the transient filter field", () => {
    const url = routeToUrl({ screen: "board", filter: { text: "wms", priority: ["urgent"] } });
    expect(url).toBe("/?screen=board");
    expect(url).not.toContain("filter");
  });
});

describe("urlToRoute (P3)", () => {
  it("round-trips EVERY Screen value", () => {
    for (const screen of SCREEN_VALUES) {
      const route: Route = { screen };
      expect(urlToRoute(routeToUrl(route))).toEqual(route);
    }
  });

  it("round-trips entity ids, including ones needing percent-encoding", () => {
    const routes: Route[] = [
      { screen: "task", taskId: "TASK-221" },
      { screen: "bucket", bucketId: "BKT-MISSION-CONTROL-OPS" },
      { screen: "project", projectId: "PRJ-2026" },
      { screen: "task", projectId: "PRJ-1", bucketId: "BKT-2", taskId: "TASK-3" },
      // Ids with URL-hostile characters must survive encode → decode.
      { screen: "task", taskId: "TASK a&b=c?" },
    ];
    for (const route of routes) {
      expect(urlToRoute(routeToUrl(route))).toEqual(route);
    }
  });

  it("accepts a bare location.search string and a full href", () => {
    expect(urlToRoute("?screen=sync")).toEqual({ screen: "sync" });
    expect(urlToRoute("https://mc.example.com/?screen=repos")).toEqual({ screen: "repos" });
  });

  it("falls back to home for unknown or garbage input", () => {
    expect(urlToRoute("")).toEqual({ screen: "home" });
    expect(urlToRoute("/")).toEqual({ screen: "home" });
    expect(urlToRoute("/?screen=not-a-screen")).toEqual({ screen: "home" });
    expect(urlToRoute("/?screen=")).toEqual({ screen: "home" });
    expect(urlToRoute("/?screen=BOARD")).toEqual({ screen: "home" }); // case-sensitive
    expect(urlToRoute("total %% garbage ?? &&= junk")).toEqual({ screen: "home" });
    expect(urlToRoute("/?utm_source=mail&foo=bar")).toEqual({ screen: "home" });
  });

  it("keeps entity ids even when the screen falls back to home", () => {
    // Unknown screen + a valid id: screen falls back, the id still parses —
    // the shell simply ignores ids the home screen does not use.
    expect(urlToRoute("/?screen=bogus&taskId=TASK-9")).toEqual({ screen: "home", taskId: "TASK-9" });
  });

  it("ignores empty entity id params", () => {
    expect(urlToRoute("/?screen=task&taskId=")).toEqual({ screen: "task" });
  });
});

describe("SCREEN_VALUES stays in lockstep with the Screen type", () => {
  it("contains no duplicates", () => {
    expect(new Set(SCREEN_VALUES).size).toBe(SCREEN_VALUES.length);
  });

  it("includes home (the fallback screen)", () => {
    const values: readonly Screen[] = SCREEN_VALUES;
    expect(values).toContain("home");
  });
});
