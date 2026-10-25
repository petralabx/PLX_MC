// D15 (TASK-3863): the checkout's lane-cap check follows the portal's own gate
// (scripts/lib/lane-pr-cap.mjs) and fails open when it cannot read GitHub.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkoutLaneCap,
  evaluateLaneCap,
  laneCapFor,
  laneCapRefusal,
  laneOfBranch,
  parseLaneCapSource,
  resetLaneCapCacheForTests,
  torontoDate,
  type OpenPull,
} from "@/lib/mcp/checkout-lane-cap";

// The shape of the portal's scripts/lib/lane-pr-cap.mjs on 2026-10-25.
const PORTAL_SOURCE = `export const LANE_CAP = 3;

/**
 * Temporary per-lane cap raises.
 */
export const LANE_CAP_TIMEZONE = "America/Toronto";
export const TEMP_LANE_CAP_RAISES = Object.freeze({
  claude: Object.freeze({
    cap: 20,
    throughTorontoDate: "2026-11-15",
    reason: "Vince 2026-10-25 11:27 ET (Claude Code session): claude lane cap 20 extended through 2026-11-15",
  }),
  task: Object.freeze({
    cap: 8,
    throughTorontoDate: "2026-11-15",
    reason: "Vince 2026-10-25 11:27 ET (Claude Code session): task lane cap 8 extended through 2026-11-15",
  }),
  cip: Object.freeze({
    cap: 8,
    throughTorontoDate: "2026-10-30",
    reason: "Vince (via CoS) 2026-10-21 10:18 ET: cip lane cap 3 -> 8 through 2026-10-30 for go-live",
  }),
});

export const EXCLUDED_AUTHOR = "ricardopetra";
export const DEFAULT_REPO = "petralabx/plx-customer-portal";
`;

const SOURCE = parseLaneCapSource(PORTAL_SOURCE)!;
const DURING = new Date("2026-11-16T04:59:59Z"); // 23:59:59 EST 2026-11-15, last second of the claude raise
const AFTER = new Date("2026-11-16T05:00:00Z"); // 00:00 EST 2026-11-16

const pull = (number: number, headRef: string, extra: Partial<OpenPull> = {}): OpenPull => ({
  number,
  headRef,
  author: "taylorvalton",
  draft: false,
  ...extra,
});
const claudePulls = (n: number) => Array.from({ length: n }, (_, i) => pull(100 + i, `claude/work-${i}`));

describe("lane and cap rules (same as the portal's lane-pr-cap.mjs)", () => {
  it("maps head branches to the portal lanes", () => {
    expect(laneOfBranch("claude/intelligent-wozniak-oe7nwe")).toBe("claude");
    expect(laneOfBranch("task/TASK-3863-v2")).toBe("task");
    expect(laneOfBranch("cip/sop-assembly-20261025")).toBe("cip");
    expect(laneOfBranch("cursor/map-hubs")).toBe("feature-map");
    expect(laneOfBranch("cursor/verify-portal-nav")).toBe("feature-map");
    expect(laneOfBranch("harness/feature-map-rolling")).toBe("feature-map");
    expect(laneOfBranch("cursor/uat-fix")).toBeNull();
    expect(laneOfBranch("feat/x")).toBeNull();
  });

  it("parses the base cap, the dated raises and the excluded author", () => {
    expect(SOURCE).toEqual({
      baseCap: 3,
      raises: {
        claude: { cap: 20, throughTorontoDate: "2026-11-15" },
        task: { cap: 8, throughTorontoDate: "2026-11-15" },
        cip: { cap: 8, throughTorontoDate: "2026-10-30" },
      },
      excludedAuthor: "ricardopetra",
    });
  });

  it("returns null when the file changes shape, instead of guessing", () => {
    expect(parseLaneCapSource(PORTAL_SOURCE.replace("export const LANE_CAP = 3;", "export const LANE_CAP = BASE;"))).toBeNull();
    expect(parseLaneCapSource(PORTAL_SOURCE.replace('export const EXCLUDED_AUTHOR = "ricardopetra";', ""))).toBeNull();
    // A raise entry this parser cannot read is a failure, not a silent skip.
    expect(parseLaneCapSource(PORTAL_SOURCE.replace("cap: 8,\n    throughTorontoDate: \"2026-10-30\"", "cap: TASK_CAP,\n    throughTorontoDate: \"2026-10-30\""))).toBeNull();
    expect(parseLaneCapSource("<html>Not Found</html>")).toBeNull();
  });

  it("a file with no raises parses to the base cap", () => {
    const none = PORTAL_SOURCE.replace(/export const TEMP_LANE_CAP_RAISES = [\s\S]*?\n\}\);\n/, "");
    expect(parseLaneCapSource(none)).toEqual({ baseCap: 3, raises: {}, excludedAuthor: "ricardopetra" });
  });

  it("a raise applies through its last Toronto day, then the base cap returns", () => {
    expect(torontoDate(DURING)).toBe("2026-11-15");
    expect(torontoDate(AFTER)).toBe("2026-11-16");
    expect(torontoDate(new Date("invalid"))).toBeNull();
    expect(laneCapFor("claude", DURING, SOURCE)).toBe(20);
    expect(laneCapFor("claude", AFTER, SOURCE)).toBe(3);
    expect(laneCapFor("cip", new Date("2026-10-31T03:59:59Z"), SOURCE)).toBe(8); // 23:59:59 EDT 2026-10-30
    expect(laneCapFor("cip", new Date("2026-10-31T04:00:00Z"), SOURCE)).toBe(3);
    expect(laneCapFor("feature-map", DURING, SOURCE)).toBe(3);
    expect(laneCapFor("claude", new Date("invalid"), SOURCE)).toBe(3);
  });
});

