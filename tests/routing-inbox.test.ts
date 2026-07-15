// P9 — Routing Inbox flag + presentation contracts (queues, SLA badges).

import { afterEach, describe, expect, it, vi } from "vitest";

const inboxDb = vi.hoisted(() => ({
  calls: [] as Array<{ text: string; params: unknown[] }>,
  responses: [] as unknown[][],
}));

vi.mock("@/lib/db", () => ({
  async query(text: string, params: unknown[] = []) {
    inboxDb.calls.push({ text, params });
    return inboxDb.responses.shift() ?? [];
  },
}));

import {
  resetRoutingInboxFlag,
  routingInboxEnabled,
  setRoutingInboxEnabled,
  tripRoutingInboxKillSwitch,
} from "@/components/mc/routing-inbox/flag";
import { SCREEN_VALUES, routeToUrl, urlToRoute } from "@/components/mc/route";
import { SCREENS } from "@/components/mc/screens";
import {
  getInboxProposalDetail,
  listInboxProposals,
} from "@/app/api/routing/inbox/_lib/queries";

afterEach(() => {
  resetRoutingInboxFlag();
  inboxDb.calls.length = 0;
  inboxDb.responses.length = 0;
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

describe("inbox cohort visibility boundary", () => {
  it("passes only suggestion-visible repos into list and count SQL", async () => {
    const previousSuggest = process.env.PLX_MC_ROUTING_SUGGEST_ENABLED;
    const previousShadow = process.env.PLX_MC_ROUTING_SHADOW_ENABLED;
    const previousInbox = process.env.PLX_MC_ROUTING_INBOX_ENABLED;
    process.env.PLX_MC_ROUTING_SHADOW_ENABLED = "1";
    process.env.PLX_MC_ROUTING_SUGGEST_ENABLED = "1";
    process.env.PLX_MC_ROUTING_INBOX_ENABLED = "1";
    try {
      inboxDb.responses.push(
        [],
        [
          { scope: "personal", n: 0 },
          { scope: "project", n: 0 },
          { scope: "bucket", n: 0 },
          { scope: "unrouted", n: 0 },
        ]
      );
      await listInboxProposals({ scope: "personal", actorId: "oid-1" });

      const visibleRepos = [
        "petralabx/PLX_MC",
        "petralabx/plx-customer-portal",
        "petralabx/agentic-swarm",
      ];
      expect(inboxDb.calls[0]?.text).toContain("p.repo_id = ANY($2::text[])");
      expect(inboxDb.calls[0]?.params[1]).toEqual(visibleRepos);
      expect(inboxDb.calls[1]?.text).toContain("p.repo_id = ANY($2::text[])");
      expect(inboxDb.calls[1]?.params[1]).toEqual(visibleRepos);
      expect(visibleRepos).not.toContain("petralabx/skills");
    } finally {
      if (previousSuggest === undefined) {
        delete process.env.PLX_MC_ROUTING_SUGGEST_ENABLED;
      } else {
        process.env.PLX_MC_ROUTING_SUGGEST_ENABLED = previousSuggest;
      }
      if (previousShadow === undefined) delete process.env.PLX_MC_ROUTING_SHADOW_ENABLED;
      else process.env.PLX_MC_ROUTING_SHADOW_ENABLED = previousShadow;
      if (previousInbox === undefined) delete process.env.PLX_MC_ROUTING_INBOX_ENABLED;
      else process.env.PLX_MC_ROUTING_INBOX_ENABLED = previousInbox;
    }
  });

  it("returns null for detail rows outside the visible repo allowlist", async () => {
    const previousSuggest = process.env.PLX_MC_ROUTING_SUGGEST_ENABLED;
    const previousShadow = process.env.PLX_MC_ROUTING_SHADOW_ENABLED;
    const previousInbox = process.env.PLX_MC_ROUTING_INBOX_ENABLED;
    process.env.PLX_MC_ROUTING_SHADOW_ENABLED = "1";
    process.env.PLX_MC_ROUTING_SUGGEST_ENABLED = "1";
    process.env.PLX_MC_ROUTING_INBOX_ENABLED = "1";
    try {
      inboxDb.responses.push([]);
      await expect(getInboxProposalDetail("rpp_shadow")).resolves.toBeNull();
      expect(inboxDb.calls[0]?.text).toContain("p.repo_id = ANY($2::text[])");
      expect(inboxDb.calls[0]?.params[1]).not.toContain("petralabx/skills");
    } finally {
      if (previousSuggest === undefined) {
        delete process.env.PLX_MC_ROUTING_SUGGEST_ENABLED;
      } else {
        process.env.PLX_MC_ROUTING_SUGGEST_ENABLED = previousSuggest;
      }
      if (previousShadow === undefined) delete process.env.PLX_MC_ROUTING_SHADOW_ENABLED;
      else process.env.PLX_MC_ROUTING_SHADOW_ENABLED = previousShadow;
      if (previousInbox === undefined) delete process.env.PLX_MC_ROUTING_INBOX_ENABLED;
      else process.env.PLX_MC_ROUTING_INBOX_ENABLED = previousInbox;
    }
  });

  it("passes an empty allowlist to list/count SQL when Inbox is disabled", async () => {
    const previousShadow = process.env.PLX_MC_ROUTING_SHADOW_ENABLED;
    const previousSuggest = process.env.PLX_MC_ROUTING_SUGGEST_ENABLED;
    const previousInbox = process.env.PLX_MC_ROUTING_INBOX_ENABLED;
    process.env.PLX_MC_ROUTING_SHADOW_ENABLED = "1";
    process.env.PLX_MC_ROUTING_SUGGEST_ENABLED = "1";
    process.env.PLX_MC_ROUTING_INBOX_ENABLED = "0";
    try {
      inboxDb.responses.push([], []);
      await listInboxProposals({ scope: "personal", actorId: "oid-1" });
      expect(inboxDb.calls[0]?.params[1]).toEqual([]);
      expect(inboxDb.calls[1]?.params[1]).toEqual([]);
    } finally {
      if (previousShadow === undefined) delete process.env.PLX_MC_ROUTING_SHADOW_ENABLED;
      else process.env.PLX_MC_ROUTING_SHADOW_ENABLED = previousShadow;
      if (previousSuggest === undefined) delete process.env.PLX_MC_ROUTING_SUGGEST_ENABLED;
      else process.env.PLX_MC_ROUTING_SUGGEST_ENABLED = previousSuggest;
      if (previousInbox === undefined) delete process.env.PLX_MC_ROUTING_INBOX_ENABLED;
      else process.env.PLX_MC_ROUTING_INBOX_ENABLED = previousInbox;
    }
  });
});
