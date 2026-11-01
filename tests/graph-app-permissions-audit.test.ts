// TASK-621 — least-privilege Graph app registration: manifest evaluation.
// TASK-4422 — siteGrants must cover every SharePoint site the code writes to,
// and an accepted exception keeps a transitional role only until its reviewBy.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain .mjs governance script, no type declarations.
import {
  discoverCodeSites,
  evaluateAcceptedExceptions,
  evaluateGraphAppRoles,
  evaluateSiteGrants,
  loadManifest,
} from "../scripts/audit-graph-app-permissions.mjs";

const manifest = {
  requiredRoles: ["Sites.Selected"],
  transitionalRoles: [{ role: "Sites.ReadWrite.All", retireBy: "2026-08-21" }],
  forbiddenRoles: ["Sites.FullControl.All", "Mail.Send", "User.Read.All"],
};

const BEFORE_RETIRE = new Date("2026-08-01T00:00:00Z");
const AFTER_RETIRE = new Date("2026-09-01T00:00:00Z");

describe("evaluateGraphAppRoles", () => {
  it("passes the target least-privilege state", () => {
    const { violations, warnings } = evaluateGraphAppRoles(
      ["Sites.Selected"],
      manifest,
      BEFORE_RETIRE
    );
    expect(violations).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("warns (not fails) on the transitional broad role before retire-by", () => {
    const { violations, warnings } = evaluateGraphAppRoles(
      ["Sites.ReadWrite.All"],
      manifest,
      BEFORE_RETIRE
    );
    expect(violations).toEqual([]);
    expect(warnings.some((w: string) => w.includes("Sites.ReadWrite.All"))).toBe(true);
    expect(warnings.some((w: string) => w.includes("Sites.Selected"))).toBe(true);
  });

  it("fails the transitional role after its retire-by date", () => {
    const { violations } = evaluateGraphAppRoles(
      ["Sites.ReadWrite.All", "Sites.Selected"],
      manifest,
      AFTER_RETIRE
    );
    expect(violations.some((v: string) => v.includes("past retire-by"))).toBe(true);
  });

  it("fails any forbidden broad role", () => {
    const { violations } = evaluateGraphAppRoles(
      ["Sites.Selected", "Mail.Send", "User.Read.All"],
      manifest,
      BEFORE_RETIRE
    );
    expect(violations).toHaveLength(2);
  });

  it("fails roles outside the contract entirely", () => {
    const { violations } = evaluateGraphAppRoles(
      ["Sites.Selected", "Files.ReadWrite.All"],
      manifest,
      BEFORE_RETIRE
    );
    expect(violations.some((v: string) => v.includes("Files.ReadWrite.All"))).toBe(true);
  });

  it("fails when neither the required role nor transitional coverage is granted", () => {
    const { violations } = evaluateGraphAppRoles([], manifest, BEFORE_RETIRE);
    expect(violations.some((v: string) => v.includes("Sites.Selected"))).toBe(true);
  });

  it("repo manifest is loadable and declares Sites.Selected as the target", () => {
    const repoManifest = loadManifest();
    expect(repoManifest.requiredRoles).toContain("Sites.Selected");
    expect(repoManifest.forbiddenRoles).toContain("Sites.FullControl.All");
  });
});

const exception = {
  role: "Sites.ReadWrite.All",
  decidedBy: "vince@petrasoap.com",
  decidedAt: "2026-11-01",
  reason: "Keep the broad role.",
  reviewBy: "2027-11-01",
  source: "MC question on TASK-4422",
};
const withException = {
  ...manifest,
  transitionalRoles: [...manifest.transitionalRoles, { role: "Files.ReadWrite.All", retireBy: "2026-08-21" }],
  acceptedExceptions: [exception],
};
const BEFORE_REVIEW = new Date("2027-11-01T12:00:00Z");
const AFTER_REVIEW = new Date("2027-11-02T00:00:00Z");

describe("accepted exceptions", () => {
  it("allows the excepted transitional role past retire-by until reviewBy, as a warning", () => {
    const { violations, warnings } = evaluateGraphAppRoles(["Sites.ReadWrite.All"], withException, BEFORE_REVIEW);
    expect(violations).toEqual([]);
    expect(warnings.some((w: string) => w.includes("accepted exception") && w.includes("2027-11-01"))).toBe(true);
    expect(evaluateAcceptedExceptions(withException, BEFORE_REVIEW).violations).toEqual([]);
  });

  it("fails the role and the record again after reviewBy", () => {
    const roles = evaluateGraphAppRoles(["Sites.ReadWrite.All"], withException, AFTER_REVIEW);
    expect(roles.violations.some((v: string) => v.includes("past retire-by"))).toBe(true);
    const record = evaluateAcceptedExceptions(withException, AFTER_REVIEW);
    expect(record.violations).toEqual([expect.stringContaining("expired")]);
  });

  it("does not excuse another expired transitional role", () => {
    const { violations } = evaluateGraphAppRoles(
      ["Sites.ReadWrite.All", "Files.ReadWrite.All"],
      withException,
      BEFORE_REVIEW
    );
    expect(violations).toEqual([expect.stringContaining("Files.ReadWrite.All")]);
  });

  it("never allows a forbidden or unlisted role, and rejects the record", () => {
    for (const role of ["Mail.Send", "Directory.ReadWrite.All"]) {
      const m = { ...manifest, acceptedExceptions: [{ ...exception, role }] };
      expect(evaluateGraphAppRoles(["Sites.Selected", role], m, BEFORE_REVIEW).violations).toHaveLength(1);
      expect(evaluateAcceptedExceptions(m, BEFORE_REVIEW).violations).toEqual([
        expect.stringContaining("must name a transitional role"),
      ]);
    }
  });

  it("rejects an incomplete or badly dated record and does not honour it", () => {
    const cases = [{ ...exception, source: " " }, { ...exception, reviewBy: "next year" }, { ...exception, reviewBy: "2026-10-01" }];
    for (const record of cases) {
      const m = { ...manifest, acceptedExceptions: [record] };
      expect(evaluateAcceptedExceptions(m, BEFORE_RETIRE).violations).toHaveLength(1);
      expect(evaluateGraphAppRoles(["Sites.ReadWrite.All"], m, BEFORE_REVIEW).violations).toHaveLength(1);
    }
  });

  it("the repo manifest records Vince's 2026-11-01 decision, live until 2027-11-01", () => {
    const repo = loadManifest();
    expect(repo.acceptedExceptions).toEqual([
      expect.objectContaining({
        role: "Sites.ReadWrite.All",
        decidedBy: "vince@petrasoap.com",
        decidedAt: "2026-11-01",
        reviewBy: "2027-11-01",
        source: "MC question on TASK-4422",
      }),
    ]);
    expect(evaluateGraphAppRoles(["Sites.ReadWrite.All"], repo, BEFORE_REVIEW).violations).toEqual([]);
  });
});

type CodeSite = { site: string; use: string; file: string };

const CODE_SITES: CodeSite[] = [
  { site: "/sites/plx-mission-control", use: "sync", file: "src/lib/sync/graph.ts" },
  { site: "/sites/PLXSite", use: "evidence", file: "src/lib/compliance/evidence-artifacts.ts" },
];
const grant = (site: string, permission = "write") => ({ site, permission });

describe("evaluateSiteGrants", () => {
  it("passes when every written-to site has a write grant", () => {
    const result = evaluateSiteGrants(CODE_SITES, {
      siteGrants: [grant("/sites/plx-mission-control"), grant("/sites/PLXSite")],
    });
    expect(result).toEqual({ violations: [], warnings: [] });
  });

  it("fails when the PLXSite grant is missing", () => {
    const { violations } = evaluateSiteGrants(CODE_SITES, {
      siteGrants: [grant("/sites/plx-mission-control")],
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("/sites/PLXSite");
  });

  it("fails a grant weaker than the write the code needs", () => {
    const { violations } = evaluateSiteGrants(CODE_SITES, {
      siteGrants: [grant("/sites/plx-mission-control"), grant("/sites/PLXSite", "read")],
    });
    expect(violations.some((v: string) => v.includes('"read"'))).toBe(true);
  });

  it("matches site paths case-insensitively and warns on an unused grant", () => {
    const { violations, warnings } = evaluateSiteGrants(CODE_SITES, {
      siteGrants: [grant("/sites/PLX-Mission-Control"), grant("/sites/plxsite/"), grant("/sites/old")],
    });
    expect(violations).toEqual([]);
    expect(warnings).toEqual([expect.stringContaining("/sites/old")]);
  });
});

describe("discoverCodeSites", () => {
  it("finds both written-to sites in the repo source", () => {
    const { sites, errors } = discoverCodeSites();
    expect(errors).toEqual([]);
    expect(sites.map((s: CodeSite) => s.site).sort()).toEqual(["/sites/PLXSite", "/sites/plx-mission-control"]);
  });

  it("reports a source it can no longer parse instead of passing silently", () => {
    const { sites, errors } = discoverCodeSites("/nonexistent-root");
    expect(sites).toEqual([]);
    expect(errors).toHaveLength(2);
  });

  it("the repo manifest covers every site the code writes to", () => {
    const { sites } = discoverCodeSites();
    expect(evaluateSiteGrants(sites, loadManifest()).violations).toEqual([]);
  });
});

describe("audit-graph-app-permissions exit codes (no credentials)", () => {
  const dir = mkdtempSync(join(tmpdir(), "graph-audit-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const run = (manifest: unknown, extra: string[] = []) => {
    const path = join(dir, `manifest-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(path, JSON.stringify(manifest));
    const env = { ...process.env };
    delete env.MICROSOFT_GRAPH_TENANT_ID;
    delete env.MICROSOFT_GRAPH_CLIENT_ID;
    delete env.MICROSOFT_GRAPH_CLIENT_SECRET;
    return spawnSync(process.execPath, ["scripts/audit-graph-app-permissions.mjs", "--manifest", path, ...extra], {
      cwd: join(__dirname, ".."),
      env,
      encoding: "utf8",
    });
  };

  it("exits 1 when the PLXSite siteGrant is missing", () => {
    const res = run({ ...loadManifest(), siteGrants: [grant("/sites/plx-mission-control")] });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("/sites/PLXSite");
  });

  it("exits 2 (not configured) when the site grants are complete", () => {
    const res = run(loadManifest());
    expect(res.status).toBe(2);
  });

  it("exits 2 with the repo's accepted exception on its reviewBy date", () => {
    const res = run(loadManifest(), ["--now", "2027-11-01"]);
    expect(res.status).toBe(2);
  });

  it("exits 1 once the accepted exception is past reviewBy", () => {
    const res = run(loadManifest(), ["--now", "2027-11-02"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("expired (review by 2027-11-01)");
  });

  it("exits 1 when an accepted exception names a forbidden role", () => {
    const repo = loadManifest();
    const res = run({ ...repo, acceptedExceptions: [{ ...repo.acceptedExceptions[0], role: "Mail.Send" }] });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Mail.Send");
  });

  it("exits 1 on a malformed --now", () => {
    expect(run(loadManifest(), ["--now", "tomorrow"]).status).toBe(1);
  });
});
