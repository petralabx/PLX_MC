// Manual entries and the Excel import (TASK-2897) against real Postgres:
// migration 039 on a disposable PG16 and the real routes, signed in as a Viewer
// or an Editor. Covers the writes with their versions and audit events, Entry
// ID assignment, the import's preview → confirm in one transaction, the
// rejections (header row, 1,000 rows, row errors), the 409 when entries changed
// since the preview, and a 403 for Viewers on every write.
// Disposable local PG16 only: no external URLs or credentials are consumed.

import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:net";

import { Client, type ClientConfig, type Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { main as migrate } from "../scripts/migrate.mjs";
import { POSTGRES_IMAGE } from "../scripts/lib/postgres-image.mjs";

const h = vi.hoisted(() => ({
  mcUrl: "",
  session: null as null | { user: { email: string; roles?: string[] } },
}));
vi.mock("@/lib/secrets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/secrets")>()),
  databaseUrl: () => h.mcUrl,
  databaseConfigured: () => true,
  reportingDatabaseConfigured: () => true,
}));
vi.mock("@/lib/db/tls", () => ({ resolveDbSsl: () => false }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => h.session), oidcEnabled: () => true }));

import { GET as customersGet } from "@/app/api/reporting/goals/customers/route";
import { DELETE as entryDelete, PATCH as entryPatch } from "@/app/api/reporting/goals/entries/[id]/route";
import { GET as entriesGet, POST as entriesPost } from "@/app/api/reporting/goals/entries/route";
import { POST as confirmPost } from "@/app/api/reporting/goals/import/confirm/route";
import { POST as importPost } from "@/app/api/reporting/goals/import/route";
import { MAX_IMPORT_ROWS, normalizeRef, type ImportPreview, type ManualEntry } from "@/lib/reporting/goals";

import { DATASETS, TODAY } from "./reporting-goals-helpers";
import { ENTRY_HEADERS, entriesWorkbook, entryRow, excelDate, type SheetCell } from "./reporting-goals-workbook";

class LocalClient extends Client {
  constructor(options: ClientConfig) {
    super({ ...options, ssl: false });
  }
}

const NAME = `plx-mc-goals-entries-pg-${randomBytes(4).toString("hex")}`;
const EDITOR = "Stephen@PetraSoap.com";
const OTHER_EDITOR = "cos@petrasoap.com";
let started = false;
let db: Client;

