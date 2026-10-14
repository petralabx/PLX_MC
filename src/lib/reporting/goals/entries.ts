// Manual entries — the writes (TASK-2897): add, edit and delete one entry, and
// the Excel import's preview and confirm. Every write is one Mission Control
// transaction that also appends the before/after record to
// report_manual_entry_version and an audit event to mc_events (entry ids,
// field names and counts — never values). All writes take one advisory lock,
// so a confirm's "nothing changed since the preview" check and its writes see
// the same list. Entry IDs (M001…) come from report_manual_entry_seq. Who
// entered or changed an entry is always the signed-in Editor, never the
// request. Deletes are soft. Server-only.

import { createHash } from "node:crypto";

import { z } from "zod";

import { ApiError } from "@/lib/api/route";
import { appendEventTx } from "@/lib/compliance/repo";
import { query, withTransaction, type TxQuery } from "@/lib/db";
import { databaseConfigured } from "@/lib/secrets";

import type { GoalsActor } from "./access";
import { monthEnd, monthStart, torontoDate } from "./calendar";
import {
  MAX_IMPORT_BYTES,
  changedFields,
  entryValuesOf,
  validateEntry,
  type DraftValue,
  type EntryFields,
  type FieldError,
} from "./entry-input";
import { ImportFileError, planImport, readEntriesSheet, rowErrorsMessage, type ImportPlan } from "./excel/import";
import { normalizeName, normalizeRef, type EntryContext } from "./rules";
import { ENTRY_SQL_COLUMNS, latestRuns, listEntries, loadReferenceMatches, toEntry, type EntryRow } from "./store";
import type { CustomerRow, ManualEntry } from "./types";

// ─── Request bodies (shape only; validateEntry holds the rules) ─────────────

const text = z.string().max(5000).nullable().optional();
const amount = z.union([z.string().max(64), z.number()]).nullable().optional();

/**
 * POST /entries and PATCH /entries/[id]. Unknown keys — an Entry ID, "entered
 * by", a source — are refused: Mission Control sets those itself.
 */
export const ENTRY_BODY = z
  .object({
    type: z.string().max(64).nullable().optional(),
    date: z.string().max(64).nullable().optional(),
    reference: text,
    customer: text,
    product: text,
    kg: amount,
    productValue: amount,
    freight: amount,
    currency: z.string().max(64).nullable().optional(),
    note: text,
  })
  .strict();
export type EntryBody = z.infer<typeof ENTRY_BODY>;

export const ENTRY_PATCH = ENTRY_BODY.refine((body) => Object.keys(body).length > 0, {
  message: "Send at least one field to change.",
});

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * POST /import: the workbook as base64 inside JSON (the shared api() helper
 * sends JSON only). Bodies up to Vercel's 4.5 MB are read, so a file over the
 * 2 MB limit gets a size error that says how big it was.
 */
export const IMPORT_BODY = z
  .object({
    fileName: z.string().trim().min(1).max(255),
    fileBase64: z.string().min(1).max(4_500_000).regex(BASE64, "must be base64"),
  })
  .strict();

/** POST /import/confirm: the preview to apply and the token it was given. */
export const CONFIRM_BODY = z
  .object({
    importId: z.number().int().positive(),
    token: z.string().regex(/^[0-9a-f]{64}$/, "must be the token from the preview"),
  })
  .strict();

// ─── Shared pieces ──────────────────────────────────────────────────────────

const ENTRIES_LOCK_KEY = "reporting-goals-entries";

function requireStore(): void {
  if (!databaseConfigured()) {
    throw new ApiError("not_configured", "Mission Control’s database isn’t connected, so entries can’t be changed here.", 503);
  }
}

/** Serializes every entry write (single writes, imports) for the rest of the transaction. */
async function lockEntries(q: TxQuery): Promise<void> {
  await q(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [ENTRIES_LOCK_KEY]);
}

