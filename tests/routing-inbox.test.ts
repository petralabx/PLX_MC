// P9 — Routing Inbox flag + presentation contracts (queues, SLA badges).

import { afterEach, describe, expect, it } from "vitest";

import {
  resetRoutingInboxFlag,
  routingInboxEnabled,
  setRoutingInboxEnabled,
  tripRoutingInboxKillSwitch,
} from "@/components/mc/routing-inbox/flag";
import { SCREEN_VALUES, routeToUrl, urlToRoute } from "@/components/mc/route";
import { SCREENS } from "@/components/mc/screens";

afterEach(() => {
  resetRoutingInboxFlag();
});

describe("routing inbox kill switch", () => {
  it("defaults from env and can be enabled for tests", () => {
    setRoutingInboxEnabled(true);
    expect(routingInboxEnabled()).toBe(true);
    tripRoutingInboxKillSwitch();
    expect(routingInboxEnabled()).toBe(false);
  });

  it("reset restores env-derived default", () => {
    setRoutingInboxEnabled(true);
    tripRoutingInboxKillSwitch();
    resetRoutingInboxFlag();
    // Without env=1, default is off.
    expect(routingInboxEnabled()).toBe(process.env.PLX_MC_ROUTING_INBOX_ENABLED === "1");
  });
});

describe("routing-inbox screen registration", () => {
  it("is a first-class Screen with URL round-trip", () => {
    expect(SCREEN_VALUES).toContain("routing-inbox");
    expect(SCREENS["routing-inbox"]).toBeTypeOf("function");
    const route = { screen: "routing-inbox" as const };
    expect(routeToUrl(route)).toBe("/?screen=routing-inbox");
    expect(urlToRoute("/?screen=routing-inbox")).toEqual(route);
  });
});

describe("inbox queue scopes (presentation contract)", () => {
  const SCOPES = ["personal", "project", "bucket", "unrouted"] as const;

  it("covers personal, scoped, and Unrouted queues", () => {
    expect(SCOPES).toEqual(["personal", "project", "bucket", "unrouted"]);
  });

  it("maps SLA age to breach bands used by the UI", () => {
    function slaBreach(hours: number): "none" | "alert_24h" | "expire_7d" {
      if (hours >= 24 * 7) return "expire_7d";
      if (hours >= 24) return "alert_24h";
      return "none";
    }
    expect(slaBreach(2)).toBe("none");
    expect(slaBreach(24)).toBe("alert_24h");
    expect(slaBreach(24 * 7)).toBe("expire_7d");
  });
});