async function connect(url: string): Promise<Client> {
  for (let attempt = 0; ; attempt++) {
    const client = new LocalClient({ connectionString: url });
    try {
      await client.connect();
      return client;
    } catch {
      await client.end().catch(() => undefined);
      if (attempt >= 60) throw new Error("local PG16 unavailable");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

async function sql<R>(text: string, params: unknown[] = []): Promise<R[]> {
  return (await db.query(text, params)).rows as R[];
}

beforeAll(async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const password = randomBytes(12).toString("hex");
  const run = spawnSync("docker", ["run", "-d", "--name", NAME, "-e", `POSTGRES_PASSWORD=${password}`, "-p", `127.0.0.1:${port}:5432`, POSTGRES_IMAGE], { encoding: "utf8" });
  expect(run.status, run.stderr).toBe(0);
  started = true;
  const adminUrl = `postgres://postgres:${password}@127.0.0.1:${port}/postgres`;
  const bootstrap = await connect(adminUrl);
  await bootstrap.query("CREATE DATABASE mc_goals_entries");
  await bootstrap.end();
  h.mcUrl = adminUrl.replace(/\/postgres$/, "/mc_goals_entries");
  expect(await migrate({ env: { NODE_ENV: "test", PLX_MC_DATABASE_URL: h.mcUrl }, ClientClass: LocalClient, log: () => {} })).toBe(0);
  db = await connect(h.mcUrl);

  // The 2026-10-14 refresh the statuses are judged by: its references and customers.
  const [{ id }] = await sql<{ id: string }>(
    `INSERT INTO report_refresh_run (trigger, requested_by, today, status, finished_at, production_cutoff, sage_cutoff,
       fx_rate, fx_rate_date, fx_source)
     VALUES ('cron', 'cron', $1, 'succeeded', now(), $1, $1, 1.4219, $1, 'boc') RETURNING id`,
    [TODAY]
  );
  await sql(
    `INSERT INTO report_snap_reference (run_id, kind, ref) SELECT $1, k, r FROM unnest($2::text[], $3::text[]) AS t(k, r)
     ON CONFLICT DO NOTHING`,
    [id, DATASETS.references.map((r) => r.kind), DATASETS.references.map((r) => normalizeRef(r.ref))]
  );
  await sql(
    `INSERT INTO report_snap_customer (run_id, code, name, currency) SELECT $1, c, n, cur FROM unnest($2::text[], $3::text[], $4::text[]) AS t(c, n, cur)`,
    [id, DATASETS.customers.map((c) => c.code), DATASETS.customers.map((c) => c.name), DATASETS.customers.map((c) => c.currency)]
  );
}, 120_000);

afterAll(async () => {
  const pools = globalThis as typeof globalThis & { __plxMcPool?: Pool };
  await pools.__plxMcPool?.end();
  delete pools.__plxMcPool;
  await db?.end();
  if (started) expect(spawnSync("docker", ["rm", "-f", NAME]).status).toBe(0);
});

// ─── Calling the routes ─────────────────────────────────────────────────────

function signedIn(email: string | null, roles: string[] = ["Goals.Editor"]) {
  h.session = email ? { user: { email, roles } } : null;
}

const noParams = { params: Promise.resolve({}) };
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });
const request = (path: string, method: string, body?: unknown) =>
  new Request(`http://localhost/api/reporting/goals${path}`, {
    method,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });

interface Reply<T> {
  status: number;
  data: T;
  error: { code: string; message: string } | undefined;
}

async function reply<T>(resp: Response): Promise<Reply<T>> {
  const body = (await resp.json()) as { data?: T; error?: { code: string; message: string } };
  return { status: resp.status, data: body.data as T, error: body.error };
}

const addEntry = async (body: unknown) => reply<{ entry: ManualEntry }>(await entriesPost(request("/entries", "POST", body), noParams));
const patchEntry = async (id: string, body: unknown) => reply<{ entry: ManualEntry }>(await entryPatch(request(`/entries/${id}`, "PATCH", body), idParams(id)));
const removeEntry = async (id: string) => reply<{ entryId: string; deleted: boolean }>(await entryDelete(request(`/entries/${id}`, "DELETE"), idParams(id)));
const listLive = async () => reply<{ entries: ManualEntry[] }>(await entriesGet(request("/entries", "GET"), noParams));
const preview = async (bytes: Buffer, fileName = "PLX goals and production 2026-10-14.xlsx") =>
  reply<ImportPreview>(await importPost(request("/import", "POST", { fileName, fileBase64: bytes.toString("base64") }), noParams));
const confirm = async (body: unknown) =>
  reply<{ importId: number; added: number; changed: number; removed: number; unchanged: number }>(
    await confirmPost(request("/import/confirm", "POST", body), noParams)
  );

async function counts() {
  const [row] = await sql<{ entries: number; live: number; versions: number; imports: number; events: number }>(
    `SELECT (SELECT count(*)::int FROM report_manual_entry) AS entries,
            (SELECT count(*)::int FROM report_manual_entry WHERE deleted_at IS NULL) AS live,
            (SELECT count(*)::int FROM report_manual_entry_version) AS versions,
            (SELECT count(*)::int FROM report_manual_import) AS imports,
            (SELECT count(*)::int FROM mc_events WHERE kind LIKE 'reporting.goals.entry.%' OR kind = 'reporting.goals.import.confirmed') AS events`
  );
  return row;
}

async function events(kind: string) {
  return sql<{ actor: string; payload: Record<string, unknown> }>(`SELECT actor, payload FROM mc_events WHERE kind = $1 ORDER BY seq`, [kind]);
}

