// Goals & Production entry and import routes (TASK-2897), with the services
// mocked: who may call each one, what reaches the service, and what the
// bodies must look like. The services themselves run against Postgres in
// tests/reporting-goals-entries-postgres.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  oidc: true,
  basic: false,
  session: null as null | { user: { email: string; roles?: string[] } },
  exceljsLoaded: false,
}));

// exceljs takes ~0.35 s to load: it must not load with the routes (or the
// barrel every goals route imports), only when a workbook is read.
vi.mock("exceljs", async (importOriginal) => {
  h.exceljsLoaded = true;
  return importOriginal();
});

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => h.session),
  oidcEnabled: () => h.oidc,
}));
vi.mock("@/lib/secrets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/secrets")>()),
  databaseConfigured: () => true,
  basicAuthConfigured: () => h.basic,
}));
vi.mock("@/lib/db", () => ({ assertSchemaReady: vi.fn(), query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/lib/compliance/repo", () => ({ appendEvent: vi.fn(), appendEventTx: vi.fn() }));
vi.mock("@/lib/reporting/goals/entries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/reporting/goals/entries")>()),
  createEntry: vi.fn(async (body: object) => ({ entryId: "M008", ...body })),
  updateEntry: vi.fn(async (entryId: string, body: object) => ({ entryId, ...body })),
  deleteEntry: vi.fn(async () => undefined),
  liveEntries: vi.fn(async () => [{ entryId: "M001" }]),
  latestCustomers: vi.fn(async () => [{ code: "A1TEXT11", name: "A1 American", currency: "USD" }]),
  previewImport: vi.fn(async () => ({ importId: 5, token: "a".repeat(64) })),
  confirmImport: vi.fn(async () => ({ importId: 5, added: 1, changed: 0, removed: 0, unchanged: 6 })),
}));

import { GET as customersGet } from "@/app/api/reporting/goals/customers/route";
import { DELETE as entryDelete, PATCH as entryPatch } from "@/app/api/reporting/goals/entries/[id]/route";
import { GET as entriesGet, POST as entriesPost } from "@/app/api/reporting/goals/entries/route";
import { POST as confirmPost } from "@/app/api/reporting/goals/import/confirm/route";
import { POST as importPost } from "@/app/api/reporting/goals/import/route";
import { appendEvent } from "@/lib/compliance/repo";
import {
  confirmImport,
  createEntry,
  deleteEntry,
  latestCustomers,
  liveEntries,
  previewImport,
  updateEntry,
} from "@/lib/reporting/goals/entries";

const ctx = { params: Promise.resolve({}) };
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const TOKEN = "a".repeat(64);
const XLSX = Buffer.from("PK\u0003\u0004 workbook bytes").toString("base64");

function signedIn(roles: string[] | undefined) {
  h.session = { user: { email: "Stephen@PetraSoap.com", roles } };
}

const req = (method: string, body?: unknown) =>
  new Request("http://localhost/api/reporting/goals/x", {
    method,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });

/** Every write route, called with a body that is valid for it. */
const WRITES: [string, () => Promise<Response>][] = [
  ["POST /entries", () => entriesPost(req("POST", { type: "Batch", date: "2026-10-14", kg: "9000" }), ctx)],
  ["PATCH /entries/M001", () => entryPatch(req("PATCH", { kg: "9500" }), idCtx("M001"))],
  ["DELETE /entries/M001", () => entryDelete(req("DELETE"), idCtx("M001"))],
  ["POST /import", () => importPost(req("POST", { fileName: "goals.xlsx", fileBase64: XLSX }), ctx)],
  ["POST /import/confirm", () => confirmPost(req("POST", { importId: 5, token: TOKEN }), ctx)],
];
const SERVICES = [createEntry, updateEntry, deleteEntry, previewImport, confirmImport];

beforeEach(() => {
  h.oidc = true;
  h.basic = false;
  h.session = null;
  for (const fn of [...SERVICES, liveEntries, latestCustomers, appendEvent]) vi.mocked(fn).mockClear();
});

