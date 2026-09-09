import { describe, expect, it, vi } from "vitest";

import {
  GO_LIVE_CHANNEL_ID,
  GO_LIVE_TEAM_ID,
  announceGoLiveEvent,
  classifyWebhookStatus,
  configBlocksSend,
  eventIdFor,
  formatGoLiveLine,
  loadGoLiveConfig,
  normalizeGithubRepo,
  sanitizeGithubPrUrl,
  sanitizeTaskId,
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

function checkoutEvent() {
  return {
    kind: "checkout",
    actor: "cursor",
    repo: "petralabx/plx-customer-portal",
    taskId: "TASK-1454",
    payload: { checkoutId: "dsp_mtrj5s9mn2ilbt" },
  };
}

describe("go-live formatter", () => {
  it("formats checkout as one line", () => {
    expect(
      formatGoLiveLine("checkout", {
        actor: "cursor",
        taskId: "TASK-1454",
        title: "Outbound Teams announcer",
      })
    ).toBe("cursor claimed TASK-1454 (Outbound Teams announcer)");
  });

  it("formats PR-open as one line", () => {
    expect(
      formatGoLiveLine("pr.opened", {
        actor: "cursor",
        taskId: "TASK-1454",
        url: "https://github.com/petralabx/PLX_MC/pull/231",
      })
    ).toBe("PR opened for TASK-1454: https://github.com/petralabx/PLX_MC/pull/231");
  });

  it("formats completion as one line", () => {
    expect(formatGoLiveLine("task.completed", { actor: "cursor", taskId: "TASK-1454" })).toBe(
      "TASK-1454 complete"
    );
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
});

describe("go-live kill switches", () => {
  it("global disabled sends nothing", async () => {
    const postWebhook = vi.fn();
    const result = await announceGoLiveEvent(checkoutEvent(), {
      loadConfig: () => enabledConfig({ MC_GO_LIVE_ANNOUNCER_ENABLED: "0" }),
      loadTitle: async () => "Outbound Teams announcer",
      alreadySent: async () => false,
      markSent: async () => undefined,
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
      alreadySent: async () => false,
      markSent: async () => undefined,
      postWebhook,
    });
    expect(result.skipped).toBe("checkout_disabled");
    expect(postWebhook).not.toHaveBeenCalled();
  });

  it("PR-open disabled sends nothing", async () => {
    const postWebhook = vi.fn();
    const result = await announceGoLiveEvent(
      {
        kind: "pr.opened",
        actor: "cursor",
        repo: "petralabx/PLX_MC",
        taskId: "TASK-1454",
        pr: "231",
      },
      {
        loadConfig: () => enabledConfig({ MC_GO_LIVE_ANNOUNCE_PR_OPEN: "0" }),
        alreadySent: async () => false,
        markSent: async () => undefined,
        postWebhook,
      }
    );
    expect(result.skipped).toBe("pr_open_disabled");
    expect(postWebhook).not.toHaveBeenCalled();
  });

  it("complete disabled sends nothing", async () => {
    const postWebhook = vi.fn();
    const result = await announceGoLiveEvent(
      {
        kind: "task.completed",
        actor: "cursor",
        taskId: "TASK-1454",
        payload: { checkoutId: "dsp_mtrj5s9mn2ilbt" },
      },
      {
        loadConfig: () => enabledConfig({ MC_GO_LIVE_ANNOUNCE_COMPLETE: "0" }),
        alreadySent: async () => false,
        markSent: async () => undefined,
        postWebhook,
      }
    );
    expect(result.skipped).toBe("complete_disabled");
    expect(postWebhook).not.toHaveBeenCalled();
  });

  it("dry-run sends nothing", async () => {
    const postWebhook = vi.fn();
    const result = await announceGoLiveEvent(checkoutEvent(), {
      loadConfig: () => enabledConfig({ MC_GO_LIVE_ANNOUNCER_DRY_RUN: "1" }),
      loadTitle: async () => "title",
      alreadySent: async () => false,
      markSent: async () => undefined,
      postWebhook,
    });
    expect(result.skipped).toBe("dry_run");
    expect(postWebhook).not.toHaveBeenCalled();
  });

  it("missing webhook fails closed", () => {
    expect(configBlocksSend(enabledConfig({ MC_GO_LIVE_TEAMS_WORKFLOW_URL: "" }))).toBe(
      "missing_webhook"
    );
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
        alreadySent: async () => false,
        markSent: async () => undefined,
        postWebhook,
      }
    );
    expect(result.skipped).toBe("unexpected_kind");
    expect(postWebhook).not.toHaveBeenCalled();
  });
});

describe("go-live send + dedup", () => {
  it("sends a valid checkout once", async () => {
    const postWebhook = vi.fn(async () => ({
      ok: true,
      status: 202,
      receiptId: "run-checkout-1",
      retryable: false,
      permanentAuth: false,
    }));
    const markSent = vi.fn();
    const result = await announceGoLiveEvent(checkoutEvent(), {
      loadConfig: () => enabledConfig(),
      loadTitle: async () => "Outbound Teams announcer",
      alreadySent: async () => false,
      markSent,
      postWebhook,
    });
    expect(result.sent).toBe(true);
    expect(result.line).toBe("cursor claimed TASK-1454 (Outbound Teams announcer)");
    expect(result.receiptId).toBe("run-checkout-1");
    expect(postWebhook).toHaveBeenCalledTimes(1);
    expect(markSent).toHaveBeenCalledWith("checkout:dsp_mtrj5s9mn2ilbt", "run-checkout-1");
  });

  it("sends a valid PR-open once", async () => {
    const postWebhook = vi.fn(async () => ({
      ok: true,
      status: 202,
      receiptId: "run-pr-1",
      retryable: false,
      permanentAuth: false,
    }));
    const result = await announceGoLiveEvent(
      {
        kind: "pr.opened",
        actor: "cursor",
        repo: "petralabx/PLX_MC",
        taskId: "TASK-1454",
        pr: "231",
      },
      {
        loadConfig: () => enabledConfig(),
        alreadySent: async () => false,
        markSent: async () => undefined,
        postWebhook,
      }
    );
    expect(result.sent).toBe(true);
    expect(result.line).toBe("PR opened for TASK-1454: https://github.com/petralabx/PLX_MC/pull/231");
    expect(result.receiptId).toBe("run-pr-1");
  });

  it("sends a valid completion once", async () => {
    const postWebhook = vi.fn(async () => ({
      ok: true,
      status: 202,
      receiptId: "run-complete-1",
      retryable: false,
      permanentAuth: false,
    }));
    const result = await announceGoLiveEvent(
      {
        kind: "task.completed",
        actor: "cursor",
        taskId: "TASK-1454",
        payload: { checkoutId: "dsp_mtrj5s9mn2ilbt" },
      },
      {
        loadConfig: () => enabledConfig(),
        alreadySent: async () => false,
        markSent: async () => undefined,
        postWebhook,
      }
    );
    expect(result.sent).toBe(true);
    expect(result.line).toBe("TASK-1454 complete");
    expect(result.receiptId).toBe("run-complete-1");
  });

  it("duplicate event ID produces no second post", async () => {
    const postWebhook = vi.fn();
    const result = await announceGoLiveEvent(checkoutEvent(), {
      loadConfig: () => enabledConfig(),
      loadTitle: async () => "title",
      alreadySent: async () => true,
      markSent: async () => undefined,
      postWebhook,
    });
    expect(result.skipped).toBe("duplicate");
    expect(postWebhook).not.toHaveBeenCalled();
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
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        receiptId: "run-retry",
        retryable: false,
        permanentAuth: false,
      });
    const result = await announceGoLiveEvent(checkoutEvent(), {
      loadConfig: () => enabledConfig(),
      loadTitle: async () => "title",
      alreadySent: async () => false,
      markSent: async () => undefined,
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
      alreadySent: async () => false,
      markSent: async () => undefined,
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

  it("builds checkout event IDs from the checkout credential", () => {
    expect(eventIdFor(checkoutEvent())).toBe("checkout:dsp_mtrj5s9mn2ilbt");
  });

  it("builds PR-open event IDs from a bare stored slug", () => {
    expect(
      eventIdFor({
        kind: "pr.opened",
        actor: "cursor",
        repo: "plx-customer-portal",
        taskId: "TASK-1454",
        pr: "232",
      })
    ).toBe("pr.opened:plx-customer-portal:232");
  });

  it("sends a PR-open announce when mc_events stored a bare slug", async () => {
    const postWebhook = vi.fn(async () => ({
      ok: true,
      status: 202,
      receiptId: "run-pr-bare",
      retryable: false,
      permanentAuth: false,
    }));
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
        alreadySent: async () => false,
        markSent: async () => undefined,
        postWebhook,
      }
    );
    expect(result.sent).toBe(true);
    expect(result.line).toBe(
      "PR opened for TASK-1524: https://github.com/petralabx/plx-customer-portal/pull/240"
    );
    expect(postWebhook).toHaveBeenCalledTimes(1);
  });

  it("fans out to the optional chat Workflow when set", async () => {
    const postWebhook = vi.fn(async () => ({
      ok: true,
      status: 202,
      receiptId: "run-fanout",
      retryable: false,
      permanentAuth: false,
    }));
    const result = await announceGoLiveEvent(checkoutEvent(), {
      loadConfig: () =>
        enabledConfig({
          MC_GO_LIVE_TEAMS_CHAT_WORKFLOW_URL: "https://example.invalid/chat",
        }),
      loadTitle: async () => "Outbound Teams announcer",
      alreadySent: async () => false,
      markSent: async () => undefined,
      postWebhook,
    });
    expect(result.sent).toBe(true);
    expect(postWebhook).toHaveBeenCalledTimes(2);
    expect(postWebhook).toHaveBeenCalledWith(
      "https://example.invalid/workflow",
      "cursor claimed TASK-1454 (Outbound Teams announcer)"
    );
    expect(postWebhook).toHaveBeenCalledWith(
      "https://example.invalid/chat",
      "cursor claimed TASK-1454 (Outbound Teams announcer)"
    );
  });

  it("marks announce.sent when channel succeeds even if chat fails", async () => {
    const postWebhook = vi.fn(async (url: string) => {
      if (url === "https://example.invalid/chat") {
        return {
          ok: false,
          status: 400,
          receiptId: "http-400",
          retryable: false,
          permanentAuth: false,
        };
      }
      return {
        ok: true,
        status: 202,
        receiptId: "run-channel",
        retryable: false,
        permanentAuth: false,
      };
    });
    const markSent = vi.fn();
    const result = await announceGoLiveEvent(checkoutEvent(), {
      loadConfig: () =>
        enabledConfig({
          MC_GO_LIVE_TEAMS_CHAT_WORKFLOW_URL: "https://example.invalid/chat",
        }),
      loadTitle: async () => "title",
      alreadySent: async () => false,
      markSent,
      postWebhook,
    });
    expect(result.sent).toBe(true);
    expect(result.receiptId).toBe("run-channel");
    expect(markSent).toHaveBeenCalledWith("checkout:dsp_mtrj5s9mn2ilbt", "run-channel");
    expect(postWebhook).toHaveBeenCalledTimes(2);
  });

  it("does not mark announce.sent when channel fails even if chat succeeds", async () => {
    const postWebhook = vi.fn(async (url: string) => {
      if (url === "https://example.invalid/workflow") {
        return {
          ok: false,
          status: 503,
          receiptId: "http-503",
          retryable: false,
          permanentAuth: false,
        };
      }
      return {
        ok: true,
        status: 202,
        receiptId: "run-chat",
        retryable: false,
        permanentAuth: false,
      };
    });
    const markSent = vi.fn();
    const result = await announceGoLiveEvent(checkoutEvent(), {
      loadConfig: () =>
        enabledConfig({
          MC_GO_LIVE_TEAMS_CHAT_WORKFLOW_URL: "https://example.invalid/chat",
        }),
      loadTitle: async () => "title",
      alreadySent: async () => false,
      markSent,
      postWebhook,
      sleep: async () => undefined,
    });
    expect(result.sent).toBe(false);
    expect(result.skipped).toBe("send_failed");
    expect(markSent).not.toHaveBeenCalled();
    expect(postWebhook).toHaveBeenCalledTimes(2);
  });

  it("still marks channel success when the chat dest throws", async () => {
    const postWebhook = vi.fn(async (url: string) => {
      if (url === "https://example.invalid/chat") {
        throw new Error("network");
      }
      return {
        ok: true,
        status: 202,
        receiptId: "run-channel-throw",
        retryable: false,
        permanentAuth: false,
      };
    });
    const markSent = vi.fn();
    const result = await announceGoLiveEvent(checkoutEvent(), {
      loadConfig: () =>
        enabledConfig({
          MC_GO_LIVE_TEAMS_CHAT_WORKFLOW_URL: "https://example.invalid/chat",
        }),
      loadTitle: async () => "title",
      alreadySent: async () => false,
      markSent,
      postWebhook,
    });
    expect(result.sent).toBe(true);
    expect(markSent).toHaveBeenCalledWith("checkout:dsp_mtrj5s9mn2ilbt", "run-channel-throw");
  });

  it("skips a malformed chat Workflow URL without blocking the channel", async () => {
    const postWebhook = vi.fn(async () => ({
      ok: true,
      status: 202,
      receiptId: "run-channel-only",
      retryable: false,
      permanentAuth: false,
    }));
    const result = await announceGoLiveEvent(checkoutEvent(), {
      loadConfig: () =>
        enabledConfig({
          MC_GO_LIVE_TEAMS_CHAT_WORKFLOW_URL: "http://example.invalid/chat",
        }),
      loadTitle: async () => "title",
      alreadySent: async () => false,
      markSent: async () => undefined,
      postWebhook,
    });
    expect(result.sent).toBe(true);
    expect(postWebhook).toHaveBeenCalledTimes(1);
    expect(postWebhook).toHaveBeenCalledWith("https://example.invalid/workflow", expect.any(String));
  });
});