/** The live entries as the export would write them (A–M), for an import. */
async function exportedRows(): Promise<SheetCell[][]> {
  return (await listLive()).data.entries.map((entry) => entryRow(entry));
}

beforeEach(async () => {
  await sql(`DELETE FROM report_manual_entry_version WHERE true`);
  await sql(`DELETE FROM report_manual_import WHERE true`);
  await sql(`DELETE FROM report_manual_entry WHERE true`);
  await sql(`SELECT setval('report_manual_entry_seq', 1, false)`);
  await sql(`DELETE FROM mc_events WHERE kind LIKE 'reporting.goals.%'`);
  signedIn(EDITOR);
});

// ─── Access ─────────────────────────────────────────────────────────────────

describe("access", () => {
  it("refuses every write to Viewers (403) and to nobody signed in (401), and records the refusals", async () => {
    signedIn(EDITOR);
    expect((await addEntry({ type: "Batch", date: TODAY, reference: "BC-1", kg: "9000" })).status).toBe(201);
    const bytes = await entriesWorkbook(await exportedRows());
    const ok = await preview(bytes);
    expect(ok.status).toBe(200);
    const before = await counts();

    signedIn("viewer@petrasoap.com", ["Goals.Viewer"]);
    const writes = [
      await addEntry({ type: "Batch", date: TODAY, reference: "BC-2", kg: "9000" }),
      await patchEntry("M001", { kg: "1" }),
      await removeEntry("M001"),
      await preview(bytes),
      await confirm({ importId: ok.data.importId, token: ok.data.token }),
    ];
    expect(writes.map((w) => [w.status, w.error?.code])).toEqual(Array(5).fill([403, "forbidden"]));
    expect(await counts()).toEqual(before);
    const denied = await events("reporting.goals.denied");
    expect(denied).toHaveLength(5);
    expect(denied[0]).toMatchObject({ actor: "human:viewer@petrasoap.com", payload: { role: "editor" } });

    // Viewers still read.
    expect((await listLive()).data.entries.map((e) => e.entryId)).toEqual(["M001"]);
    signedIn(null);
    expect((await addEntry({ type: "Batch" })).status).toBe(401);
    expect((await listLive()).status).toBe(401);
  });

  it("serves the latest refresh's customers to Viewers", async () => {
    signedIn("viewer@petrasoap.com", ["Goals.Viewer"]);
    const resp = await reply<{ customers: { code: string; name: string; currency: string | null }[] }>(
      await customersGet(request("/customers", "GET"), noParams)
    );
    expect(resp.status).toBe(200);
    expect(resp.data.customers).toHaveLength(DATASETS.customers.length);
    expect(resp.data.customers).toContainEqual({ code: "A1TEXT11", name: "Tiger Hospitality LLC\u00a0DBA of A1 American", currency: "USD" });
  });
});

// ─── One entry at a time ────────────────────────────────────────────────────