function invalidEntry(errors: FieldError[]): ApiError {
  return new ApiError("invalid_entry", errors.map((e) => e.message).join(" "), 400);
}

function noEntry(entryId: string): ApiError {
  return new ApiError("not_found", `There is no entry ${entryId} (it may have been deleted).`, 404);
}

/** Fingerprint of the entry list; any add, change or delete changes it. */
function entriesToken(entries: readonly ManualEntry[]): string {
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

/** "M001": the next free numbers from report_manual_entry_seq, skipping any ID already taken. */
async function nextEntryIds(q: TxQuery, count: number): Promise<string[]> {
  const ids: string[] = [];
  while (ids.length < count) {
    const rows = await q<{ n: string }>(
      `SELECT nextval('report_manual_entry_seq')::text AS n FROM generate_series(1, $1::int)`,
      [count - ids.length]
    );
    const candidates = rows
      .map((r) => Number(r.n))
      .sort((a, b) => a - b)
      .map((n) => `M${String(n).padStart(3, "0")}`);
    const taken = await q<{ entry_id: string }>(`SELECT entry_id FROM report_manual_entry WHERE entry_id = ANY($1::text[])`, [
      candidates,
    ]);
    const used = new Set(taken.map((t) => t.entry_id));
    ids.push(...candidates.filter((id) => !used.has(id)));
  }
  return ids;
}

/**
 * The Sage customer code for a customer name, from the latest good refresh's
 * customer list: set when exactly one customer has that name (or code), so the
 * truckload rules can match by code. Free text keeps no code.
 */
async function customerCodes(q: TxQuery): Promise<(customer: string | null) => string | null> {
  const rows = await q<{ code: string; name: string }>(
    `SELECT code, name FROM report_snap_customer
      WHERE run_id = (SELECT id FROM report_refresh_run WHERE status = 'succeeded' ORDER BY id DESC LIMIT 1)`
  );
  return (customer) => {
    if (!customer) return null;
    const name = normalizeName(customer);
    const code = customer.trim().toUpperCase();
    const matches = rows.filter((r) => normalizeName(r.name) === name || r.code.trim().toUpperCase() === code);
    return matches.length === 1 ? matches[0].code.trim() : null;
  };
}

async function liveEntry(q: TxQuery, entryId: string): Promise<ManualEntry | null> {
  const [row] = await q<EntryRow>(
    `SELECT ${ENTRY_SQL_COLUMNS} FROM report_manual_entry WHERE entry_id = $1 AND deleted_at IS NULL FOR UPDATE`,
    [entryId]
  );
  return row ? toEntry(row) : null;
}

function fieldParams(fields: EntryFields): unknown[] {
  return [
    fields.type,
    fields.date,
    fields.reference,
    fields.customer,
    fields.product,
    fields.kg,
    fields.productValue,
    fields.freight,
    fields.currency,
    fields.note,
  ];
}

async function insertEntry(
  q: TxQuery,
  entryId: string,
  fields: EntryFields,
  customerCode: string | null,
  who: string,
  source: string
): Promise<ManualEntry> {
  const [row] = await q<EntryRow>(
    `INSERT INTO report_manual_entry (entry_id, type, day, reference, customer, product, kg, product_value, freight,
       currency, note, customer_code, entered_by, updated_by, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13, $14)
     RETURNING ${ENTRY_SQL_COLUMNS}`,
    [entryId, ...fieldParams(fields), customerCode, who, source]
  );
  return toEntry(row);
}

async function updateEntryRow(
  q: TxQuery,
  entryId: string,
  fields: EntryFields,
  customerCode: string | null,
  who: string
): Promise<ManualEntry> {
  const [row] = await q<EntryRow>(
    `UPDATE report_manual_entry
        SET type = $2, day = $3, reference = $4, customer = $5, product = $6, kg = $7, product_value = $8,
            freight = $9, currency = $10, note = $11, customer_code = $12, updated_by = $13, updated_at = now()
      WHERE entry_id = $1 AND deleted_at IS NULL
      RETURNING ${ENTRY_SQL_COLUMNS}`,
    [entryId, ...fieldParams(fields), customerCode, who]
  );
  return toEntry(row);
}

async function softDelete(q: TxQuery, entryId: string, who: string): Promise<void> {
  await q(
    `UPDATE report_manual_entry SET deleted_at = now(), deleted_by = $2 WHERE entry_id = $1 AND deleted_at IS NULL`,
    [entryId, who]
  );
}

/** The append-only before/after record (report_manual_entry_version). */
async function recordVersion(
  q: TxQuery,
  v: {
    entryId: string;
    action: "created" | "updated" | "deleted";
    who: string;
    importId: number | null;
    before: ManualEntry | null;
    after: ManualEntry | null;
  }
): Promise<void> {
  await q(
    `INSERT INTO report_manual_entry_version (entry_id, action, actor, import_id, before, after)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
    [v.entryId, v.action, v.who, v.importId, v.before ? JSON.stringify(v.before) : null, v.after ? JSON.stringify(v.after) : null]
  );
}

// ─── One entry at a time (the page's form) ──────────────────────────────────

/** Live entries, oldest first (none without Mission Control's database, as on the page). */
export async function liveEntries(): Promise<ManualEntry[]> {
  return databaseConfigured() ? listEntries() : [];
}

/** The latest good refresh's Sage customers, for the form's customer picker. */
export async function latestCustomers(): Promise<CustomerRow[]> {
  if (!databaseConfigured()) return [];
  return query<CustomerRow>(
    `SELECT code, name, currency FROM report_snap_customer
      WHERE run_id = (SELECT id FROM report_refresh_run WHERE status = 'succeeded' ORDER BY id DESC LIMIT 1)
      ORDER BY name, code`
  );
}

export async function createEntry(body: EntryBody, actor: GoalsActor): Promise<ManualEntry> {
  requireStore();
  const checked = validateEntry(body);
  if (!checked.ok) throw invalidEntry(checked.errors);
  const fields = checked.value;
  return withTransaction(async (q) => {
    await lockEntries(q);
    const [entryId] = await nextEntryIds(q, 1);
    const codeOf = await customerCodes(q);
    const entry = await insertEntry(q, entryId, fields, codeOf(fields.customer), actor.label, "ui");
    await recordVersion(q, { entryId, action: "created", who: actor.label, importId: null, before: null, after: entry });
    await appendEventTx(q, {
      kind: "reporting.goals.entry.created",
      actor: `human:${actor.label}`,
      payload: { entryId, source: "ui" },
    });
    return entry;
  });
}

/** Applies the fields sent; the rest keep their values. A change that changes nothing writes nothing. */
export async function updateEntry(entryId: string, body: EntryBody, actor: GoalsActor): Promise<ManualEntry> {
  requireStore();
  return withTransaction(async (q) => {
    await lockEntries(q);
    const current = await liveEntry(q, entryId);
    if (!current) throw noEntry(entryId);
    const before = entryValuesOf(current);
    const checked = validateEntry({ ...before, ...body });
    if (!checked.ok) throw invalidEntry(checked.errors);
    const fields = changedFields(before, entryValuesOf(checked.value));
    if (fields.length === 0) return current;
    const customerCode = fields.includes("customer") ? (await customerCodes(q))(checked.value.customer) : current.customerCode;
    const entry = await updateEntryRow(q, current.entryId, checked.value, customerCode, actor.label);
    await recordVersion(q, { entryId: entry.entryId, action: "updated", who: actor.label, importId: null, before: current, after: entry });
    await appendEventTx(q, {
      kind: "reporting.goals.entry.updated",
      actor: `human:${actor.label}`,
      payload: { entryId: entry.entryId, fields },
    });
    return entry;
  });
}

/** Soft delete: the entry stops counting and leaves the list; its history stays. */
export async function deleteEntry(entryId: string, actor: GoalsActor): Promise<void> {
  requireStore();
  await withTransaction(async (q) => {
    await lockEntries(q);
    const current = await liveEntry(q, entryId);
    if (!current) throw noEntry(entryId);
    await softDelete(q, current.entryId, actor.label);
    await recordVersion(q, { entryId: current.entryId, action: "deleted", who: actor.label, importId: null, before: current, after: null });
    await appendEventTx(q, {
      kind: "reporting.goals.entry.deleted",
      actor: `human:${actor.label}`,
      payload: { entryId: current.entryId },
    });
  });
}

// ─── Import: preview, then confirm ──────────────────────────────────────────

export interface ImportPreview extends ImportPlan {
  importId: number;
  /** Fingerprint of the entries the preview was worked out against; confirm sends it back. */
  token: string;
  fileName: string;
}

export interface ImportResult {
  importId: number;
  added: number;
  changed: number;
  removed: number;
  unchanged: number;
}

/** A file name as the browser sent it, without any path or control characters. */
function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const printable = [...base].filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127).join("").trim();
  return (printable || "workbook.xlsx").slice(0, 200);
}

/** The month and references the statuses are judged by: the latest good refresh's (or this month, none, before one). */
async function statusContext(references: readonly (string | null)[]): Promise<EntryContext> {
  const { succeeded } = await latestRuns();
  const today = succeeded?.today ?? torontoDate(new Date());
  const refs = succeeded
    ? await loadReferenceMatches(succeeded.id, references.map((ref) => normalizeRef(ref)))
    : { filemaker: new Set<string>(), sage: new Set<string>() };
  return { monthStart: monthStart(today), monthEnd: monthEnd(today), filemakerRefs: refs.filemaker, sageRefs: refs.sage };
}

const refText = (value: DraftValue): string | null =>
  value === null || value === undefined ? null : value instanceof Date ? null : String(value);

/**
 * Reads the workbook, checks every row and works out the plan. Nothing changes
 * until confirmImport: the file and the plan are kept as a 'previewed' import
 * (the uploader's earlier previews are superseded).
 */
export async function previewImport(input: { fileName: string; bytes: Buffer; actor: GoalsActor }): Promise<ImportPreview> {
  requireStore();
  const fileName = cleanFileName(input.fileName);
  if (input.bytes.length > MAX_IMPORT_BYTES) {
    const mb = (input.bytes.length / (1024 * 1024)).toFixed(1);
    throw new ApiError("file_too_large", `The file is ${mb} MB; the limit is 2 MB.`, 413);
  }
  let rows;
  try {
    rows = await readEntriesSheet(input.bytes);
  } catch (err) {
    if (err instanceof ImportFileError) throw new ApiError(err.code, err.message, 422);
    throw err;
  }
  const current = await listEntries();
  const ctx = await statusContext([...rows.map((r) => refText(r.draft.reference)), ...current.map((e) => e.reference)]);
  const planned = planImport(rows, current, ctx);
  if (!planned.ok) throw new ApiError("invalid_rows", rowErrorsMessage(planned.errors), 422);
  const token = entriesToken(current);
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const importId = await withTransaction(async (q) => {
    await q(`UPDATE report_manual_import SET status = 'superseded' WHERE uploaded_by = $1 AND status = 'previewed'`, [
      input.actor.label,
    ]);
    const [row] = await q<{ id: string }>(
      `INSERT INTO report_manual_import (file_name, file_sha256, file_bytes, uploaded_by, base_version, preview)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING id`,
      [fileName, sha256, input.bytes, input.actor.label, token, JSON.stringify(planned.plan)]
    );
    return Number(row.id);
  });
  return { importId, token, fileName, ...planned.plan };
}

type ConfirmOutcome =
  | { kind: "applied"; result: ImportResult }
  | { kind: "not_found" }
  | { kind: "already_applied" }
  | { kind: "out_of_date" }
  | { kind: "entries_changed" };

/**
 * Applies a preview in one transaction — the sheet replaces the list: new rows
 * get the next IDs, changed rows are updated, missing entries are soft-deleted,
 * all recorded as the confirming Editor. Refused (409) when the entries changed
 * since the preview, so nobody's edit is overwritten by a stale file.
 */
export async function confirmImport(input: { importId: number; token: string; actor: GoalsActor }): Promise<ImportResult> {
  requireStore();
  const who = input.actor.label;
  const outcome = await withTransaction(async (q): Promise<ConfirmOutcome> => {
    await lockEntries(q);
    const [found] = await q<{
      id: string;
      file_name: string;
      uploaded_by: string;
      status: string;
      base_version: string;
      preview: ImportPlan;
    }>(
      `SELECT id, file_name, uploaded_by, status, base_version, preview FROM report_manual_import WHERE id = $1 FOR UPDATE`,
      [input.importId]
    );
    if (!found || found.uploaded_by !== who) return { kind: "not_found" };
    if (found.status === "applied") return { kind: "already_applied" };
    if (found.status !== "previewed" || found.base_version !== input.token) return { kind: "out_of_date" };
    const current = await listEntries(q);
    if (entriesToken(current) !== found.base_version) {
      await q(`UPDATE report_manual_import SET status = 'superseded' WHERE id = $1`, [found.id]);
      return { kind: "entries_changed" };
    }

    const plan = found.preview;
    const importId = Number(found.id);
    const source = `import:${found.file_name}`;
    const codeOf = await customerCodes(q);
    const byId = new Map(current.map((entry) => [entry.entryId, entry]));
    const ids = await nextEntryIds(q, plan.add.length);
    for (const [i, item] of plan.add.entries()) {
      const entry = await insertEntry(q, ids[i], item.fields, codeOf(item.fields.customer), who, source);
      await recordVersion(q, { entryId: entry.entryId, action: "created", who, importId, before: null, after: entry });
    }
    for (const item of plan.change) {
      const before = byId.get(item.entryId)!;
      const code = item.changed.includes("customer") ? codeOf(item.fields.customer) : before.customerCode;
      const entry = await updateEntryRow(q, item.entryId, item.fields, code, who);
      await recordVersion(q, { entryId: entry.entryId, action: "updated", who, importId, before, after: entry });
    }
    for (const item of plan.remove) {
      await softDelete(q, item.entryId, who);
      await recordVersion(q, { entryId: item.entryId, action: "deleted", who, importId, before: byId.get(item.entryId)!, after: null });
    }
    await q(`UPDATE report_manual_import SET status = 'applied', applied_at = now(), applied_by = $2 WHERE id = $1`, [found.id, who]);
    const result: ImportResult = {
      importId,
      added: plan.add.length,
      changed: plan.change.length,
      removed: plan.remove.length,
      unchanged: plan.unchanged,
    };
    await appendEventTx(q, { kind: "reporting.goals.import.confirmed", actor: `human:${who}`, payload: { ...result } });
    return { kind: "applied", result };
  });

  switch (outcome.kind) {
    case "applied":
      return outcome.result;
    case "not_found":
      throw new ApiError("not_found", `There is no import preview ${input.importId} of yours. Upload the file again.`, 404);
    case "already_applied":
      throw new ApiError("already_applied", "This import has already been applied.", 409);
    case "out_of_date":
      throw new ApiError(
        "preview_out_of_date",
        "This preview is out of date: a newer preview replaced it, or the entries changed. Upload the file again.",
        409
      );
    case "entries_changed":
      throw new ApiError(
        "entries_changed",
        "The entries changed since this preview (someone added, edited, deleted or imported entries), so nothing was imported. Upload the file again to see a fresh preview.",
        409
      );
  }
}
