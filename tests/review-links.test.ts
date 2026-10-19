// Review links (TASK-3168): the path → module → link map, the PR-body parser,
// the warn-then-block rule and the PR-body loader. Pure; GitHub is stubbed.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import reviewLinksMap from "../config/review-links-map.json";

const m = vi.hoisted(() => ({ resolveGithubToken: vi.fn(async () => "tok") }));
vi.mock("@/lib/github-app", () => ({ resolveGithubToken: m.resolveGithubToken }));

import {
  REVIEW_LINKS_ENFORCE_FROM,
  REVIEW_LINKS_MISSING,
  REVIEW_LINKS_UNCHECKED,
  TRACKED_REPO_SLUGS,
  applyReviewLinks,
  parseReviewLinks,
  reviewLinksMode,
  reviewLinksReport,
  touchedModules,
  type VerifyResult,
} from "@/lib/compliance";
import { loadPrReviewLinks } from "@/lib/compliance/github-pr";

const MC = "petralabx/PLX_MC";
const PORTAL = "petralabx/plx-customer-portal";
const SWARM = "petralabx/agentic-swarm";
const BEFORE = Date.parse("2026-10-31T12:00:00.000Z");
const AFTER = Date.parse(REVIEW_LINKS_ENFORCE_FROM);
const PASS: VerifyResult = { verdict: "pass", reasons: ["agent bundle complete for standard-risk change"] };

const body = (...links: string[]) =>
  ["## Summary", "Text.", "", "## Review links", "", ...links.map((l) => `- ${l}`), "", "## Tests", "- https://mc.plxcustomer.io/?screen=sync"].join("\n");

const ids = (repo: string, paths: string[]) => touchedModules(repo, paths).map((mod) => mod.id);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("review links map", () => {
  const repos = (reviewLinksMap as { repos: Record<string, { liveUrl: string; modules: Array<{ id: string; paths: string[]; screen?: string; doc?: string }> }> }).repos;

  it("covers the portal, PLX_MC and Trading Lab, and only tracked repos", () => {
    expect(Object.keys(repos).sort()).toEqual([SWARM, MC, PORTAL].sort());
    for (const slug of Object.keys(repos)) expect(TRACKED_REPO_SLUGS).toContain(slug);
  });

  it("gives every module a path and at least one link", () => {
    for (const { liveUrl, modules } of Object.values(repos)) {
      expect(liveUrl).toMatch(/^https:\/\/[^/]+$/);
      for (const mod of modules) {
        expect(mod.paths.length, mod.id).toBeGreaterThan(0);
        expect(!!mod.screen || !!mod.doc, mod.id).toBe(true);
        if (mod.screen) expect(mod.screen.startsWith("/"), mod.id).toBe(true);
      }
    }
  });

  it("points PLX_MC modules at docs that exist in this repo", () => {
    for (const mod of repos[MC].modules) {
      if (mod.doc) expect(existsSync(join(process.cwd(), mod.doc)), mod.doc).toBe(true);
      for (const path of mod.paths) expect(existsSync(join(process.cwd(), path)), path).toBe(true);
    }
  });
});

describe("touchedModules", () => {
  it("finds the PLX_MC modules a PR touches", () => {
    expect(ids(MC, ["src/lib/compliance/verify.ts", "src/app/api/compliance/verify/route.ts", "src/lib/mcp/actions.ts"])).toEqual([
      "compliance",
      "mcp",
    ]);
    expect(ids(MC, ["src/components/mc/routing-inbox/inbox.tsx"])).toEqual(["routing"]);
  });

  it("finds the portal modules a PR touches", () => {
    expect(ids(PORTAL, ["portal/src/app/mrp/orders/page.tsx", "portal/src/app/(portal)/dashboard/page.tsx"])).toEqual([
      "customer-portal",
      "mrp",
    ]);
    expect(ids(PORTAL, ["bc-extensions/app.json"])).toEqual(["business-central-integration"]);
  });

  it("finds the Trading Lab modules a PR touches", () => {
    expect(ids(SWARM, ["src/trading_v2/flags.py", "apps/vmc-web/src/lib/vmc/workflows/workflows.ts"])).toEqual([
      "trading-lab",
      "workflows",
    ]);
  });

  it("matches a repo slug in any case", () => {
    expect(ids("PetraLabX/plx_mc", ["src/lib/sync/repo.ts"])).toEqual(["sync"]);
  });

  it("requires nothing for unmapped paths or unknown repos", () => {
    expect(ids(MC, ["src/lib/x.ts", "README.md", "tests/compliance.test.ts", "src/lib/compliancex/a.ts"])).toEqual([]);
    expect(ids("petralabx/unknown", ["src/lib/compliance/verify.ts"])).toEqual([]);
    expect(ids("PLX_MC", ["src/lib/compliance/verify.ts"])).toEqual([]);
  });
});