describe("adding, editing and deleting an entry", () => {
  it("adds with the next ID, records the signed-in Editor, a version and an audit event without values", async () => {
    const added = await addEntry({ type: "batch", date: "2026-10-13", reference: " BC-26286C ", kg: "10,050", product: "Terra Pure" });
    expect(added.status).toBe(201);
    expect(added.data.entry).toMatchObject({
      entryId: "M001",
      type: "Batch",
      date: "2026-10-13",
      reference: "BC-26286C",
      kg: "10050.000",
      enteredBy: "stephen@petrasoap.com",
      updatedBy: "stephen@petrasoap.com",
      source: "ui",
    });
    const [version] = await sql<{ entry_id: string; action: string; actor: string; import_id: string | null; before: unknown; after: ManualEntry }>(
      `SELECT entry_id, action, actor, import_id, before, after FROM report_manual_entry_version`
    );
    expect(version).toMatchObject({ entry_id: "M001", action: "created", actor: "stephen@petrasoap.com", import_id: null, before: null });
    expect(version.after).toMatchObject({ entryId: "M001", kg: "10050.000", reference: "BC-26286C" });
    expect(await events("reporting.goals.entry.created")).toEqual([
      { actor: "human:stephen@petrasoap.com", payload: { entryId: "M001", source: "ui" } },
    ]);

    // IDs already taken are skipped (here M003, entered outside the API).
    await sql(
      `INSERT INTO report_manual_entry (entry_id, type, day, kg, entered_by, updated_by, source) VALUES ('M003', 'Batch', $1, 9000, 'x', 'x', 'ui')`,
      [TODAY]
    );
    expect((await addEntry({ type: "Batch", date: TODAY, kg: 9000 })).data.entry.entryId).toBe("M002");
    expect((await addEntry({ type: "Batch", date: TODAY, kg: 9000 })).data.entry.entryId).toBe("M004");
  });

  it("refuses a bad entry or a body that tries to set Mission Control's own fields, and stores nothing", async () => {
    const zero = await addEntry({ type: "Batch", date: TODAY, kg: "0" });
    expect(zero).toMatchObject({ status: 400, error: { code: "invalid_entry", message: "kg must be more than 0." } });
    const shipment = await addEntry({ type: "Shipment", date: TODAY, kg: "5" });
    expect(shipment.error?.message).toBe(
      "kg is only for batches. Clear it, or change Type to Batch. Product value is required for a shipment: the value before tax and freight. Currency is required for a shipment: CAD or USD."
    );
    for (const sneaky of [{ entryId: "M777" }, { enteredBy: "someone@else.com" }, { source: "import:x.xlsx" }]) {
      const resp = await addEntry({ type: "Batch", date: TODAY, kg: "9000", ...sneaky });
      expect(resp.status).toBe(400);
      expect(resp.error?.code).toBe("invalid_request");
    }
    expect((await addEntry("not json")).status).toBe(400);
    expect(await counts()).toEqual({ entries: 0, live: 0, versions: 0, imports: 0, events: 0 });
  });

  it("keeps the Sage code of a customer picked from the list, and none for free text", async () => {
    await addEntry({ type: "Shipment", date: TODAY, customer: "Tiger Hospitality LLC\u00a0DBA of A1 American", productValue: "100", currency: "USD" });
    await addEntry({ type: "Shipment", date: TODAY, customer: "petsup10", productValue: "100", currency: "USD" });
    await addEntry({ type: "Shipment", date: TODAY, customer: "  sahajan   inc. ", productValue: "100", currency: "CAD" });
    await addEntry({ type: "Shipment", date: TODAY, customer: "A new customer Ltd", productValue: "100", currency: "CAD" });
    expect(await sql(`SELECT entry_id, customer, customer_code FROM report_manual_entry ORDER BY entry_id`)).toEqual([
      { entry_id: "M001", customer: "Tiger Hospitality LLC\u00a0DBA of A1 American", customer_code: "A1TEXT11" },
      { entry_id: "M002", customer: "petsup10", customer_code: "PETSUP10" },
      { entry_id: "M003", customer: "sahajan   inc.", customer_code: "SAHAJA10" },
      { entry_id: "M004", customer: "A new customer Ltd", customer_code: null },
    ]);
  });

  it("edits only what changed, with before and after, and writes nothing for no change", async () => {
    await addEntry({ type: "Shipment", date: TODAY, reference: "INV-PENDING-7", customer: "Sahajan Inc.", productValue: "5000", currency: "CAD" });
    signedIn(OTHER_EDITOR);
    const edited = await patchEntry("m001", { productValue: "6,000", freight: "125.5" });
    expect(edited.status).toBe(200);
    expect(edited.data.entry).toMatchObject({
      entryId: "M001",
      productValue: "6000.00",
      freight: "125.50",
      customer: "Sahajan Inc.",
      enteredBy: "stephen@petrasoap.com",
      updatedBy: "cos@petrasoap.com",
    });
    const versions = await sql<{ action: string; actor: string; before: ManualEntry | null; after: ManualEntry | null }>(
      `SELECT action, actor, before, after FROM report_manual_entry_version ORDER BY id`
    );
    expect(versions.map((v) => [v.action, v.actor, v.before?.productValue ?? null, v.after?.productValue ?? null])).toEqual([
      ["created", "stephen@petrasoap.com", null, "5000.00"],
      ["updated", "cos@petrasoap.com", "5000.00", "6000.00"],
    ]);
    expect(await events("reporting.goals.entry.updated")).toEqual([
      { actor: "human:cos@petrasoap.com", payload: { entryId: "M001", fields: ["productValue", "freight"] } },
    ]);

    const before = await counts();
    expect((await patchEntry("M001", { productValue: "6000.00", currency: "cad" })).status).toBe(200);
    expect(await counts()).toEqual(before);
    // The merged entry must still be valid; then nothing is written.
    const invalid = await patchEntry("M001", { type: "Batch" });
    expect(invalid).toMatchObject({ status: 400, error: { code: "invalid_entry" } });
    expect(invalid.error?.message).toContain("Product value is only for shipments.");
    expect((await patchEntry("M001", {})).status).toBe(400);
    expect((await patchEntry("M001", { enteredBy: "x" })).status).toBe(400);
    expect((await patchEntry("M404", { note: "x" })).status).toBe(404);
    expect((await patchEntry("M 1", { note: "x" })).status).toBe(400);
    expect(await counts()).toEqual(before);
  });

  it("deletes softly: the entry leaves the list, its row and history stay", async () => {
    await addEntry({ type: "Batch", date: TODAY, reference: "BC-26290X", kg: "9000" });
    await addEntry({ type: "Batch", date: TODAY, reference: "BC-26291X", kg: "9100" });
    const gone = await removeEntry("M001");
    expect(gone).toMatchObject({ status: 200, data: { entryId: "M001", deleted: true } });
    expect((await listLive()).data.entries.map((e) => e.entryId)).toEqual(["M002"]);
    const [row] = await sql<{ deleted_at: Date | null; deleted_by: string }>(`SELECT deleted_at, deleted_by FROM report_manual_entry WHERE entry_id = 'M001'`);
    expect(row.deleted_at).not.toBeNull();
    expect(row.deleted_by).toBe("stephen@petrasoap.com");
    const [version] = await sql<{ action: string; before: ManualEntry; after: unknown }>(
      `SELECT action, before, after FROM report_manual_entry_version WHERE entry_id = 'M001' AND action = 'deleted'`
    );
    expect(version).toMatchObject({ action: "deleted", before: { entryId: "M001", reference: "BC-26290X" }, after: null });
    expect(await events("reporting.goals.entry.deleted")).toEqual([
      { actor: "human:stephen@petrasoap.com", payload: { entryId: "M001" } },
    ]);
    expect((await removeEntry("M001")).status).toBe(404);
    expect((await patchEntry("M001", { note: "back?" })).status).toBe(404);
    // A deleted ID is never handed out again.
    expect((await addEntry({ type: "Batch", date: TODAY, kg: "9000" })).data.entry.entryId).toBe("M003");
  });
});

