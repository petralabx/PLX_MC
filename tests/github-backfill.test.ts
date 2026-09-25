// Nightly GitHub backfill — merged PRs with no MC task link, per registry repo.
// Hermetic: the GitHub client, dispatch lookup and task prs[] linkage are all
// injected stubs; the cron route test mocks the secrets accessors and the
// default-deps wiring. No network, no database.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  BACKFILL_EVENT_KIND,
  createGithubPullsClient,
  GithubPullsError,
  parseBackfillDays,
  prLinkKeys,
  recordBackfillReport,
  runGithubBackfill,
  type BackfillDeps,
  type GithubPullsClient,
} from "@/lib/compliance/backfill";
import type { DispatchRow } from "@/lib/compliance/repo";

const NOW = new Date("2026-09-25T06:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

interface RawPr {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  merged_at: string | null;
  updated_at: string;
  user: { login: string };
  head: { sha: string; ref: string };
  base: { ref: string };
  labels: Array<{ name: string }>;
  merge_commit_sha: string | null;
}

function pr(repo: string, number: number, partial: Partial<RawPr> = {}): RawPr {
  const mergedAt = partial.merged_at === undefined ? daysAgo(1) : partial.merged_at;
  return {
    number,
    title: `PR ${number}`,
    body: "",
    html_url: `https://github.com/${repo}/pull/${number}`,
    merged_at: mergedAt,
    updated_at: partial.updated_at ?? mergedAt ?? daysAgo(1),
    user: { login: "octo" },
    head: { sha: `sha${number}`, ref: `feat/${number}` },
    base: { ref: "main" },
    labels: [],
    merge_commit_sha: mergedAt ? `merge${number}` : null,
    ...partial,
  };
}

function dispatch(id: string, repo: string, taskId = "TASK-1"): DispatchRow {
  return {
    id,
    actorKind: "agent",
    runtime: "claude-code",
    taskId,
    accountableHuman: "vince@petrasoap.com",
    repo,
    revoked: false,
    // Long expired — attribution is historical, TTL does not matter here.
    expiresAt: "2026-01-01T00:00:00.000Z",
  };
}

function stubGithub(pages: Record<string, unknown[][] | Error>): GithubPullsClient & {
  calls: Array<[string, number]>;
} {
  const calls: Array<[string, number]> = [];
  return {
    calls,
    async listClosedPulls(repo, page) {
      calls.push([repo, page]);
      const entry = pages[repo];
      if (entry instanceof Error) throw entry;
      return entry?.[page - 1] ?? [];
    },
  };
}

function deps(
  github: GithubPullsClient,
  dispatches: DispatchRow[] = [],
  linked: string[] = []
): BackfillDeps {
  return {
    github,
    getDispatch: async (id) => dispatches.find((d) => d.id === id) ?? null,
    linkedPrKeys: async () => new Set(linked),
    now: () => NOW,
  };
}

const PLX = "petralabx/PLX_MC";
const PORTAL = "petralabx/plx-customer-portal";

describe("runGithubBackfill", () => {
  it("reports merged PRs with no resolvable stamp and no prs[] link, per repo", async () => {
    const github = stubGithub({
      [PLX]: [
        [
          pr(PLX, 1, { body: "Summary\n\nMC-Checkout: dsp_good1\n" }), // stamped → attributed
          pr(PLX, 2, { body: "no stamp here", title: "Unlinked fix" }), // → no_stamp
          pr(PLX, 3, { body: "" }), // linked via a task's prs[] → attributed
          pr(PLX, 4, { body: "MC-Checkout: dsp_otherrepo" }), // stamp bound to portal → unresolved
          pr(PLX, 5, { body: "MC-Checkout: dsp_missing" }), // stamp not in the ledger → unresolved
          pr(PLX, 6, { merged_at: null, updated_at: daysAgo(1) }), // closed, not merged → excluded
          pr(PLX, 7, { merged_at: daysAgo(12), updated_at: daysAgo(2) }), // merged before window → excluded
        ],
      ],
      [PORTAL]: new GithubPullsError("permission_denied", "GitHub pulls list failed (HTTP 403)"),
    });
    const report = await runGithubBackfill(
      deps(github, [dispatch("dsp_good1", PLX), dispatch("dsp_otherrepo", PORTAL)], ["plx_mc#3"]),
      { days: 7, repos: [PLX, PORTAL] }
    );

    expect(report.windowDays).toBe(7);
    expect(report.since).toBe(daysAgo(7));
    expect(report.generatedAt).toBe(NOW.toISOString());

    const plx = report.repos.find((r) => r.repo === PLX)!;
    expect(plx.status).toBe("ok");
    expect(plx.merged).toBe(5);
    expect(plx.attributed).toBe(2);
    expect(plx.unattributedCount).toBe(3);
    expect(plx.unattributed.map((u) => [u.number, u.reason])).toEqual([
      [2, "no_stamp"],
      [4, "stamp_unresolved"],
      [5, "stamp_unresolved"],
    ]);
    expect(plx.unattributed[0]).toMatchObject({
      title: "Unlinked fix",
      url: "https://github.com/petralabx/PLX_MC/pull/2",
      author: "octo",
    });

    // One repo failing never fails the run — it is visibly degraded.
    const portal = report.repos.find((r) => r.repo === PORTAL)!;
    expect(portal).toMatchObject({ status: "degraded", reason: "permission_denied", merged: 0 });

    expect(report.totals).toEqual({ merged: 5, unattributed: 3, degraded: 1 });
    // PR bodies are parsed in memory only — never carried into the report.
    expect(JSON.stringify(report)).not.toContain("no stamp here");
    expect(JSON.stringify(report)).not.toContain("Summary");
  });

  it("covers every registry repo by default (incl. plx_secondbrain)", async () => {
    const github = stubGithub({});
    const report = await runGithubBackfill(deps(github));
    expect(report.repos.map((r) => r.repo)).toContain("petralabx/plx_secondbrain");
    expect(report.repos).toHaveLength(10);
    expect(report.totals).toEqual({ merged: 0, unattributed: 0, degraded: 0 });
  });

  it("pages until the updated-desc listing falls behind the window", async () => {
    const page1 = Array.from({ length: 3 }, (_, i) => pr(PLX, 10 + i));
    const page2 = [pr(PLX, 20), pr(PLX, 21, { merged_at: daysAgo(20), updated_at: daysAgo(9) })];
    const page3 = [pr(PLX, 30)];
    const github = stubGithub({ [PLX]: [page1, page2, page3] });
    const report = await runGithubBackfill(deps(github), { days: 7, repos: [PLX] });
    expect(github.calls).toEqual([
      [PLX, 1],
      [PLX, 2],
    ]);
    expect(report.repos[0].merged).toBe(4);
    expect(report.repos[0].truncated).toBe(false);
  });

  it("revoked dispatches do not attribute", async () => {
    const github = stubGithub({ [PLX]: [[pr(PLX, 1, { body: "MC-Checkout: dsp_revoked" })]] });
    const revoked = { ...dispatch("dsp_revoked", PLX), revoked: true };
    const report = await runGithubBackfill(deps(github, [revoked]), { repos: [PLX] });
    expect(report.repos[0].unattributed.map((u) => u.reason)).toEqual(["stamp_unresolved"]);
  });
});

describe("prLinkKeys", () => {
  it("keys task prs[] by bare GitHub name, resolving MC registry ids", () => {
    const keys = prLinkKeys(
      [
        { prs: [{ repo: "portal-web", num: 12, status: "merged", title: "a" }] },
        { prs: [{ repo: "PLX_MC", num: 7, status: "merged", title: "b" }] },
        { prs: undefined },
      ],
      [
        { id: "portal-web", name: "plx-customer-portal" },
        { id: "plx-mc", name: "PLX_MC" },
      ]
    );
    expect([...keys].sort()).toEqual(["plx-customer-portal#12", "plx_mc#7"]);
  });
});

describe("parseBackfillDays", () => {
  it("defaults to 7 and clamps to 1..30", () => {
    expect(parseBackfillDays(null)).toBe(7);
    expect(parseBackfillDays("garbage")).toBe(7);
    expect(parseBackfillDays("0")).toBe(1);
    expect(parseBackfillDays("3")).toBe(3);
    expect(parseBackfillDays("365")).toBe(30);
  });
});

describe("createGithubPullsClient", () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it("lists closed PRs updated-desc with the shared token and GitHub headers", async () => {
    const fetchImpl = vi.fn(async () => ok([{ number: 1 }]));
    const resolveToken = vi.fn(async () => "tkn");
    const client = createGithubPullsClient({ fetchImpl, resolveToken });
    await expect(client.listClosedPulls(PLX, 2)).resolves.toEqual([{ number: 1 }]);
    expect(resolveToken).toHaveBeenCalledWith({ repoOwner: "petralabx" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://api.github.com/repos/petralabx/PLX_MC/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=2"
    );
    expect(init.headers).toMatchObject({ authorization: "Bearer tkn" });
  });

  it("fails as token_unconfigured without calling GitHub when no token resolves", async () => {
    const fetchImpl = vi.fn();
    const client = createGithubPullsClient({ fetchImpl, resolveToken: async () => null });
    await expect(client.listClosedPulls(PLX, 1)).rejects.toMatchObject({
      reason: "token_unconfigured",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps HTTP failures to distinct degraded reasons", async () => {
    const cases: Array<[Response, string]> = [
      [new Response("{}", { status: 404 }), "not_found"],
      [new Response("{}", { status: 401 }), "permission_denied"],
      [new Response("{}", { status: 403 }), "permission_denied"],
      [new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0" } }), "rate_limit"],
      [new Response("{}", { status: 429 }), "rate_limit"],
      [new Response("{}", { status: 502 }), "network_error"],
    ];
    for (const [res, reason] of cases) {
      const client = createGithubPullsClient({
        fetchImpl: async () => res,
        resolveToken: async () => "tkn",
      });
      await expect(client.listClosedPulls(PLX, 1)).rejects.toMatchObject({ reason });
    }
  });
});

describe("recordBackfillReport", () => {
  it("appends one github.backfill.report event with the report payload", async () => {
    const append = vi.fn(async () => undefined);
    const report = await runGithubBackfill(deps(stubGithub({})), { repos: [PLX] });
    await recordBackfillReport(report, append);
    expect(append).toHaveBeenCalledWith({
      kind: BACKFILL_EVENT_KIND,
      actor: "github-backfill",
      payload: report,
    });
  });
});

describe("vercel cron registration", () => {
  it("schedules the backfill nightly", () => {
    const vercel = JSON.parse(readFileSync(join(import.meta.dirname, "..", "vercel.json"), "utf8")) as {
      crons: Array<{ path: string; schedule: string }>;
    };
    const entry = vercel.crons.find((c) => c.path === "/api/cron/github-backfill");
    expect(entry).toBeDefined();
    // Once a day: fixed minute + hour, every day.
    expect(entry!.schedule).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/);
  });
});

// ─── Cron route: auth boundary + kill switch + fail-open record ─────────────

const m = vi.hoisted(() => ({
  cronConfigured: vi.fn(),
  cronSecret: vi.fn(),
  githubBackfillEnabled: vi.fn(),
  listClosedPulls: vi.fn(),
  append: vi.fn(),
}));

vi.mock("@/lib/secrets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/secrets")>()),
  cronConfigured: m.cronConfigured,
  cronSecret: m.cronSecret,
  githubBackfillEnabled: m.githubBackfillEnabled,
}));