describe("parseReviewLinks", () => {
  it("reads markdown and bare links in the section only", () => {
    const parsed = parseReviewLinks(body("[Activity](https://mc.plxcustomer.io/?screen=activity)", "Doc: https://github.com/x/y/blob/main/a.md."));
    expect(parsed).toEqual({
      found: true,
      urls: ["https://mc.plxcustomer.io/?screen=activity", "https://github.com/x/y/blob/main/a.md"],
    });
  });

  it("reports a missing section", () => {
    expect(parseReviewLinks("## Summary\nhttps://mc.plxcustomer.io/?screen=activity")).toEqual({ found: false, urls: [] });
  });
});

describe("reviewLinksReport", () => {
  const paths = ["src/lib/compliance/verify.ts", "src/lib/mcp/actions.ts"];

  it("needs a link for each touched module", () => {
    const report = reviewLinksReport(MC, paths, parseReviewLinks(body("https://mc.plxcustomer.io/?screen=activity")), BEFORE);
    expect(report.modules).toEqual(["compliance", "mcp"]);
    expect(report.missing).toEqual([
      { id: "mcp", links: ["https://github.com/petralabx/PLX_MC/blob/<branch>/docs/modules/mcp/README.md"] },
    ]);
  });

  it("accepts a per-PR preview of the screen and a doc blob link on any branch", () => {
    const report = reviewLinksReport(
      MC,
      paths,
      parseReviewLinks(
        body(
          "[Preview](https://plx-mission-control-git-x-petralabx.vercel.app/?screen=activity&taskId=TASK-1)",
          "[MCP](https://github.com/petralabx/PLX_MC/blob/claude/some-branch/docs/modules/mcp/README.md#tools)"
        )
      ),
      BEFORE
    );
    expect(report.missing).toEqual([]);
  });

  it("does not count a link to another screen, another repo or a bare host", () => {
    const report = reviewLinksReport(
      MC,
      paths,
      parseReviewLinks(
        body(
          "https://mc.plxcustomer.io/?screen=sync",
          "https://mc.plxcustomer.io/",
          "https://github.com/petralabx/other/blob/main/docs/modules/mcp/README.md"
        )
      ),
      BEFORE
    );
    expect(report.missing.map((mod) => mod.id)).toEqual(["compliance", "mcp"]);
  });

  it("counts a link with a malformed escape as no link, without throwing", () => {
    const malformed = ["https://github.com/%", "https://github.com/petralabx/PLX_MC/blob/main/docs/modules/mcp/%E0%A4"];
    const section = parseReviewLinks(body(...malformed));
    expect(section.urls).toEqual(malformed);
    expect(reviewLinksReport(MC, ["src/lib/mcp/actions.ts"], section, AFTER).missing.map((mod) => mod.id)).toEqual(["mcp"]);
    const withValid = parseReviewLinks(
      body(...malformed, "https://github.com/petralabx/PLX_MC/blob/main/docs/modules/mcp/README.md")
    );
    expect(reviewLinksReport(MC, ["src/lib/mcp/actions.ts"], withValid, AFTER).missing).toEqual([]);
  });

  it("matches a portal screen and the routes below it", () => {
    const section = parseReviewLinks(body("https://plx-customer-portal-abc.vercel.app/mrp/orders"));
    expect(reviewLinksReport(PORTAL, ["portal/src/app/mrp/orders/page.tsx"], section, BEFORE).missing).toEqual([]);
    expect(reviewLinksReport(PORTAL, ["portal/src/app/admin/page.tsx"], section, BEFORE).missing.map((mod) => mod.id)).toEqual([
      "admin",
    ]);
  });

  it("switches from warn to block on the enforce date", () => {
    expect(REVIEW_LINKS_ENFORCE_FROM).toBe("2026-11-01T04:00:00.000Z");
    expect(reviewLinksMode(AFTER - 1)).toBe("warn");
    expect(reviewLinksMode(AFTER)).toBe("block");
  });
});

