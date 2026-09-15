import { describe, expect, it, vi } from "vitest";

import {
  COALESCE_WINDOW_MS,
  GO_LIVE_CHANNEL_ID,
  GO_LIVE_TEAM_ID,
  announceGoLiveEvent,
  classifyWebhookStatus,
  coalesceSiblingKind,
  configBlocksSend,
  eventIdFor,
  formatGoLiveLine,
  hubTaskMarkdown,
  loadGoLiveConfig,
  normalizeGithubRepo,
  prMarkdown,
  prUrlFromEvent,
  primaryDeliveryUrl,
  sanitizeGithubPrUrl,
  sanitizeTaskId,
  type GoLiveKind,
} from "@/lib/compliance/go-live-announcer";

function enabledConfig(overrides: Record<string, string> = {}) {
  return loadGoLiveConfig({
    MC_GO_LIVE_ANNOUNCER_ENABLED: "1",
    MC_GO_LIVE_ANNOUNCE_CHECKOUT: "1",
    MC_GO_LIVE_ANNOUNCE_PR_OPEN: "1",
    MC_GO_LIVE_ANNOUNCE_COMPLETE: "1",
    MC_GO_LIVE_ANNOUNCER_DRY_RUN: "0",
    MC_GO_LIVE_TEAMS_WORKFLOW_URL: "https://example.invalid/workflow",
    MC_GO_LIVE_TEAM_ID: GO_LIVE_TEAM_ID,
    MC_GO_LIVE_CHANNEL_ID: GO_LIVE_CHANNEL_ID,
    ...overrides,
  });
}

function checkoutEvent(taskId = "TASK-1454") {
  return {
    kind: "checkout",
    actor: "cursor",
    repo: "petralabx/plx-customer-portal",
    taskId,
    payload: { checkoutId: "dsp_mtrj5s9mn2ilbt" },
  };
}

function completeEvent(taskId = "TASK-1454", checkoutId = "dsp_mtrj5s9mn2ilbt") {
  return {
    kind: "task.completed",
    actor: "cursor",
    taskId,
    payload: { checkoutId },
  };
}

function prOpenEvent(taskId = "TASK-1454") {
  return {
    kind: "pr.opened",
    actor: "cursor",
    repo: "petralabx/PLX_MC",
    taskId,
    pr: "231",
  };
}

function okReceipt(receiptId: string) {
  return {
    ok: true,
    status: 202,
    receiptId,
    retryable: false,
    permanentAuth: false,
  };
}

function memoryDedupe() {
  const sent = new Map<string, { ts: number; receipt?: string }>();
  const clock = { t: Date.now() };
  return {
    clock,
    sent,
    alreadySent: async (id: string) => sent.has(id),
    claimSent: async (id: string) => {
      if (sent.has(id)) return false;
      sent.set(id, { ts: clock.t });
      return true;
    },
    siblingSent: async (taskId: string, kind: GoLiveKind, withinMs: number) => {
      const row = sent.get(`${kind}:${taskId}`);
      if (!row) return false;
      return clock.t - row.ts <= withinMs;
    },
    markSent: async (id: string, receiptId: string) => {
      sent.set(id, { ...(sent.get(id) ?? { ts: clock.t }), receipt: receiptId });
    },
  };
}

const HUB = "https://mc.plxcustomer.io/tasks/TASK-1454";
const TITLE_LINK = `[TASK-1454 — Outbound Teams announcer](${HUB})`;