// ─── Import ─────────────────────────────────────────────────────────────────

/** M1–M7 from the brief, entered through the form. */
async function enterFixtures(): Promise<void> {
  for (const e of DATASETS_ENTRIES) {
    const resp = await addEntry(e);
    expect(resp.status, JSON.stringify(resp.error)).toBe(201);
  }
}

const DATASETS_ENTRIES = [
  { type: "Batch", date: "2026-10-13", reference: "BC-26286C", kg: "10050", product: "Terra Pure - Desert Breeze - Shampoo", note: "M1" },
  { type: "Batch", date: "2026-10-14", reference: "BC-26290X", kg: "9000", note: "M2" },
  { type: "Shipment", date: "2026-10-14", reference: "PO0104001", customer: "A1 American", productValue: "24500", freight: "1250", currency: "USD", note: "M3" },
  { type: "Shipment", date: "2026-10-13", reference: "IN1000180418", customer: "K18 Inc", productValue: "84500", freight: "3156", currency: "USD", note: "M4" },
  { type: "Batch", date: "2026-10-09", reference: "BC-26280E", kg: "11127", note: "M5" },
  { type: "Shipment", date: "2026-09-30", reference: "PSP-0930", customer: "Pet Supplies Plus", productValue: "12000", currency: "USD", note: "M6" },
  { type: "Shipment", date: "2026-10-14", reference: "INV-PENDING-7", customer: "Sahajan Inc.", productValue: "5000", currency: "CAD", note: "M7" },
];

