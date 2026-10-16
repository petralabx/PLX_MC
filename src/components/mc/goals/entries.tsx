"use client";

// Goals & Production — entries by hand, for Editors (TASK-2897): the entry form
// (add and edit), the delete confirmation, and the Excel import (choose the
// workbook → preview what it adds, changes and removes, each with the status
// it would get → confirm). Each is a native modal <dialog>: focus moves in, Esc
// closes it, and focus goes back where it was. The form runs the server's own
// validation (entry-input.ts) first, so a mistake shows by its field. Every
// write goes through the shared api() helper; the page reloads afterwards.

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";

import { api } from "@/lib/api";
import type {
  CustomerRow,
  EntryDraft,
  EntryField,
  EntryValues,
  EvaluatedEntry,
  FieldError,
  ImportPreview,
  ImportResult,
  ManualEntry,
} from "@/lib/reporting/goals";
import {
  ENTRY_DATE_MAX,
  ENTRY_DATE_MIN,
  ENTRY_FIELDS,
  ENTRY_FIELD_LABELS,
  ENTRY_TEXT_LIMITS,
  MAX_IMPORT_BYTES,
  plainDecimal,
  validateEntry,
} from "@/lib/reporting/goals/entry-input";
import { ENTRIES_SHEET, ENTRY_CURRENCIES, ENTRY_TYPES } from "@/lib/reporting/goals/excel/layout";

import { bytesToBase64, count, day, decimal } from "./helpers";

// ─── The dialog frame ─────────────────────────────────────────────────────