describe("go-live formatter", () => {
  it("formats checkout with a Hub title deep link", () => {
    expect(
      formatGoLiveLine("checkout", {
        actor: "cursor",
        taskId: "TASK-1454",
        title: "Outbound Teams announcer",
      })
    ).toBe(`cursor claimed ${TITLE_LINK}`);
  });

  it("formats PR-open with title and PR markdown links", () => {
    expect(
      formatGoLiveLine("pr.opened", {
        actor: "cursor",
        taskId: "TASK-1454",
        title: "Outbound Teams announcer",
        url: "https://github.com/petralabx/PLX_MC/pull/231",
      })
    ).toBe(`${`PR opened for ${TITLE_LINK} — [PR #231](https://github.com/petralabx/PLX_MC/pull/231)`}`);
  });

  it("formats completion with a Hub title deep link", () => {
    expect(
      formatGoLiveLine("task.completed", {
        actor: "cursor",
        taskId: "TASK-1454",
        title: "Outbound Teams announcer",
      })
    ).toBe(`${TITLE_LINK} complete`);
  });

  it("formats a combined complete + PR line", () => {
    expect(
      formatGoLiveLine("task.completed", {
        actor: "cursor",
        taskId: "TASK-1454",
        title: "Outbound Teams announcer",
        url: "https://github.com/petralabx/PLX_MC/pull/1571",
      })
    ).toBe(`${TITLE_LINK} complete — [PR #1571](https://github.com/petralabx/PLX_MC/pull/1571)`);
  });

  it("builds Hub and PR markdown", () => {
    expect(hubTaskMarkdown("TASK-1697", "Hard-dedupe announces")).toBe(
      "[TASK-1697 — Hard-dedupe announces](https://mc.plxcustomer.io/tasks/TASK-1697)"
    );
    expect(prMarkdown("https://github.com/petralabx/PLX_MC/pull/1571")).toBe(
      "[PR #1571](https://github.com/petralabx/PLX_MC/pull/1571)"
    );
    expect(prMarkdown("https://github.com/evil/org/pull/1")).toBeNull();
  });

  it("rejects invalid task IDs", () => {
    expect(sanitizeTaskId("TASK")).toBeNull();
    expect(sanitizeTaskId("task-1454")).toBeNull();
    expect(formatGoLiveLine("task.completed", { actor: "cursor", taskId: "nope" })).toBeNull();
  });

  it("rejects unapproved URLs", () => {
    expect(sanitizeGithubPrUrl("evil/org", "1")).toBeNull();
    expect(sanitizeGithubPrUrl("petralabx/PLX_MC", "abc")).toBeNull();
    expect(sanitizeGithubPrUrl("petralabx/PLX_MC", "12")).toBe(
      "https://github.com/petralabx/PLX_MC/pull/12"
    );
  });

  it("normalizes allowlisted bare slugs to petralabx/<slug>", () => {
    expect(normalizeGithubRepo("PLX_MC")).toBe("petralabx/PLX_MC");
    expect(normalizeGithubRepo("plx-customer-portal")).toBe("petralabx/plx-customer-portal");
    expect(normalizeGithubRepo("agentic-swarm")).toBe("petralabx/agentic-swarm");
    expect(normalizeGithubRepo("petralabx/PLX_MC")).toBe("petralabx/PLX_MC");
    expect(normalizeGithubRepo("unknown-repo")).toBeNull();
    expect(normalizeGithubRepo("evil/org")).toBeNull();
  });

  it("builds PR URLs from bare allowlisted slugs stored on mc_events", () => {
    expect(sanitizeGithubPrUrl("PLX_MC", "12")).toBe("https://github.com/petralabx/PLX_MC/pull/12");
    expect(sanitizeGithubPrUrl("plx-customer-portal", "88")).toBe(
      "https://github.com/petralabx/plx-customer-portal/pull/88"
    );
    expect(sanitizeGithubPrUrl("agentic-swarm", "3")).toBe(
      "https://github.com/petralabx/agentic-swarm/pull/3"
    );
    expect(sanitizeGithubPrUrl("not-allowlisted", "1")).toBeNull();
  });

  it("reads a complete-payload PR URL from the allowlisted org", () => {
    expect(
      prUrlFromEvent({
        kind: "task.completed",
        actor: "cursor",
        taskId: "TASK-1697",
        payload: { checkoutId: "dsp_abc", prUrl: "https://github.com/petralabx/PLX_MC/pull/1571" },
      })
    ).toBe("https://github.com/petralabx/PLX_MC/pull/1571");
  });
});

describe("go-live kill switches", () => {
  it("global disabled sends nothing", async () => {
    const postWebhook = vi.fn();
    const dedupe = memoryDedupe();
    const result = await announceGoLiveEvent(checkoutEvent(), {
      loadConfig: () => enabledConfig({ MC_GO_LIVE_ANNOUNCER_ENABLED: "0" }),
      loadTitle: async () => "Outbound Teams announcer",
      ...dedupe,
      postWebhook,
    });
    expect(result.sent).toBe(false);
    expect(result.skipped).toBe("global_disabled");
    expect(postWebhook).not.toHaveBeenCalled();
  });

  it("checkout disabled sends nothing", async () => {
    const postWebhook = vi.fn();
    const result = await announceGoLiveEvent(checkoutEvent(), {
      loadConfig: () => enabledConfig({ MC_GO_LIVE_ANNOUNCE_CHECKOUT: "0" }),
      loadTitle: async () => "title",
      ...memoryDedupe(),
      postWebhook,
    });
    expect(result.skipped).toBe("checkout_disabled");
    expect(postWebhook).not.toHaveBeenCalled();
  });

  it("PR-open disabled sends nothing", async () => {
    const postWebhook = vi.fn();
    const result = await announceGoLiveEvent(prOpenEvent(), {
      loadConfig: () => enabledConfig({ MC_GO_LIVE_ANNOUNCE_PR_OPEN: "0" }),
      ...memoryDedupe(),
      postWebhook,
    });
    expect(result.skipped).toBe("pr_open_disabled");
    expect(postWebhook).not.toHaveBeenCalled();
  });

  it("complete disabled sends nothing", async () => {
    const postWebhook = vi.fn();
    const result = await announceGoLiveEvent(completeEvent(), {
      loadConfig: () => enabledConfig({ MC_GO_LIVE_ANNOUNCE_COMPLETE: "0" }),
      ...memoryDedupe(),
      postWebhook,
    });
    expect(result.skipped).toBe("complete_disabled");
    expect(postWebhook).not.toHaveBeenCalled();
  });

  it("dry-run sends nothing", async () => {
    const postWebhook = vi.fn();
    const result = await announceGoLiveEvent(checkoutEvent(), {
      loadConfig: () => enabledConfig({ MC_GO_LIVE_ANNOUNCER_DRY_RUN: "1" }),
      loadTitle: async () => "title",
      ...memoryDedupe(),
      postWebhook,
    });
    expect(result.skipped).toBe("dry_run");
    expect(postWebhook).not.toHaveBeenCalled();
  });

  it("missing delivery URL fails closed", () => {
    expect(
      configBlocksSend(
        enabledConfig({ MC_GO_LIVE_TEAMS_WORKFLOW_URL: "", MC_GO_LIVE_TEAMS_CHAT_WORKFLOW_URL: "" })
      )
    ).toBe("missing_delivery");
  });

  it("chat-only config is enough to send", () => {
    const cfg = enabledConfig({
      MC_GO_LIVE_TEAMS_WORKFLOW_URL: "",
      MC_GO_LIVE_TEAMS_CHAT_WORKFLOW_URL: "https://example.invalid/chat",
    });
    expect(configBlocksSend(cfg)).toBeNull();
    expect(primaryDeliveryUrl(cfg)).toBe("https://example.invalid/chat");
  });

  it("wrong team fails closed", () => {
    expect(configBlocksSend(enabledConfig({ MC_GO_LIVE_TEAM_ID: "00000000-0000-0000-0000-000000000000" }))).toBe(
      "team_not_allowlisted"
    );
  });

  it("wrong channel fails closed", () => {
    expect(
      configBlocksSend(
        enabledConfig({ MC_GO_LIVE_CHANNEL_ID: "19:not-the-channel@thread.tacv2" })
      )
    ).toBe("channel_not_allowlisted");
  });

  it("drops unexpected activity types", async () => {
    const postWebhook = vi.fn();
    const result = await announceGoLiveEvent(
      { kind: "message", actor: "cursor", taskId: "TASK-1454" },
      {
        loadConfig: () => enabledConfig(),
        ...memoryDedupe(),
        postWebhook,
      }
    );
    expect(result.skipped).toBe("unexpected_kind");
    expect(postWebhook).not.toHaveBeenCalled();
  });
});

describe("go-live send + dedup", () => {
  it("sends a valid checkout once", async () => {
    const postWebhook = vi.fn(async () => okReceipt("run-checkout-1"));
    const dedupe = memoryDedupe();
    const result = await announceGoLiveEvent(checkoutEvent(), {
      loadConfig: () => enabledConfig(),
      loadTitle: async () => "Outbound Teams announcer",
      ...dedupe,
      postWebhook,
    });
    expect(result.sent).toBe(true);
    expect(result.line).toBe(`cursor claimed ${TITLE_LINK}`);
    expect(result.receiptId).toBe("run-checkout-1");
    expect(postWebhook).toHaveBeenCalledTimes(1);
    expect(dedupe.sent.get("checkout:TASK-1454")?.receipt).toBe("run-checkout-1");
  });

  it("sends a valid PR-open once with markdown links", async () => {
    const postWebhook = vi.fn(async () => okReceipt("run-pr-1"));
    const result = await announceGoLiveEvent(prOpenEvent(), {
      loadConfig: () => enabledConfig(),
      loadTitle: async () => "Outbound Teams announcer",
      ...memoryDedupe(),
      postWebhook,
    });
    expect(result.sent).toBe(true);
    expect(result.line).toBe(
      `PR opened for ${TITLE_LINK} — [PR #231](https://github.com/petralabx/PLX_MC/pull/231)`
    );
    expect(result.receiptId).toBe("run-pr-1");
  });

  it("sends a valid completion once", async () => {
    const postWebhook = vi.fn(async () => okReceipt("run-complete-1"));
    const result = await announceGoLiveEvent(completeEvent(), {
      loadConfig: () => enabledConfig(),
      loadTitle: async () => "Outbound Teams announcer",
      ...memoryDedupe(),
      postWebhook,
    });
    expect(result.sent).toBe(true);
    expect(result.line).toBe(`${TITLE_LINK} complete`);
    expect(result.receiptId).toBe("run-complete-1");
  });

  it("duplicate event ID produces no second post", async () => {
    const postWebhook = vi.fn();
    const dedupe = memoryDedupe();
    await dedupe.claimSent("checkout:TASK-1454", { taskId: "TASK-1454", kind: "checkout" });
    const result = await announceGoLiveEvent(checkoutEvent(), {
      loadConfig: () => enabledConfig(),
      loadTitle: async () => "title",
      ...dedupe,
      postWebhook,
    });
    expect(result.skipped).toBe("duplicate");
    expect(postWebhook).not.toHaveBeenCalled();
  });

  it("dedupes complete by taskId across different checkout receipts", async () => {
    const postWebhook = vi.fn(async () => okReceipt("run-complete"));
    const dedupe = memoryDedupe();
    const first = await announceGoLiveEvent(completeEvent("TASK-1697", "dsp_firstcheckout1"), {
      loadConfig: () => enabledConfig(),
      loadTitle: async () => "Hard-dedupe announces",
      ...dedupe,
      postWebhook,
    });
    const second = await announceGoLiveEvent(completeEvent("TASK-1697", "dsp_secondcheckout2"), {
      loadConfig: () => enabledConfig(),
      loadTitle: async () => "Hard-dedupe announces",
      ...dedupe,
      postWebhook,
    });
    expect(first.sent).toBe(true);
    expect(second.skipped).toBe("duplicate");
    expect(postWebhook).toHaveBeenCalledTimes(1);
    expect(eventIdFor(completeEvent("TASK-1697", "dsp_aaaa"))).toBe("task.completed:TASK-1697");
    expect(eventIdFor(completeEvent("TASK-1697", "dsp_bbbb"))).toBe("task.completed:TASK-1697");
  });

  it("does not re-post after a failed send because the slot is already claimed", async () => {
    const postWebhook = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        receiptId: "http-401",
        retryable: false,
        permanentAuth: true,
      })
      .mockResolvedValueOnce(okReceipt("should-not-send"));
    const dedupe = memoryDedupe();
    const first = await announceGoLiveEvent(completeEvent("TASK-1692"), {
      loadConfig: () => enabledConfig(),
      loadTitle: async () => "title",
      ...dedupe,
      postWebhook,
    });
    const second = await announceGoLiveEvent(completeEvent("TASK-1692", "dsp_othercheckout99"), {
      loadConfig: () => enabledConfig(),
      loadTitle: async () => "title",
      ...dedupe,
      postWebhook,
    });
    expect(first.skipped).toBe("auth_failed");
    expect(second.skipped).toBe("duplicate");
    expect(postWebhook).toHaveBeenCalledTimes(1);
  });

  it("retries transient send errors then succeeds", async () => {
    const postWebhook = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        receiptId: "http-503",
        retryable: true,
        permanentAuth: false,
      })
      .mockResolvedValueOnce(okReceipt("run-retry"));
    const result = await announceGoLiveEvent(checkoutEvent(), {
      loadConfig: () => enabledConfig(),
      loadTitle: async () => "Outbound Teams announcer",
      ...memoryDedupe(),
      postWebhook,
      sleep: async () => undefined,
    });
    expect(result.sent).toBe(true);
    expect(result.receiptId).toBe("run-retry");
    expect(postWebhook).toHaveBeenCalledTimes(2);
  });

  it("permanent authentication errors stop without looping", async () => {
    const postWebhook = vi.fn(async () => ({
      ok: false,
      status: 401,
      receiptId: "http-401",
      retryable: false,
      permanentAuth: true,
    }));
    const result = await announceGoLiveEvent(checkoutEvent(), {
      loadConfig: () => enabledConfig(),
      loadTitle: async () => "title",
      ...memoryDedupe(),
      postWebhook,
      sleep: async () => undefined,
    });
    expect(result.sent).toBe(false);
    expect(result.skipped).toBe("auth_failed");
    expect(postWebhook).toHaveBeenCalledTimes(1);
  });

  it("classifies 401 as permanent and 503 as retryable", () => {
    expect(classifyWebhookStatus(401)).toEqual({ retryable: false, permanentAuth: true });
    expect(classifyWebhookStatus(503)).toEqual({ retryable: true, permanentAuth: false });
  });

  it("builds event IDs from taskId + kind, not checkout receipts", () => {
    expect(eventIdFor(checkoutEvent())).toBe("checkout:TASK-1454");
    expect(
      eventIdFor({
        kind: "pr.opened",
        actor: "cursor",
        repo: "plx-customer-portal",
        taskId: "TASK-1454",
        pr: "232",
      })
    ).toBe("pr.opened:TASK-1454");
    expect(coalesceSiblingKind("pr.opened")).toBe("task.completed");
    expect(coalesceSiblingKind("task.completed")).toBe("pr.opened");
  });

  it("sends a PR-open announce when mc_events stored a bare slug", async () => {
    const postWebhook = vi.fn(async () => okReceipt("run-pr-bare"));
    const result = await announceGoLiveEvent(
      {
        kind: "pr.opened",
        actor: "cursor",
        repo: "plx-customer-portal",
        taskId: "TASK-1524",
        pr: "240",
      },
      {
        loadConfig: () => enabledConfig(),
        loadTitle: async () => "Bare slug PR announce",
        ...memoryDedupe(),
        postWebhook,
      }
    );
    expect(result.sent).toBe(true);
    expect(result.line).toBe(
      "PR opened for [TASK-1524 — Bare slug PR announce](https://mc.plxcustomer.io/tasks/TASK-1524) — [PR #240](https://github.com/petralabx/plx-customer-portal/pull/240)"
    );
    expect(postWebhook).toHaveBeenCalledTimes(1);
  });

  it("posts only to chat when both Workflow URLs are set", async () => {
    const postWebhook = vi.fn(async () => okReceipt("run-chat"));
    const result = await announceGoLiveEvent(checkoutEvent(), {
      loadConfig: () =>
        enabledConfig({
          MC_GO_LIVE_TEAMS_CHAT_WORKFLOW_URL: "https://example.invalid/chat",
        }),
      loadTitle: async () => "Outbound Teams announcer",
      ...memoryDedupe(),
      postWebhook,
    });
    expect(result.sent).toBe(true);
    expect(postWebhook).toHaveBeenCalledTimes(1);
    expect(postWebhook).toHaveBeenCalledWith("https://example.invalid/chat", `cursor claimed ${TITLE_LINK}`);
  });

  it("falls back to the channel Workflow when chat URL is empty", async () => {
    const postWebhook = vi.fn(async () => okReceipt("run-channel-only"));
    const result = await announceGoLiveEvent(checkoutEvent(), {
      loadConfig: () => enabledConfig(),
      loadTitle: async () => "Outbound Teams announcer",
      ...memoryDedupe(),
      postWebhook,
    });
    expect(result.sent).toBe(true);
    expect(postWebhook).toHaveBeenCalledTimes(1);
    expect(postWebhook).toHaveBeenCalledWith("https://example.invalid/workflow", expect.any(String));
  });

  it("skips a malformed chat Workflow URL and uses the channel fallback", async () => {
    const postWebhook = vi.fn(async () => okReceipt("run-channel-fallback"));
    const result = await announceGoLiveEvent(checkoutEvent(), {
      loadConfig: () =>
        enabledConfig({
          MC_GO_LIVE_TEAMS_CHAT_WORKFLOW_URL: "http://example.invalid/chat",
        }),
      loadTitle: async () => "Outbound Teams announcer",
      ...memoryDedupe(),
      postWebhook,
    });
    expect(result.sent).toBe(true);
    expect(postWebhook).toHaveBeenCalledTimes(1);
    expect(postWebhook).toHaveBeenCalledWith("https://example.invalid/workflow", expect.any(String));
  });

  it("coalesces complete when PR-open already posted for the same task", async () => {
    const postWebhook = vi.fn(async () => okReceipt("run"));
    const dedupe = memoryDedupe();
    const pr = await announceGoLiveEvent(prOpenEvent("TASK-1697"), {
      loadConfig: () => enabledConfig(),
      loadTitle: async () => "Dedupe work",
      ...dedupe,
      postWebhook,
    });
    const complete = await announceGoLiveEvent(completeEvent("TASK-1697"), {
      loadConfig: () => enabledConfig(),
      loadTitle: async () => "Dedupe work",
      ...dedupe,
      postWebhook,
    });
    expect(pr.sent).toBe(true);
    expect(complete.skipped).toBe("coalesced");
    expect(postWebhook).toHaveBeenCalledTimes(1);
  });

  it("coalesces PR-open when complete already posted for the same task", async () => {
    const postWebhook = vi.fn(async () => okReceipt("run"));
    const dedupe = memoryDedupe();
    const complete = await announceGoLiveEvent(completeEvent("TASK-1697"), {
      loadConfig: () => enabledConfig(),
      loadTitle: async () => "Dedupe work",
      ...dedupe,
      postWebhook,
    });
    const pr = await announceGoLiveEvent(prOpenEvent("TASK-1697"), {
      loadConfig: () => enabledConfig(),
      loadTitle: async () => "Dedupe work",
      ...dedupe,
      postWebhook,
    });
    expect(complete.sent).toBe(true);
    expect(pr.skipped).toBe("coalesced");
    expect(postWebhook).toHaveBeenCalledTimes(1);
  });

  it("sends one combined complete line and suppresses a later PR-open", async () => {
    const postWebhook = vi.fn(async () => okReceipt("run-combined"));
    const dedupe = memoryDedupe();
    const complete = await announceGoLiveEvent(
      {
        kind: "task.completed",
        actor: "cursor",
        taskId: "TASK-1697",
        payload: {
          checkoutId: "dsp_combined1",
          prUrl: "https://github.com/petralabx/PLX_MC/pull/1571",
        },
      },
      {
        loadConfig: () => enabledConfig(),
        loadTitle: async () => "Hard-dedupe announces",
        ...dedupe,
        postWebhook,
      }
    );
    const pr = await announceGoLiveEvent(
      {
        kind: "pr.opened",
        actor: "cursor",
        repo: "PLX_MC",
        taskId: "TASK-1697",
        pr: "1571",
      },
      {
        loadConfig: () => enabledConfig(),
        loadTitle: async () => "Hard-dedupe announces",
        ...dedupe,
        postWebhook,
      }
    );
    expect(complete.sent).toBe(true);
    expect(complete.line).toBe(
      "[TASK-1697 — Hard-dedupe announces](https://mc.plxcustomer.io/tasks/TASK-1697) complete — [PR #1571](https://github.com/petralabx/PLX_MC/pull/1571)"
    );
    expect(pr.skipped).toBe("duplicate");
    expect(postWebhook).toHaveBeenCalledTimes(1);
    expect(COALESCE_WINDOW_MS).toBe(15 * 60 * 1000);
  });
});
