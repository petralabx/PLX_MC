// Which source a refresh reads (TASK-3489): plx-reporting-mcp only when both
// REPORTING_MCP_URL and REPORTING_MCP_TOKEN are set, else the existing
// REPORTING_DATABASE_URL pool; neither is "not connected". Also the three
// queries reshaped for the MCP path: the production cutoff becomes a Toronto
// date in TypeScript, and references and customers come back as one row.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ used: [] as string[] }));

vi.mock("@/lib/reporting/goals/source-db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/reporting/goals/source-db")>()),
  withReportingSnapshot: vi.fn(async (fn: (q: () => Promise<never[]>) => Promise<unknown>) => {
    h.used.push("pg");
    return fn(async () => []);
  }),
}));
vi.mock("@/lib/reporting/goals/source-mcp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/reporting/goals/source-mcp")>()),
  withReportingMcp: vi.fn(async (fn: (q: () => Promise<never[]>) => Promise<unknown>) => {
    h.used.push("mcp");
    return fn(async () => []);
  }),
}));

import type { GoalsConfig } from "@/lib/reporting/goals";
import { customersQuery } from "@/lib/reporting/goals/queries/customers";
import { cutoffsQuery } from "@/lib/reporting/goals/queries/cutoffs";
import { referencesQuery } from "@/lib/reporting/goals/queries/references";
import { readDatasets } from "@/lib/reporting/goals/refresh";
import { reportingDatabaseConfigured, reportingMcpConfigured } from "@/lib/secrets";

const CONFIG = { ftlCustomers: [{ code: "CUST1" }] } as unknown as GoalsConfig;

describe("source selection", () => {
  beforeEach(() => {
    h.used = [];
    vi.stubEnv("REPORTING_MCP_URL", "");
    vi.stubEnv("REPORTING_MCP_TOKEN", "");
    vi.stubEnv("REPORTING_DATABASE_URL", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    // url, token, database url → configured, path
    [true, true, false, true, "mcp"],
    [true, true, true, true, "mcp"],
    [true, false, true, true, "pg"],
    [false, true, true, true, "pg"],
    [false, false, true, true, "pg"],
  ] as const)("url=%s token=%s database=%s → configured %s, reads through %s", async (mcpUrl, token, db, configured, path) => {
    if (mcpUrl) vi.stubEnv("REPORTING_MCP_URL", "https://reporting-mcp.example.test/mcp");
    if (token) vi.stubEnv("REPORTING_MCP_TOKEN", "test-token");
    if (db) vi.stubEnv("REPORTING_DATABASE_URL", "postgres://example.test/reporting");
    expect(reportingDatabaseConfigured()).toBe(configured);
    expect(reportingMcpConfigured()).toBe(path === "mcp");
    await readDatasets("2026-10-14", CONFIG);
    expect(h.used).toEqual([path]);
  });

  it("is not connected with neither path, or with only half of the MCP pair", () => {
    expect(reportingDatabaseConfigured()).toBe(false);
    vi.stubEnv("REPORTING_MCP_URL", "https://reporting-mcp.example.test/mcp");
    expect(reportingDatabaseConfigured()).toBe(false);
  });
});

describe("queries reshaped for the MCP path", () => {
  it("cutoffs: the latest batch update as a Toronto date, never after today", () => {
    const epoch = (iso: string) => String(Date.parse(iso) / 1000);
    // 02:30 UTC on the 14th is still the 13th in Toronto.
    expect(cutoffsQuery.map([{ today: "2026-10-14", batches_updated_epoch: epoch("2026-10-14T02:30:00Z"), sage_cutoff: "2026-10-13" }])).toEqual({
      productionCutoff: "2026-10-13",
      sageCutoff: "2026-10-13",
    });
    expect(cutoffsQuery.map([{ today: "2026-10-14", batches_updated_epoch: `${epoch("2026-10-14T11:55:00Z")}.172854`, sage_cutoff: null }])).toEqual({
      productionCutoff: "2026-10-14",
      sageCutoff: null,
    });
    // An update dated after today (clock skew) is capped at today, as LEAST was.
    expect(cutoffsQuery.map([{ today: "2026-10-14", batches_updated_epoch: epoch("2026-10-16T12:00:00Z"), sage_cutoff: null }]).productionCutoff).toBe("2026-10-14");
    // No batch update at all leaves today, as LEAST(today, NULL) did.
    expect(cutoffsQuery.map([{ today: "2026-10-14", batches_updated_epoch: null, sage_cutoff: null }]).productionCutoff).toBe("2026-10-14");
    expect(cutoffsQuery.sql).not.toMatch(/AT TIME ZONE|timezone\(/i);
  });

  it("references: one row of two arrays, normalised and de-duplicated per kind", () => {
    expect(referencesQuery.map([{ filemaker: ["bc-1 a", "bc-1a", "x"], sage: ["x", "  "] }])).toEqual([
      { kind: "filemaker", ref: "bc-1a" },
      { kind: "filemaker", ref: "x" },
      { kind: "sage", ref: "x" },
    ]);
    expect(referencesQuery.map([{ filemaker: [], sage: [] }])).toEqual([]);
  });

  it("customers: one row of [code, name, currency], first of a code wins, name falls back to the code", () => {
    expect(
      customersQuery.map([
        {
          customers: [
            ["A1", "Alpha", "CAD"],
            ["A1", "Alpha again", "USD"],
            ["B2", null, null],
          ],
        },
      ])
    ).toEqual([
      { code: "A1", name: "Alpha", currency: "CAD" },
      { code: "B2", name: "B2", currency: null },
    ]);
    expect(customersQuery.map([{ customers: [] }])).toEqual([]);
  });
});
