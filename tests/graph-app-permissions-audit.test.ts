// TASK-621 — least-privilege Graph app registration: manifest evaluation.

import { describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain .mjs governance script, no type declarations.
import { evaluateGraphAppRoles, loadManifest } from "../scripts/audit-graph-app-permissions.mjs";

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