vi.mock("@/lib/compliance/repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/compliance/repo")>()),
  appendEvent: m.append,
  getDispatch: vi.fn(async () => null),
}));

vi.mock("@/lib/sync/repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sync/repo")>()),
  getEntities: vi.fn(async () => []),
  getRepos: vi.fn(async () => []),
}));

vi.mock("@/lib/github-app", () => ({
  resolveGithubToken: vi.fn(async () => null),
}));

import { GET } from "@/app/api/cron/github-backfill/route";

const ctx = { params: Promise.resolve({}) };
const call = (authHeader?: string, qs = "") =>
  GET(
    new Request(
      `http://test/api/cron/github-backfill${qs}`,
      authHeader ? { headers: { authorization: authHeader } } : {}
    ),
    ctx
  );

describe("GET /api/cron/github-backfill", () => {
  beforeEach(() => {
    m.cronConfigured.mockReset().mockReturnValue(true);
    m.cronSecret.mockReset().mockReturnValue("topsecret");
    m.githubBackfillEnabled.mockReset().mockReturnValue(true);
    m.append.mockReset().mockResolvedValue(undefined);
  });

  it("is default-off: 503 when CRON_SECRET is unset", async () => {
    m.cronConfigured.mockReturnValue(false);
    const resp = await call("Bearer topsecret");
    expect(resp.status).toBe(503);
    expect((await resp.json()).error.code).toBe("cron_disabled");
    expect(m.append).not.toHaveBeenCalled();
  });

  it("rejects a missing or wrong bearer with 401", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    expect(m.append).not.toHaveBeenCalled();
  });

  it("kill switch off → enabled:false, no GitHub reads, no writes", async () => {
    m.githubBackfillEnabled.mockReturnValue(false);
    const resp = await call("Bearer topsecret");
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ data: { enabled: false } });
    expect(m.append).not.toHaveBeenCalled();
  });

  it("runs every registry repo and records one report event", async () => {
    const resp = await call("Bearer topsecret", "?days=3");
    expect(resp.status).toBe(200);
    const { data } = await resp.json();
    expect(data.enabled).toBe(true);
    expect(data.recorded).toBe(true);
    expect(data.report.windowDays).toBe(3);
    expect(data.report.repos).toHaveLength(10);
    // No token configured in this test → every repo is visibly degraded.
    expect(data.report.totals.degraded).toBe(10);
    expect(m.append).toHaveBeenCalledTimes(1);
    expect(m.append.mock.calls[0][0]).toMatchObject({ kind: BACKFILL_EVENT_KIND });
  });

  it("fails open when the report write fails: still 200, recorded:false", async () => {
    m.append.mockRejectedValue(new Error("db down"));
    const resp = await call("Bearer topsecret");
    expect(resp.status).toBe(200);
    const { data } = await resp.json();
    expect(data.recorded).toBe(false);
    expect(data.report.repos).toHaveLength(10);
  });
});