describe("import: preview, then confirm", () => {
  it("previews without changing anything, then applies it all in one go, audited, keeping the file", async () => {
    await enterFixtures();
    const rows = await exportedRows();
    rows[6][7] = 6000; // M007: product value 5,000 → 6,000
    rows.splice(2, 1); // M003 left out
    rows.push([null, "Batch", excelDate("2026-10-14"), "BC-26299Z", null, "Lavender wash", 8000]);
    rows.push([null, "Shipment", excelDate("2026-10-14"), "PO-NEW-1", "Tiger Hospitality LLC\u00a0DBA of A1 American", null, null, 19000, null, "USD", null, "someone else", "Counted"]);
    const bytes = await entriesWorkbook(rows);
    const before = await counts();

    const shown = await preview(bytes, "C:\\fakepath\\PLX goals and production 2026-10-14.xlsx");
    expect(shown.status).toBe(200);
    expect(shown.data).toMatchObject({ fileName: "PLX goals and production 2026-10-14.xlsx", rows: 8, unchanged: 5 });
    expect(shown.data.token).toMatch(/^[0-9a-f]{64}$/);
    expect(shown.data.add.map((a) => [a.row, a.fields.reference, a.statusLabel])).toEqual([
      [8, "BC-26299Z", "Counted"],
      [9, "PO-NEW-1", "Counted"],
    ]);
    expect(shown.data.change.map((c) => [c.entryId, c.changed, c.statusLabel])).toEqual([["M007", ["productValue"], "Counted"]]);
    expect(shown.data.remove.map((r) => [r.entryId, r.statusLabel])).toEqual([["M003", "Counted"]]);
    // A preview changes no entry; it keeps the file for the confirm.
    expect(await counts()).toEqual({ ...before, imports: 1 });
    const [kept] = await sql<{ status: string; file_bytes: Buffer; file_sha256: string; uploaded_by: string }>(
      `SELECT status, file_bytes, file_sha256, uploaded_by FROM report_manual_import`
    );
    expect(kept.status).toBe("previewed");
    expect(Buffer.compare(kept.file_bytes, bytes)).toBe(0);
    expect(kept.file_sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(kept.uploaded_by).toBe("stephen@petrasoap.com");

    const applied = await confirm({ importId: shown.data.importId, token: shown.data.token });
    expect(applied).toMatchObject({ status: 200, data: { importId: shown.data.importId, added: 2, changed: 1, removed: 1, unchanged: 5 } });
    const live = (await listLive()).data.entries;
    expect(live.map((e) => e.entryId)).toEqual(["M001", "M002", "M004", "M005", "M006", "M007", "M008", "M009"]);
    const byId = Object.fromEntries(live.map((e) => [e.entryId, e]));
    expect(byId.M007).toMatchObject({ productValue: "6000.00", updatedBy: "stephen@petrasoap.com", source: "ui" });
    // "Entered by" in the sheet is ignored: the uploader is recorded.
    expect(byId.M009).toMatchObject({
      reference: "PO-NEW-1",
      customerCode: "A1TEXT11",
      enteredBy: "stephen@petrasoap.com",
      source: "import:PLX goals and production 2026-10-14.xlsx",
    });
    expect(await sql(`SELECT deleted_by FROM report_manual_entry WHERE entry_id = 'M003'`)).toEqual([{ deleted_by: "stephen@petrasoap.com" }]);
    const versions = await sql<{ entry_id: string; action: string }>(
      `SELECT entry_id, action FROM report_manual_entry_version WHERE import_id = $1 ORDER BY id`,
      [shown.data.importId]
    );
    expect(versions).toEqual([
      { entry_id: "M008", action: "created" },
      { entry_id: "M009", action: "created" },
      { entry_id: "M007", action: "updated" },
      { entry_id: "M003", action: "deleted" },
    ]);
    expect(await events("reporting.goals.import.confirmed")).toEqual([
      {
        actor: "human:stephen@petrasoap.com",
        payload: { importId: shown.data.importId, added: 2, changed: 1, removed: 1, unchanged: 5 },
      },
    ]);
    expect(await sql(`SELECT status, applied_by FROM report_manual_import`)).toEqual([{ status: "applied", applied_by: "stephen@petrasoap.com" }]);
    expect((await confirm({ importId: shown.data.importId, token: shown.data.token })).status).toBe(409);
  });

  it("an unchanged export previews as no change at all, and confirming it changes nothing", async () => {
    await enterFixtures();
    // Picked from Sage's list: the name (with its no-break space) is stored with the code.
    await addEntry({ type: "Shipment", date: TODAY, customer: "Tiger Hospitality LLC\u00a0DBA of A1 American", productValue: "19000", freight: "0.5", currency: "USD" });
    const live = (await listLive()).data.entries;
    expect(live[7]).toMatchObject({ customerCode: "A1TEXT11", kg: null, productValue: "19000.00", freight: "0.50" });
    const shown = await preview(await entriesWorkbook(await exportedRows()));
    expect(shown.data).toMatchObject({ rows: 8, add: [], change: [], remove: [], unchanged: 8 });
    expect((await confirm({ importId: shown.data.importId, token: shown.data.token })).data).toMatchObject({ added: 0, changed: 0, removed: 0, unchanged: 8 });
    expect((await listLive()).data.entries).toEqual(live);
  });

  it("rejects a changed header row, more than 1,000 rows, a non-workbook and row errors — and keeps nothing", async () => {
    await enterFixtures();
    const before = await counts();
    const header = [...ENTRY_HEADERS];
    header[0] = "ID";
    const renamed = await preview(await entriesWorkbook(await exportedRows(), { header }));
    expect(renamed).toMatchObject({ status: 422, error: { code: "header_mismatch" } });
    expect(renamed.error?.message).toContain("column A should be “Entry ID” but is “ID”");

    const many = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i): SheetCell[] => [null, "Batch", excelDate(TODAY), `BC-${i}`, null, null, 9000]);
    expect(await preview(await entriesWorkbook(many))).toMatchObject({ status: 422, error: { code: "too_many_rows" } });
    expect(await preview(Buffer.from("not a workbook"))).toMatchObject({ status: 422, error: { code: "unreadable_file" } });

    const rows = await exportedRows();
    rows[0][6] = -1;
    rows[2][9] = "EUR";
    const invalid = await preview(await entriesWorkbook(rows));
    expect(invalid.status).toBe(422);
    expect(invalid.error?.code).toBe("invalid_rows");
    expect(invalid.error?.message.split("\n")).toEqual([
      "Nothing was imported: 2 problems on 2 rows. Fix them in the file and upload it again.",
      "Row 2: kg must be more than 0.",
      "Row 4: Currency must be CAD or USD, not “EUR”.",
    ]);

    const big = Buffer.alloc(2 * 1024 * 1024 + 1);
    expect(await preview(big)).toMatchObject({ status: 413, error: { code: "file_too_large", message: "The file is 2.0 MB; the limit is 2 MB." } });
    expect((await importPost(request("/import", "POST", { fileName: "x.xlsx", fileBase64: "%%%" }), noParams)).status).toBe(400);
    expect(await counts()).toEqual(before);
  }, 30_000);

  it("refuses to confirm (409) once the entries changed since the preview, and applies nothing", async () => {
    await enterFixtures();
    const rows = await exportedRows();
    rows.splice(0, 1); // remove M001
    const shown = await preview(await entriesWorkbook(rows));
    expect(shown.data.remove.map((r) => r.entryId)).toEqual(["M001"]);

    // Someone edits an entry in between.
    signedIn(OTHER_EDITOR);
    expect((await patchEntry("M002", { note: "edited while the preview was open" })).status).toBe(200);
    signedIn(EDITOR);
    const before = await counts();
    const refused = await confirm({ importId: shown.data.importId, token: shown.data.token });
    expect(refused).toMatchObject({ status: 409, error: { code: "entries_changed" } });
    expect({ ...(await counts()) }).toEqual(before);
    expect((await listLive()).data.entries.map((e) => e.entryId)).toContain("M001");
    expect(await sql(`SELECT status FROM report_manual_import WHERE id = $1`, [shown.data.importId])).toEqual([{ status: "superseded" }]);
    expect((await confirm({ importId: shown.data.importId, token: shown.data.token })).error?.code).toBe("preview_out_of_date");

    // A fresh preview of the same file applies.
    const again = await preview(await entriesWorkbook(rows));
    expect((await confirm({ importId: again.data.importId, token: again.data.token })).data).toMatchObject({ removed: 1 });
  });

  it("only the uploader's newest preview can be confirmed, with its own token", async () => {
    await enterFixtures();
    const bytes = await entriesWorkbook(await exportedRows());
    const first = await preview(bytes);
    const second = await preview(bytes);
    expect((await confirm({ importId: first.data.importId, token: first.data.token })).error?.code).toBe("preview_out_of_date");
    expect((await confirm({ importId: second.data.importId, token: "0".repeat(64) })).error?.code).toBe("preview_out_of_date");
    signedIn(OTHER_EDITOR);
    expect((await confirm({ importId: second.data.importId, token: second.data.token })).status).toBe(404);
    expect((await confirm({ importId: second.data.importId, token: "nope" })).status).toBe(400);
    signedIn(EDITOR);
    expect((await confirm({ importId: second.data.importId, token: second.data.token })).status).toBe(200);
  });

  it("stores a preview under the entries lock, so two at once can't both stay open", async () => {
    await enterFixtures();
    const bytes = await entriesWorkbook(await exportedRows());
    // Hold the lock every entry write takes, as a confirm or an edit would.
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", ["reporting-goals-entries"]);
    let stored = false;
    const pending = preview(bytes).then((result) => {
      stored = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 750));
    expect(stored, "the preview waits for the lock").toBe(false);
    await db.query("COMMIT");
    expect((await pending).status).toBe(200);
    const open = await sql<{ n: string }>(
      `SELECT count(*)::text AS n FROM report_manual_import WHERE uploaded_by = $1 AND status = 'previewed'`,
      [EDITOR.toLowerCase()]
    );
    expect(open[0].n).toBe("1");
  });

  it("applies in one transaction: a failure part-way leaves every entry as it was", async () => {
    await enterFixtures();
    const rows = await exportedRows();
    rows.splice(1, 1); // remove M002
    rows[0][10] = "changed note"; // change M001
    rows.push([null, "Batch", excelDate(TODAY), "BC-OK", null, null, 9000]);
    rows.push([null, "Batch", excelDate(TODAY), "BC-BROKEN", null, null, 9000]);
    const shown = await preview(await entriesWorkbook(rows));
    // Corrupt the stored plan so the second insert breaks a constraint mid-apply.
    await sql(`UPDATE report_manual_import SET preview = jsonb_set(preview, '{add,1,fields,type}', '"Pallet"') WHERE id = $1`, [shown.data.importId]);
    const before = await counts();
    const live = (await listLive()).data.entries;
    const failed = await confirm({ importId: shown.data.importId, token: shown.data.token });
    expect(failed).toMatchObject({ status: 500, error: { code: "internal" } });
    expect(await counts()).toEqual(before);
    expect((await listLive()).data.entries).toEqual(live);
    expect(await sql(`SELECT status FROM report_manual_import WHERE id = $1`, [shown.data.importId])).toEqual([{ status: "previewed" }]);
  });
});