describe("evaluateLaneCap", () => {
  it("blocks a new PR when the lane already holds its cap", () => {
    const r = evaluateLaneCap({ branch: "claude/new", pulls: claudePulls(20), source: SOURCE, now: DURING });
    expect(r).toMatchObject({ status: "blocked", lane: "claude", cap: 20, openCount: 20 });
    if (r.status !== "blocked") throw new Error("expected blocked");
    expect(r.openPrs[0]).toBe(100);
    expect(laneCapRefusal(r)).toMatch(/^Lane claude is full: 20 open PRs against its cap of 20 \(#100, #101/);
  });

  it("lets a new PR in one below the cap, and blocks at the base cap once the raise ends", () => {
    expect(evaluateLaneCap({ branch: "claude/new", pulls: claudePulls(19), source: SOURCE, now: DURING })).toMatchObject({
      status: "proceed",
      cap: 20,
      openCount: 19,
    });
    expect(evaluateLaneCap({ branch: "claude/new", pulls: claudePulls(3), source: SOURCE, now: AFTER })).toMatchObject({
      status: "blocked",
      cap: 3,
    });
  });

  it("does not count drafts, the excluded author or other lanes", () => {
    const pulls = [
      ...claudePulls(2),
      pull(200, "claude/draft", { draft: true }),
      pull(201, "claude/rp", { author: "RicardoPetra" }),
      pull(202, "task/TASK-1"),
      pull(203, "cursor/map-x"),
    ];
    expect(evaluateLaneCap({ branch: "claude/new", pulls, source: SOURCE, now: AFTER })).toMatchObject({
      status: "proceed",
      cap: 3,
      openCount: 2,
      openPrs: [100, 101],
    });
  });

  it("a branch that already has an open PR always passes, even in a full lane", () => {
    const pulls = [...claudePulls(20), pull(300, "claude/mine")];
    expect(evaluateLaneCap({ branch: "claude/mine", pulls, source: SOURCE, now: DURING })).toEqual({
      status: "existing_pr",
      lane: "claude",
      pr: 300,
    });
  });

  it("a branch outside the capped lanes is uncharted", () => {
    expect(evaluateLaneCap({ branch: "feat/x", pulls: claudePulls(20), source: SOURCE, now: DURING })).toEqual({
      status: "uncharted",
      branch: "feat/x",
    });
  });
});

describe("checkoutLaneCap (GitHub reads, cache, fail-open)", () => {
  const PORTAL = "petralabx/plx-customer-portal";
  const rows = (pulls: OpenPull[]) =>
    pulls.map((p) => ({ number: p.number, head: { ref: p.headRef }, user: { login: p.author }, draft: p.draft }));
  function github(opts: { source?: Response; pulls?: Response } = {}) {
    return vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("/contents/scripts/lib/lane-pr-cap.mjs?ref=staging")) {
        return opts.source ?? new Response(PORTAL_SOURCE, { status: 200 });
      }
      if (u.includes(`/repos/${PORTAL}/pulls?state=open`)) {
        return opts.pulls ?? new Response(JSON.stringify(rows(claudePulls(20))), { status: 200 });
      }
      return new Response("unexpected", { status: 500 });
    });
  }
  const deps = (fetchImpl: ReturnType<typeof github>, token: string | null = "t0ken") => ({
    fetchImpl: fetchImpl as unknown as typeof fetch,
    resolveToken: vi.fn(async () => token),
    now: () => DURING,
  });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const savedMode = process.env.PLX_MC_LANE_CAP_CHECKOUT;

  beforeEach(() => {
    resetLaneCapCacheForTests();
    warn.mockClear();
    delete process.env.PLX_MC_LANE_CAP_CHECKOUT;
  });
  afterEach(() => {
    if (savedMode === undefined) delete process.env.PLX_MC_LANE_CAP_CHECKOUT;
    else process.env.PLX_MC_LANE_CAP_CHECKOUT = savedMode;
  });

  it("does not apply to other repos, or when the kill switch is off", async () => {
    const f = github();
    expect(await checkoutLaneCap({ repo: "petralabx/PLX_MC", branch: "claude/new" }, deps(f))).toBeNull();
    process.env.PLX_MC_LANE_CAP_CHECKOUT = "off";
    expect(await checkoutLaneCap({ repo: PORTAL, branch: "claude/new" }, deps(f))).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("without a branch, or outside the capped lanes, it reads nothing", async () => {
    const f = github();
    expect(await checkoutLaneCap({ repo: PORTAL }, deps(f))).toEqual({ status: "unverified", reason: "no_branch" });
    expect(await checkoutLaneCap({ repo: PORTAL, branch: "feat/x" }, deps(f))).toEqual({ status: "uncharted", branch: "feat/x" });
    expect(f).not.toHaveBeenCalled();
  });

  it("blocks from the live cap file and open PRs, then serves both from cache", async () => {
    const f = github();
    expect(await checkoutLaneCap({ repo: PORTAL, branch: "claude/new" }, deps(f))).toMatchObject({
      status: "blocked",
      cap: 20,
      openCount: 20,
    });
    expect(await checkoutLaneCap({ repo: "PETRALABX/plx-customer-portal", branch: "claude/other" }, deps(f))).toMatchObject({
      status: "blocked",
    });
    expect(f).toHaveBeenCalledTimes(2); // one cap file read and one PR list page, not four
  });

  it("fails open with a logged warning when GitHub cannot be read", async () => {
    const branch = { repo: PORTAL, branch: "claude/new" };
    expect(await checkoutLaneCap(branch, deps(github(), null))).toEqual({ status: "unverified", reason: "token_unconfigured" });
    resetLaneCapCacheForTests();
    expect(await checkoutLaneCap(branch, deps(github({ source: new Response("nope", { status: 404 }) })))).toEqual({
      status: "unverified",
      reason: "cap_source_http_404",
    });
    resetLaneCapCacheForTests();
    expect(await checkoutLaneCap(branch, deps(github({ source: new Response("<html/>", { status: 200 }) })))).toEqual({
      status: "unverified",
      reason: "cap_source_unparsed",
    });
    resetLaneCapCacheForTests();
    expect(await checkoutLaneCap(branch, deps(github({ pulls: new Response("{}", { status: 500 }) })))).toEqual({
      status: "unverified",
      reason: "pulls_http_500",
    });
    resetLaneCapCacheForTests();
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await checkoutLaneCap(branch, deps(down as unknown as ReturnType<typeof github>))).toEqual({
      status: "unverified",
      reason: "github_unreachable",
    });
    expect(warn).toHaveBeenCalledTimes(5);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("t0ken");
  });
});