function Dialog({
  title,
  onClose,
  size = "md",
  testId,
  children,
}: {
  title: string;
  onClose: () => void;
  size?: "md" | "lg";
  testId: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => {
      if (dialog.open) dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={size === "lg" ? "gp-dialog lg" : "gp-dialog"}
      aria-labelledby={titleId}
      data-testid={testId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="gp-dialog-h">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="gp-x" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      {children}
    </dialog>
  );
}

function Alert({ problem }: { problem: { title: string; lines?: string[] } | null }) {
  return (
    <div className="gp-alert" role="alert">
      {problem ? (
        <>
          <p>{problem.title}</p>
          {problem.lines && problem.lines.length > 0 ? (
            <ul>
              {problem.lines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** An entry in one line: "Shipment · Oct 14 · PO0104001 · A1 American · 24,500.00 USD". */
function entryLine(entry: ManualEntry): string {
  const amount =
    entry.type === "Batch"
      ? entry.kg && `${decimal(entry.kg, 0)} kg`
      : entry.productValue && `${decimal(entry.productValue, 2)} ${entry.currency ?? ""}`.trim();
  return [entry.type, day(entry.date), entry.reference, entry.customer, amount].filter(Boolean).join(" · ");
}

// ─── Add or edit an entry ─────────────────────────────────────────────────

type Draft = Record<EntryField, string>;

/** The fields each type uses; the other type's are sent empty (the server refuses them). */
const FIELDS_FOR = {
  Batch: ["type", "date", "reference", "product", "kg", "note"],
  Shipment: ["type", "date", "reference", "customer", "product", "productValue", "freight", "currency", "note"],
} as const satisfies Record<(typeof ENTRY_TYPES)[number], readonly EntryField[]>;

function draftOf(entry: ManualEntry | null): Draft {
  const text = (value: string | null | undefined) => value ?? "";
  return {
    type: entry?.type === "Shipment" ? "Shipment" : "Batch",
    date: text(entry?.date),
    reference: text(entry?.reference),
    customer: text(entry?.customer),
    product: text(entry?.product),
    kg: plainDecimal(entry?.kg),
    productValue: plainDecimal(entry?.productValue),
    freight: plainDecimal(entry?.freight),
    currency: text(entry?.currency),
    note: text(entry?.note),
  };
}

function bodyOf(draft: Draft): EntryDraft {
  const used: readonly EntryField[] = FIELDS_FOR[draft.type === "Shipment" ? "Shipment" : "Batch"];
  return Object.fromEntries(ENTRY_FIELDS.map((field) => [field, used.includes(field) ? draft[field] : null]));
}

function useCustomers(): { list: CustomerRow[]; failed: boolean } {
  const [state, setState] = useState<{ list: CustomerRow[]; failed: boolean }>({ list: [], failed: false });
  useEffect(() => {
    let live = true;
    api<{ customers: CustomerRow[] }>("/reporting/goals/customers")
      .then((data) => {
        if (live) setState({ list: data.customers, failed: false });
      })
      .catch(() => {
        if (live) setState({ list: [], failed: true });
      });
    return () => {
      live = false;
    };
  }, []);
  return state;
}

function Field({
  id,
  label,
  optional,
  hint,
  error,
  wide,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  hint?: string;
  error: string | null;
  wide?: boolean;
  children: (describedBy: string | undefined) => ReactNode;
}) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-err` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={wide ? "gp-field wide" : "gp-field"}>
      <label htmlFor={id}>
        {label}
        {optional ? <span className="opt"> (optional)</span> : null}
      </label>
      {children(describedBy)}
      {hint ? (
        <p className="gp-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="gp-field-err" id={`${id}-err`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Choices({
  id,
  field,
  options,
  value,
  error,
  onChange,
  autoFocus,
}: {
  id: string;
  field: "type" | "currency";
  options: readonly string[];
  value: string;
  error: string | null;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <fieldset
      className="gp-field"
      role="radiogroup"
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-err` : undefined}
    >
      <legend>{ENTRY_FIELD_LABELS[field]}</legend>
      <div className="gp-choices">
        {options.map((option) => (
          <label key={option}>
            <input
              type="radio"
              name={field}
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
              data-autofocus={autoFocus && value === option ? "" : undefined}
            />
            {option}
          </label>
        ))}
      </div>
      {error ? (
        <p className="gp-field-err" id={`${id}-err`}>
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

/** Add an entry (`entry` null) or edit one. */
export function EntryDialog({
  entry,
  line1MinKg,
  onClose,
  onSaved,
}: {
  entry: ManualEntry | null;
  line1MinKg: number;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState<Draft>(() => draftOf(entry));
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const customers = useCustomers();
  const shipment = draft.type === "Shipment";
  const fid = (field: EntryField) => `${id}-${field}`;
  const errorOf = (field: EntryField) => errors.find((e) => e.field === field)?.message ?? null;

  const set = (field: EntryField, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((list) => list.filter((e) => e.field !== field));
  };

  /** A customer picked from Sage's list brings its currency, if none is chosen yet. */
  const setCustomer = (value: string) => {
    set("customer", value);
    const picked = customers.list.find((c) => c.name === value);
    if (picked && !draft.currency && (picked.currency === "CAD" || picked.currency === "USD")) set("currency", picked.currency);
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const checked = validateEntry(bodyOf(draft));
    if (!checked.ok) {
      setErrors(checked.errors);
      setProblem(null);
      const first = checked.errors[0].field;
      form.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }
    setErrors([]);
    setProblem(null);
    setSaving(true);
    try {
      const saved = await api<{ entry: ManualEntry }>(
        entry ? `/reporting/goals/entries/${encodeURIComponent(entry.entryId)}` : "/reporting/goals/entries",
        { method: entry ? "PATCH" : "POST", body: JSON.stringify(checked.value) }
      );
      onSaved(entry ? `Saved ${saved.entry.entryId}.` : `Added ${saved.entry.entryId}.`);
    } catch (err) {
      setProblem(messageOf(err));
      setSaving(false);
    }
  }

  const text = (
    field: Exclude<EntryField, "type" | "currency" | "date" | "note">,
    options: { hint?: string; optional?: boolean; decimal?: boolean; list?: string; onChange?: (value: string) => void } = {}
  ) => (
    <Field id={fid(field)} label={ENTRY_FIELD_LABELS[field]} optional={options.optional} hint={options.hint} error={errorOf(field)}>
      {(describedBy) => (
        <input
          id={fid(field)}
          name={field}
          className="gp-input"
          type="text"
          inputMode={options.decimal ? "decimal" : undefined}
          autoComplete="off"
          list={options.list}
          maxLength={field in ENTRY_TEXT_LIMITS ? ENTRY_TEXT_LIMITS[field as keyof typeof ENTRY_TEXT_LIMITS] : 40}
          value={draft[field]}
          onChange={(event) => (options.onChange ?? ((value: string) => set(field, value)))(event.target.value)}
          aria-required={options.optional ? undefined : true}
          aria-invalid={errorOf(field) ? true : undefined}
          aria-describedby={describedBy}
        />
      )}
    </Field>
  );

  return (
    <Dialog title={entry ? `Edit entry ${entry.entryId}` : "Add an entry"} onClose={onClose} testId="goals-entry-dialog">
      <form ref={form} className="gp-form" noValidate onSubmit={(event) => void submit(event)}>
        <div className="gp-dialog-body">
          <p className="gp-dialog-text">
            For a batch or shipment FileMaker or Sage doesn’t show yet. It counts toward the goals until the system has the
            same reference.
          </p>
          <Alert
            problem={
              errors.length > 0
                ? { title: errors.length === 1 ? "Check this field:" : `Check these ${errors.length} fields:`, lines: errors.map((e) => e.message) }
                : problem
                  ? { title: problem }
                  : null
            }
          />
          <div className="gp-fields">
            <Choices id={fid("type")} field="type" options={ENTRY_TYPES} value={draft.type} error={errorOf("type")} onChange={(v) => set("type", v)} autoFocus />
            <Field id={fid("date")} label={ENTRY_FIELD_LABELS.date} hint="The day the batch finished or the shipment left." error={errorOf("date")}>
              {(describedBy) => (
                <input
                  id={fid("date")}
                  name="date"
                  className="gp-input"
                  type="date"
                  min={ENTRY_DATE_MIN}
                  max={ENTRY_DATE_MAX}
                  value={draft.date}
                  onChange={(event) => set("date", event.target.value)}
                  aria-required
                  aria-invalid={errorOf("date") ? true : undefined}
                  aria-describedby={describedBy}
                />
              )}
            </Field>
            {text("reference", {
              optional: true,
              hint: shipment
                ? "The invoice, shipment, order or PO number. The entry stops counting once Sage has it."
                : "The batch number, like BC-26290X. The entry stops counting once FileMaker shows it done.",
            })}
            {shipment
              ? text("customer", {
                  optional: true,
                  list: `${id}-customers`,
                  hint: customers.failed ? "Couldn’t load Sage’s customer list: type the name." : "Pick one of Sage’s customers, or type a name.",
                  onChange: setCustomer,
                })
              : null}
            {shipment ? (
              <datalist id={`${id}-customers`}>
                {customers.list.map((c) => (
                  <option key={c.code} value={c.name} />
                ))}
              </datalist>
            ) : null}
            {text("product", { optional: true })}
            {shipment ? null : text("kg", { decimal: true, hint: `Actual kg. ${count(line1MinKg)} kg or more counts toward Line 1.` })}
            {shipment ? text("productValue", { decimal: true, hint: "Before tax and freight." }) : null}
            {shipment ? text("freight", { decimal: true, optional: true }) : null}
            {shipment ? (
              <Choices id={fid("currency")} field="currency" options={ENTRY_CURRENCIES} value={draft.currency} error={errorOf("currency")} onChange={(v) => set("currency", v)} />
            ) : null}
            <Field id={fid("note")} label={ENTRY_FIELD_LABELS.note} optional error={errorOf("note")} wide>
              {(describedBy) => (
                <textarea
                  id={fid("note")}
                  name="note"
                  className="gp-input"
                  rows={2}
                  maxLength={ENTRY_TEXT_LIMITS.note}
                  value={draft.note}
                  onChange={(event) => set("note", event.target.value)}
                  aria-invalid={errorOf("note") ? true : undefined}
                  aria-describedby={describedBy}
                />
              )}
            </Field>
          </div>
        </div>
        <div className="gp-dialog-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={saving}>
            {saving ? "Saving…" : entry ? "Save changes" : "Add entry"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ─── Delete an entry ──────────────────────────────────────────────────────

export function DeleteEntryDialog({
  entry,
  onClose,
  onDeleted,
}: {
  entry: EvaluatedEntry;
  onClose: () => void;
  onDeleted: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setProblem(null);
    try {
      await api<{ entryId: string; deleted: boolean }>(`/reporting/goals/entries/${encodeURIComponent(entry.entryId)}`, {
        method: "DELETE",
      });
      onDeleted(`Deleted ${entry.entryId}.`);
    } catch (err) {
      setProblem(messageOf(err));
      setBusy(false);
    }
  }

  return (
    <Dialog title={`Delete entry ${entry.entryId}?`} onClose={onClose} testId="goals-delete-dialog">
      <div className="gp-dialog-body">
        <p className="gp-dialog-text">
          <b>{entryLine(entry)}</b>
        </p>
        <p className="gp-dialog-text">
          It stops counting right away and leaves the list. Mission Control keeps its history.
        </p>
        <Alert problem={problem ? { title: problem } : null} />
      </div>
      <div className="gp-dialog-actions">
        <button type="button" className="btn ghost" onClick={onClose} data-autofocus="">
          Cancel
        </button>
        <button type="button" className="btn" onClick={() => void remove()} disabled={busy}>
          {busy ? "Deleting…" : "Delete entry"}
        </button>
      </div>
    </Dialog>
  );
}

// ─── Import from Excel ────────────────────────────────────────────────────

type Problem = { title: string; lines?: string[] };

type ImportState =
  | { step: "choose"; problem: Problem | null }
  | { step: "reading"; fileName: string }
  | { step: "preview"; preview: ImportPreview; applying: boolean };

/** A server message: the first line says what happened, any further lines are one row each. */
function problemOf(err: unknown): Problem {
  const [title, ...lines] = messageOf(err).split("\n");
  return { title, lines };
}

const kgText = (value: string) =>
  Number.isFinite(Number(value)) ? Number(value).toLocaleString("en-US", { maximumFractionDigits: 3 }) : value;

function valueText(field: EntryField, value: string | null): string {
  if (value === null || value === "") return "—";
  if (field === "kg") return kgText(value);
  if (field === "productValue" || field === "freight") return decimal(value, 2);
  return value;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${count(n)} ${n === 1 ? one : many}`;
}

function summaryText(preview: ImportPreview): string {
  const { add, change, remove, unchanged } = preview;
  if (add.length + change.length + remove.length === 0) {
    return `Nothing to change: “${preview.fileName}” matches the ${plural(unchanged, "entry", "entries")} on this page.`;
  }
  return `“${preview.fileName}”: ${count(add.length)} to add, ${count(change.length)} to change, ${count(remove.length)} to remove, ${count(unchanged)} unchanged.`;
}

function PreviewTable({ label, head, rows }: { label: string; head: string[]; rows: { key: string; cells: ReactNode[] }[] }) {
  return (
    <div className="gp-preview-part">
      <h3>{label}</h3>
      <div className="gp-table-wrap" role="region" aria-label={label} tabIndex={0}>
        <table className="gp-table">
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                {row.cells.map((cell, i) =>
                  i === 0 ? (
                    <th key={i} scope="row" className="code">
                      {cell}
                    </th>
                  ) : (
                    <td key={i}>{cell}</td>
                  )
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const summaryCells = (v: EntryValues) => [
  v.type ?? "—",
  v.date ?? "—",
  valueText("reference", v.reference),
  valueText("customer", v.customer),
  v.type === "Batch" ? `${valueText("kg", v.kg)} kg` : `${valueText("productValue", v.productValue)} ${v.currency ?? ""}`.trim(),
];

function Preview({ preview }: { preview: ImportPreview }) {
  const head = ["Type", "Date", "Reference", "Customer", "kg or value"];
  return (
    <div className="gp-preview" data-testid="goals-import-preview">
      {preview.remove.length > 0 ? (
        <p className="gp-notice">
          {plural(preview.remove.length, "entry", "entries")} {preview.remove.length === 1 ? "isn’t" : "aren’t"} in the file and{" "}
          {preview.remove.length === 1 ? "will be" : "will all be"} deleted.
        </p>
      ) : null}
      {preview.add.length > 0 ? (
        <PreviewTable
          label={`To add (${count(preview.add.length)})`}
          head={["Row", ...head, "Status"]}
          rows={preview.add.map((a) => ({
            key: `row-${a.row}`,
            cells: [`Row ${a.row}`, ...summaryCells(a.fields), a.statusLabel],
          }))}
        />
      ) : null}
      {preview.change.length > 0 ? (
        <PreviewTable
          label={`To change (${count(preview.change.length)})`}
          head={["Entry", "What changes", "Status"]}
          rows={preview.change.map((c) => ({
            key: c.entryId,
            cells: [
              c.entryId,
              <ul key="changes" className="gp-changes">
                {c.changed.map((field) => (
                  <li key={field}>
                    {ENTRY_FIELD_LABELS[field]}: {valueText(field, c.before[field])} → {valueText(field, c.fields[field])}
                  </li>
                ))}
              </ul>,
              c.statusLabel,
            ],
          }))}
        />
      ) : null}
      {preview.remove.length > 0 ? (
        <PreviewTable
          label={`To remove (${count(preview.remove.length)})`}
          head={["Entry", ...head, "Status now"]}
          rows={preview.remove.map((r) => ({ key: r.entryId, cells: [r.entryId, ...summaryCells(r.before), r.statusLabel] }))}
        />
      ) : null}
    </div>
  );
}

export function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: (message: string) => void }) {
  const id = useId();
  const [state, setState] = useState<ImportState>({ step: "choose", problem: null });

  async function choose(file: File) {
    if (file.size > MAX_IMPORT_BYTES) {
      setState({ step: "choose", problem: { title: `“${file.name}” is ${(file.size / (1024 * 1024)).toFixed(1)} MB; the limit is 2 MB.` } });
      return;
    }
    setState({ step: "reading", fileName: file.name });
    try {
      const fileBase64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
      const preview = await api<ImportPreview>("/reporting/goals/import", {
        method: "POST",
        body: JSON.stringify({ fileName: file.name, fileBase64 }),
      });
      setState({ step: "preview", preview, applying: false });
    } catch (err) {
      setState({ step: "choose", problem: problemOf(err) });
    }
  }

  async function confirm(preview: ImportPreview) {
    setState({ step: "preview", preview, applying: true });
    try {
      const done = await api<ImportResult>("/reporting/goals/import/confirm", {
        method: "POST",
        body: JSON.stringify({ importId: preview.importId, token: preview.token }),
      });
      onImported(
        `Imported “${preview.fileName}”: ${count(done.added)} added, ${count(done.changed)} changed, ${count(done.removed)} removed.`
      );
    } catch (err) {
      // The preview no longer applies (entries changed, or it was replaced): start again from the file.
      setState({ step: "choose", problem: problemOf(err) });
    }
  }

  const preview = state.step === "preview" ? state.preview : null;
  const changes = preview ? preview.add.length + preview.change.length + preview.remove.length : 0;

  return (
    <Dialog title="Import manual entries" onClose={onClose} size="lg" testId="goals-import-dialog">
      <div className="gp-dialog-body">
        <p className="gp-status" role="status">
          {state.step === "reading" ? `Reading “${state.fileName}”…` : preview ? summaryText(preview) : ""}
        </p>
        {preview ? (
          <Preview preview={preview} />
        ) : (
          <>
            <p className="gp-dialog-text">
              Upload the workbook from Export to Excel. Only its “{ENTRIES_SHEET}” sheet is read, and it replaces the whole
              list: rows without an Entry ID are added, changed rows are updated, and entries missing from the sheet are
              deleted. “Entered by” and “Dashboard status” are ignored; you are recorded as the person who imported.
            </p>
            <div className="gp-field">
              <label htmlFor={`${id}-file`}>Workbook (.xlsx, up to 2 MB)</label>
              <input
                id={`${id}-file`}
                className="gp-file"
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                disabled={state.step === "reading"}
                data-autofocus=""
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  // Let the same file be chosen again after it is fixed.
                  event.target.value = "";
                  if (file) void choose(file);
                }}
              />
            </div>
          </>
        )}
        <Alert problem={state.step === "choose" ? state.problem : null} />
      </div>
      <div className="gp-dialog-actions">
        <button type="button" className="btn ghost" onClick={onClose}>
          {preview && changes === 0 ? "Close" : "Cancel"}
        </button>
        {preview && changes > 0 ? (
          <button type="button" className="btn" onClick={() => void confirm(preview)} disabled={state.step === "preview" && state.applying}>
            {state.step === "preview" && state.applying ? "Importing…" : "Confirm import"}
          </button>
        ) : null}
      </div>
    </Dialog>
  );
}
