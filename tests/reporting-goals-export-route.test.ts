// GET /api/reporting/goals/export (TASK-2898): Viewers and Editors download the
// workbook of the latest good run under its dated name, and each export is
// audited; without data, a session or a Goals role it answers with the
// standard error envelope. Also apiDownload(), the page's half: the file and
// its name, or an ApiClientError. The workbook itself is tested in
// tests/reporting-goals-export.test.ts.

import ExcelJS from "exceljs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  oidc: true,
  basic: false,
  session: null as null | { user: { email: string; roles?: string[] } },
  data: null as unknown,
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => h.session),
  oidcEnabled: () => h.oidc,
}));
vi.mock("@/lib/secrets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/secrets")>()),
  databaseConfigured: () => true,
  basicAuthConfigured: () => h.basic,
  reportingDatabaseConfigured: () => true,
}));
vi.mock("@/lib/db", () => ({ assertSchemaReady: vi.fn(), query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/lib/compliance/repo", () => ({ appendEvent: vi.fn(), appendEventTx: vi.fn() }));
vi.mock("@/lib/reporting/goals/loader", () => ({ loadGoalsView: vi.fn(), loadGoalsExport: vi.fn(async () => h.data) }));

import { GET as exportGet } from "@/app/api/reporting/goals/export/route";
import { ApiClientError, apiDownload, dispositionFileName } from "@/lib/api";
import { appendEvent } from "@/lib/compliance/repo";
import { WORKBOOK_SHEETS, XLSX_CONTENT_TYPE, type GoalsExportData } from "@/lib/reporting/goals";

import { DATASETS, RATE, TODAY, goalsPage } from "./reporting-goals-helpers";

const ctx = { params: Promise.resolve({}) };
const FILE = "PLX goals and production 2026-10-14.xlsx";

function exportData(view = goalsPage()): GoalsExportData {
  return { view, shipments: DATASETS.shipments, truckloads: DATASETS.truckloads, rates: [{ date: TODAY, rate: RATE }] };
}

function signedIn(roles: string[] | undefined) {
  h.session = { user: { email: "Stephen@PetraSoap.com", roles } };
}

const get = () => exportGet(new Request("http://localhost/api/reporting/goals/export"), ctx);

beforeEach(() => {
  h.oidc = true;
  h.basic = false;
  h.session = null;
  h.data = exportData();
  vi.mocked(appendEvent).mockClear();
});

describe("GET /api/reporting/goals/export", () => {
  it("is 401 without a session and 403 without a Goals role, in the standard envelope", async () => {
    const anonymous = await get();
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toMatchObject({ error: { code: "not_authenticated" } });
    signedIn([]);
    const noRole = await get();
    expect(noRole.status).toBe(403);
    expect(await noRole.json()).toMatchObject({ error: { code: "forbidden" } });
    expect(appendEvent).not.toHaveBeenCalled();
  });

  it("gives a Viewer the workbook under its dated name, and records who exported which run", async () => {
    signedIn(["Goals.Viewer"]);
    const resp = await get();
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toBe(XLSX_CONTENT_TYPE);
    expect(resp.headers.get("content-disposition")).toBe(`attachment; filename="${FILE}"`);
    expect(resp.headers.get("cache-control")).toBe("no-store");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await resp.arrayBuffer());
    expect(wb.worksheets.map((ws) => ws.name)).toEqual([...WORKBOOK_SHEETS]);
    expect(wb.getWorksheet("Manual entries")!.getCell("A2").value).toBe("M001");
    // The page's revenue forecast rides along (its first open order row).
    expect(wb.getWorksheet("Forecast")!.getCell("B7").value).toBe("OR1000160001");
    expect(appendEvent).toHaveBeenCalledTimes(1);
    expect(appendEvent).toHaveBeenCalledWith({
      kind: "reporting.goals.export",
      actor: "human:stephen@petrasoap.com",
      payload: { runId: 41 },
    });
  });

  it("lets Editors and read-only break-glass sessions export too", async () => {
    signedIn(["Goals.Editor"]);
    expect((await get()).status).toBe(200);
    h.oidc = false;
    h.basic = true;
    expect((await get()).status).toBe(200);
    expect(vi.mocked(appendEvent).mock.calls.map(([e]) => e.actor)).toEqual(["human:stephen@petrasoap.com", "human:break-glass"]);
  });

  it("answers 404 no_data before the first good refresh and when not connected, and records nothing", async () => {
    signedIn(["Goals.Viewer"]);
    const empty = { ...goalsPage(), run: null, model: null, settings: null, fx: null };
    h.data = exportData({ ...empty, state: "no_data" });
    const noData = await get();
    expect(noData.status).toBe(404);
    expect(await noData.json()).toEqual({
      error: { code: "no_data", message: "There’s nothing to export yet: the report fills in after its first refresh." },
    });
    h.data = exportData({ ...empty, state: "not_configured" });
    const notConnected = await get();
    expect(notConnected.status).toBe(404);
    expect(await notConnected.json()).toMatchObject({ error: { code: "no_data", message: expect.stringContaining("isn’t connected") } });
    expect(appendEvent).not.toHaveBeenCalled();
  });
});

describe("apiDownload", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the file and the name the route suggests", async () => {
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([80, 75, 3, 4]), {
        headers: { "content-type": XLSX_CONTENT_TYPE, "content-disposition": `attachment; filename="${FILE}"` },
      })
    );
    const { blob, fileName } = await apiDownload("/reporting/goals/export");
    expect(fetchMock).toHaveBeenCalledWith("/api/reporting/goals/export", undefined);
    expect(fileName).toBe(FILE);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([80, 75, 3, 4]));
  });

  it("throws the route's error envelope as ApiClientError, and says so when the error isn't JSON", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: { code: "no_data", message: "There’s nothing to export yet." } }, { status: 404 })
    );
    const failure = await apiDownload("/reporting/goals/export").catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(ApiClientError);
    expect(failure).toMatchObject({ code: "no_data", message: "There’s nothing to export yet." });

    fetchMock.mockResolvedValueOnce(new Response("<html>Bad gateway</html>", { status: 502 }));
    await expect(apiDownload("/reporting/goals/export")).rejects.toMatchObject({ code: "bad_response" });
  });

  it("reads quoted and bare file names, and null without one", () => {
    expect(dispositionFileName(`attachment; filename="${FILE}"`)).toBe(FILE);
    expect(dispositionFileName("attachment; filename=report.xlsx; size=10")).toBe("report.xlsx");
    expect(dispositionFileName("attachment")).toBeNull();
    expect(dispositionFileName(null)).toBeNull();
  });
});