describe("who may write", () => {
  it("refuses every write to Viewers (403), records it, and never reaches the service", async () => {
    signedIn(["Goals.Viewer"]);
    for (const [name, call] of WRITES) {
      const resp = await call();
      expect(resp.status, name).toBe(403);
      expect(await resp.json(), name).toMatchObject({ error: { code: "forbidden" } });
    }
    for (const fn of SERVICES) expect(fn).not.toHaveBeenCalled();
    expect(appendEvent).toHaveBeenCalledTimes(WRITES.length);
    expect(appendEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: "reporting.goals.denied", actor: "human:stephen@petrasoap.com" }));
  });

  it("refuses everyone without a session (401), anyone without a Goals role, and break-glass sessions", async () => {
    for (const [name, call] of WRITES) expect((await call()).status, name).toBe(401);
    signedIn([]);
    for (const [name, call] of WRITES) expect((await call()).status, name).toBe(403);
    h.oidc = false;
    h.basic = true;
    for (const [name, call] of WRITES) expect((await call()).status, name).toBe(403);
    for (const fn of SERVICES) expect(fn).not.toHaveBeenCalled();
  });

  it("lets Editors through, with the signed-in actor and the parsed body", async () => {
    signedIn(["Goals.Editor"]);
    const created = await WRITES[0][1]();
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ data: { entry: { entryId: "M008", type: "Batch", date: "2026-10-14", kg: "9000" } } });
    expect(createEntry).toHaveBeenCalledWith(
      { type: "Batch", date: "2026-10-14", kg: "9000" },
      expect.objectContaining({ label: "stephen@petrasoap.com", roles: ["viewer", "editor"] })
    );
    expect(await (await entryPatch(req("PATCH", { kg: "9500" }), idCtx("m001"))).json()).toEqual({ data: { entry: { entryId: "M001", kg: "9500" } } });
    expect(updateEntry).toHaveBeenCalledWith("M001", { kg: "9500" }, expect.objectContaining({ label: "stephen@petrasoap.com" }));
    expect(await (await WRITES[2][1]()).json()).toEqual({ data: { entryId: "M001", deleted: true } });
    expect(deleteEntry).toHaveBeenCalledWith("M001", expect.objectContaining({ label: "stephen@petrasoap.com" }));

    expect(await (await WRITES[3][1]()).json()).toEqual({ data: { importId: 5, token: TOKEN } });
    const [preview] = vi.mocked(previewImport).mock.calls[0];
    expect(preview.fileName).toBe("goals.xlsx");
    expect(preview.bytes.toString("latin1")).toBe("PK\u0003\u0004 workbook bytes");
    expect(await (await WRITES[4][1]()).json()).toEqual({ data: { importId: 5, added: 1, changed: 0, removed: 0, unchanged: 6 } });
    expect(confirmImport).toHaveBeenCalledWith({ importId: 5, token: TOKEN, actor: expect.objectContaining({ label: "stephen@petrasoap.com" }) });
  });
});

describe("request bodies", () => {
  beforeEach(() => signedIn(["Goals.Editor"]));

  it("refuses fields Mission Control sets itself, and anything that isn't the entry's shape", async () => {
    for (const body of [
      { type: "Batch", entryId: "M001" },
      { type: "Batch", enteredBy: "someone@else.com" },
      { type: "Batch", source: "import:x" },
      { type: "Batch", kg: { value: 1 } },
      { type: "Batch", note: "n".repeat(5001) },
    ]) {
      const resp = await entriesPost(req("POST", body), ctx);
      expect(resp.status, JSON.stringify(body).slice(0, 60)).toBe(400);
      expect(await resp.json()).toMatchObject({ error: { code: "invalid_request" } });
    }
    expect((await entriesPost(req("POST", "{not json"), ctx)).status).toBe(400);
    expect((await entryPatch(req("PATCH", {}), idCtx("M001"))).status).toBe(400);
    expect((await entryPatch(req("PATCH", { kg: "1" }), idCtx("M 1"))).status).toBe(400);
    expect((await entryDelete(req("DELETE"), idCtx("../M1"))).status).toBe(400);
    expect(createEntry).not.toHaveBeenCalled();
    expect(updateEntry).not.toHaveBeenCalled();
    expect(deleteEntry).not.toHaveBeenCalled();
  });

  it("takes the workbook only as base64 with a file name, and confirm only with a preview's token", async () => {
    for (const body of [
      { fileName: "goals.xlsx" },
      { fileName: "", fileBase64: XLSX },
      { fileName: "goals.xlsx", fileBase64: "not base64!" },
      { fileName: "goals.xlsx", fileBase64: XLSX, rows: [] },
    ]) {
      expect((await importPost(req("POST", body), ctx)).status, JSON.stringify(body).slice(0, 60)).toBe(400);
    }
    for (const body of [{ importId: 5 }, { importId: 5, token: "short" }, { importId: -1, token: TOKEN }, { importId: 5, token: TOKEN, force: true }]) {
      expect((await confirmPost(req("POST", body), ctx)).status, JSON.stringify(body)).toBe(400);
    }
    expect(previewImport).not.toHaveBeenCalled();
    expect(confirmImport).not.toHaveBeenCalled();
  });
});

describe("cold start", () => {
  it("loads exceljs only when a workbook is read", async () => {
    expect(h.exceljsLoaded).toBe(false);
    const { readEntriesSheet } = await vi.importActual<typeof import("@/lib/reporting/goals/excel/import")>(
      "@/lib/reporting/goals/excel/import"
    );
    await expect(readEntriesSheet(Buffer.from("not a workbook"))).rejects.toMatchObject({ code: "unreadable_file" });
    expect(h.exceljsLoaded).toBe(true);
  });
});

describe("reads", () => {
  it("serves entries and customers to Viewers", async () => {
    signedIn(["Goals.Viewer"]);
    expect(await (await entriesGet(req("GET"), ctx)).json()).toEqual({ data: { entries: [{ entryId: "M001" }] } });
    expect(await (await customersGet(req("GET"), ctx)).json()).toEqual({
      data: { customers: [{ code: "A1TEXT11", name: "A1 American", currency: "USD" }] },
    });
    signedIn([]);
    expect((await entriesGet(req("GET"), ctx)).status).toBe(403);
    expect((await customersGet(req("GET"), ctx)).status).toBe(403);
  });
});