describe("applyReviewLinks", () => {
  const paths = ["src/lib/compliance/verify.ts"];
  const noSection = parseReviewLinks("## Summary\nNo links.");

  it("warns before the block date when the section is missing, with the reason code", () => {
    const result = applyReviewLinks(PASS, reviewLinksReport(MC, paths, noSection, BEFORE));
    expect(result.verdict).toBe("pass");
    expect(result.reasons[0]).toBe(PASS.reasons[0]);
    expect(result.reasons[1]).toMatch(new RegExp(`^${REVIEW_LINKS_MISSING}: add a "## Review links" section`));
    expect(result.reasons[1]).toContain("compliance (https://mc.plxcustomer.io/?screen=activity or ");
    expect(result.reasons[1]).toMatch(/Warning only until 2026-11-01\.$/);
  });

  it("blocks after the block date when the section is missing", () => {
    const result = applyReviewLinks(PASS, reviewLinksReport(MC, paths, noSection, AFTER));
    expect(result.verdict).toBe("block");
    expect(result.reasons[0]).toMatch(new RegExp(`^${REVIEW_LINKS_MISSING}:`));
    expect(result.reasons.join(" ")).not.toContain("Warning only");
  });

  it("blocks after the block date when one touched module has no link", () => {
    const section = parseReviewLinks(body("https://mc.plxcustomer.io/?screen=activity"));
    const result = applyReviewLinks(PASS, reviewLinksReport(MC, [...paths, "src/lib/sync/repo.ts", "src/lib/mcp/a.ts"], section, AFTER));
    expect(result.verdict).toBe("block");
    expect(result.reasons[0]).toBe(
      `${REVIEW_LINKS_MISSING}: the "## Review links" section has no link for ` +
        "mcp (https://github.com/petralabx/PLX_MC/blob/<branch>/docs/modules/mcp/README.md); " +
        "sync (https://mc.plxcustomer.io/?screen=sync or https://github.com/petralabx/PLX_MC/blob/<branch>/docs/modules/sync/README.md)."
    );
  });

  it("passes unchanged when every touched module has a link, or none is touched", () => {
    const section = parseReviewLinks(body("https://mc.plxcustomer.io/?screen=activity"));
    expect(applyReviewLinks(PASS, reviewLinksReport(MC, paths, section, AFTER))).toEqual(PASS);
    expect(applyReviewLinks(PASS, reviewLinksReport(MC, ["src/lib/x.ts"], noSection, AFTER))).toEqual(PASS);
    expect(applyReviewLinks(PASS, null)).toEqual(PASS);
  });

  it("warns, then blocks, when the only link for a module is malformed", () => {
    const section = parseReviewLinks(body("https://github.com/%"));
    const before = applyReviewLinks(PASS, reviewLinksReport(MC, ["src/lib/mcp/actions.ts"], section, BEFORE));
    expect(before.verdict).toBe("pass");
    expect(before.reasons[1]).toMatch(new RegExp(`^${REVIEW_LINKS_MISSING}: the "## Review links" section has no link for mcp`));
    const after = applyReviewLinks(PASS, reviewLinksReport(MC, ["src/lib/mcp/actions.ts"], section, AFTER));
    expect(after.verdict).toBe("block");
    expect(after.reasons[0]).toMatch(new RegExp(`^${REVIEW_LINKS_MISSING}:`));
  });

  it("only notes an unread body, even after the block date", () => {
    const result = applyReviewLinks(PASS, reviewLinksReport(MC, paths, null, AFTER));
    expect(result.verdict).toBe("pass");
    expect(result.reasons[1]).toMatch(new RegExp(`^${REVIEW_LINKS_UNCHECKED}:`));
  });

  it("keeps a blocked verdict blocked and adds the warning", () => {
    const blocked: VerifyResult = { verdict: "block", reasons: ["missing a rollback plan (send `rollback`)"] };
    const result = applyReviewLinks(blocked, reviewLinksReport(MC, paths, noSection, BEFORE));
    expect(result.verdict).toBe("block");
    expect(result.reasons).toHaveLength(2);
  });
});

describe("loadPrReviewLinks", () => {
  it("reads the PR body and returns only the parsed section", async () => {
    const fetchMock = vi.fn(async () => Response.json({ number: 5, body: body("https://mc.plxcustomer.io/?screen=activity") }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadPrReviewLinks(MC, 5)).resolves.toEqual({ found: true, urls: ["https://mc.plxcustomer.io/?screen=activity"] });
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe("https://api.github.com/repos/petralabx/PLX_MC/pulls/5");
  });

  it("throws on a wrong PR payload or a missing token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ number: 6, body: "" })));
    await expect(loadPrReviewLinks(MC, 5)).rejects.toMatchObject({ code: "github_error" });
    m.resolveGithubToken.mockResolvedValueOnce(null as unknown as string);
    await expect(loadPrReviewLinks(MC, 5)).rejects.toMatchObject({ code: "github_unavailable" });
  });
});
