// D15 (TASK-3863): actionCheckout refuses a checkout for a new PR in a full
// portal lane, before any checkout is minted; warn mode and unread caps proceed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkout: vi.fn(async () => ({ checkoutId: "dsp_test", accountablePerson: "vince@petrasoap.com" })),
  checkoutLaneCap: vi.fn(),
}));

vi.mock("@/lib/compliance/service", () => ({
  checkout: mocks.checkout,
  complete: vi.fn(),
}));

vi.mock("@/lib/mcp/sync-meta", () => ({
  syncMetaForTask: vi.fn(async () => ({ status: "queued" })),
}));

vi.mock("@/lib/sync/repo", () => ({
  getEntity: vi.fn(async () => ({ data: { id: "TASK-3863", bucket: "BKT-OPEN" } })),
  getBuckets: vi.fn(async () => [{ id: "BKT-OPEN", project: null }]),
  getProjects: vi.fn(async () => []),
}));

vi.mock("@/lib/routing/mutations/actors", () => ({
  requireMcpActor: vi.fn(),
  aclPrincipalFromMcp: () => ({ tokens: ["sp_mcp_claude_code"] }),
}));

vi.mock("@/lib/mcp/checkout-lane-cap", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mcp/checkout-lane-cap")>()),
  checkoutLaneCap: mocks.checkoutLaneCap,
}));

import { ApiError } from "@/lib/api/route";
import { actionCheckout } from "@/lib/mcp/actions";
import type { McpIdentity } from "@/lib/mcp/auth";

const portal: McpIdentity = {
  operatorEmail: "vince@petrasoap.com",
  runtime: "claude-code",
  workerId: "w1",
  repo: "petralabx/plx-customer-portal",
  servicePrincipalId: "sp_mcp_claude_code",
  actor: { kind: "service", id: "sp_mcp_claude_code", status: "active" },
};
const FULL = { status: "blocked", lane: "claude", cap: 20, openCount: 20, openPrs: [2910, 2936] } as const;
const savedMode = process.env.PLX_MC_LANE_CAP_CHECKOUT;

beforeEach(() => {
  mocks.checkout.mockClear();
  mocks.checkoutLaneCap.mockReset();
  delete process.env.PLX_MC_LANE_CAP_CHECKOUT;
});
afterEach(() => {
  if (savedMode === undefined) delete process.env.PLX_MC_LANE_CAP_CHECKOUT;
  else process.env.PLX_MC_LANE_CAP_CHECKOUT = savedMode;
});

describe("actionCheckout lane cap (D15)", () => {
  it("refuses a full lane with lane_cap_full (409) and mints no checkout", async () => {
    mocks.checkoutLaneCap.mockResolvedValue(FULL);
    const err = await actionCheckout(portal, "TASK-3863", { agent: "claude-code/claude-code", branch: "claude/new" }).catch(
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("lane_cap_full");
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).message).toMatch(/Lane claude is full: 20 open PRs against its cap of 20 \(#2910, #2936\)/);
    expect(mocks.checkoutLaneCap).toHaveBeenCalledWith({ repo: "petralabx/plx-customer-portal", branch: "claude/new" });
    expect(mocks.checkout).not.toHaveBeenCalled();
  });

  it("warn mode checks out and reports the full lane", async () => {
    process.env.PLX_MC_LANE_CAP_CHECKOUT = "warn";
    mocks.checkoutLaneCap.mockResolvedValue(FULL);
    const data = await actionCheckout(portal, "TASK-3863", { agent: "claude-code/claude-code", branch: "claude/new" });
    expect(mocks.checkout).toHaveBeenCalledTimes(1);
    expect(data.laneCap).toEqual(FULL);
    expect(data.warnings?.join("\n")).toMatch(/^lane_cap_full \(warn mode\): Lane claude is full/m);
  });

  it("a lane under its cap checks out and shows the count", async () => {
    mocks.checkoutLaneCap.mockResolvedValue({ status: "proceed", lane: "claude", cap: 20, openCount: 17, openPrs: [] });
    const data = await actionCheckout(portal, "TASK-3863", { agent: "claude-code/claude-code", branch: "claude/new" });
    expect(mocks.checkout).toHaveBeenCalledTimes(1);
    expect(data.prBodyLine).toBe("MC-Checkout: dsp_test");
    expect(data.laneCap).toMatchObject({ status: "proceed", openCount: 17 });
    expect(data.warnings).toBeUndefined();
  });

  it("an unverified cap checks out with a warning (fail open)", async () => {
    mocks.checkoutLaneCap.mockResolvedValue({ status: "unverified", reason: "no_branch" });
    const noBranch = await actionCheckout(portal, "TASK-3863", { agent: "claude-code/claude-code" });
    expect(noBranch.warnings).toEqual(["lane_cap_unverified: pass branch (the PR head branch) so the portal lane cap can be checked."]);
    mocks.checkoutLaneCap.mockResolvedValue({ status: "unverified", reason: "pulls_http_502" });
    const down = await actionCheckout(portal, "TASK-3863", { agent: "claude-code/claude-code", branch: "claude/new" });
    expect(down.warnings?.[0]).toMatch(/could not be read \(pulls_http_502\); the checkout proceeds/);
    expect(mocks.checkout).toHaveBeenCalledTimes(2);
  });

  it("other repos carry no laneCap field", async () => {
    mocks.checkoutLaneCap.mockResolvedValue(null);
    const data = await actionCheckout({ ...portal, repo: "petralabx/PLX_MC" }, "TASK-3863", { agent: "claude-code/claude-code" });
    expect("laneCap" in data).toBe(false);
    expect(mocks.checkout).toHaveBeenCalledTimes(1);
  });
});
