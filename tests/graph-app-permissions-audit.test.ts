// TASK-621 — least-privilege Graph app registration: manifest evaluation.
// TASK-4422 — siteGrants must cover every SharePoint site the code writes to.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain .mjs governance script, no type declarations.
import {
  discoverCodeSites,
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

  const run = (manifest: unknown) => {
    const path = join(dir, `manifest-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(path, JSON.stringify(manifest));
    const env = { ...process.env };
    delete env.MICROSOFT_GRAPH_TENANT_ID;
    delete env.MICROSOFT_GRAPH_CLIENT_ID;
    delete env.MICROSOFT_GRAPH_CLIENT_SECRET;
    return spawnSync(process.execPath, ["scripts/audit-graph-app-permissions.mjs", "--manifest", path], {
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
});
