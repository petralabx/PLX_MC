// Goals & Production page, entries by hand (TASK-2897): Edit and Delete on each
// row for Editors only, the entry form's fields and labels for each type, the
// import dialog's file picker, and the upload encoding. Behaviour in a browser
// (saving, deleting, importing, keyboard, layout, axe) is in
// e2e/goals-entries.spec.ts and e2e/ui-goals-entries-*.spec.ts.

import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DeleteEntryDialog, EntryDialog, ImportDialog } from "@/components/mc/goals/entries";
import { bytesToBase64, decimal, isReady, type ReadyPage } from "@/components/mc/goals/helpers";
import { EntriesTable } from "@/components/mc/goals/tables";

import { ENTRIES, goalsPage } from "./reporting-goals-helpers";

const PAGE = goalsPage();
if (!isReady(PAGE)) throw new Error("fixture page should be ready");
const READY: ReadyPage = PAGE;
const M3 = READY.model.entries.find((e) => e.entryId === "M003")!;

const html = <P extends object>(component: ComponentType<P>, props: P) => renderToStaticMarkup(createElement(component, props));
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const noop = () => {};

/** Every <input> in the markup as its attributes, whatever their order. */
const inputs = (markup: string) =>
  [...markup.matchAll(/<input([^>]*)\/?>/g)].map(([, attrs]) =>
    Object.fromEntries([...attrs.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(([, name, value]) => [name, value ?? ""]))
  );
const input = (markup: string, attrs: Record<string, string>) =>
  inputs(markup).find((i) => Object.entries(attrs).every(([k, v]) => i[k] === v));

describe("entries table actions", () => {
  it("gives Editors Edit and Delete on every row, named for the entry, and nothing to Viewers", () => {
    const editor = html(EntriesTable, { page: READY, actions: { onEdit: noop, onDelete: noop } });
    for (const entry of ENTRIES) {
      expect(text(editor)).toContain(`Edit ${entry.entryId}`);
      expect(text(editor)).toContain(`Delete ${entry.entryId}`);
    }
    expect(editor.match(/<button/g)).toHaveLength(ENTRIES.length * 2);
    // Retired rows keep their actions and stay dimmed, not hidden.
    expect(editor.match(/<tr class="hand retired">/g)).toHaveLength(3);
    const viewer = html(EntriesTable, { page: READY });
    expect(viewer).not.toContain("<button");
    expect(text(viewer)).not.toContain("Actions");
  });
});

describe("entry form", () => {
  it("adds a batch by default: type, date, reference, product, kg and note, each labelled", () => {
    const markup = html(EntryDialog, { entry: null, line1MinKg: 5000, onClose: noop, onSaved: noop });
    const out = text(markup);
    expect(markup).toContain('aria-labelledby');
    expect(out).toContain("Add an entry");
    expect(input(markup, { type: "radio", name: "type", value: "Batch" })).toHaveProperty("checked");
    expect(input(markup, { name: "date" })).toMatchObject({ type: "date", min: "2000-01-01", max: "2099-12-31", "aria-required": "true" });
    expect(input(markup, { name: "kg" })).toMatchObject({ inputMode: "decimal", "aria-required": "true" });
    for (const label of ["Type", "Date", "Reference (optional)", "Product (optional)", "kg", "Note (optional)"]) {
      expect(out).toContain(label);
    }
    expect(out).toContain("Actual kg. 5,000 kg or more counts toward Line 1.");
    for (const field of ["customer", "productValue", "freight", "currency"]) expect(markup).not.toContain(`name="${field}"`);
    // Every input is labelled by a <label for> with its id.
    for (const [, id] of markup.matchAll(/<input[^>]*id="([^"]+)"/g)) expect(markup).toContain(`for="${id}"`);
    expect(out).toContain("Cancel Add entry");
  });

  it("edits a shipment with its values filled in the way a person types them", () => {
    const markup = html(EntryDialog, { entry: { ...M3, productValue: "24500.00", freight: "1250.00" }, line1MinKg: 5000, onClose: noop, onSaved: noop });
    expect(text(markup)).toContain("Edit entry M003");
    expect(input(markup, { name: "type", value: "Shipment" })).toHaveProperty("checked");
    expect(input(markup, { name: "currency", value: "USD" })).toHaveProperty("checked");
    expect(input(markup, { name: "currency", value: "CAD" })).not.toHaveProperty("checked");
    expect(input(markup, { name: "productValue" })).toMatchObject({ value: "24500", "aria-required": "true" });
    expect(input(markup, { name: "freight" })).toMatchObject({ value: "1250" });
    expect(input(markup, { name: "freight" })).not.toHaveProperty("aria-required");
    expect(input(markup, { name: "customer" })).toMatchObject({ value: "A1 American", list: expect.stringMatching(/-customers$/) });
    expect(markup).not.toContain('name="kg"');
    expect(text(markup)).toContain("Save changes");
  });
});

describe("delete and import dialogs", () => {
  it("names the entry being deleted and keeps Cancel first", () => {
    const out = text(html(DeleteEntryDialog, { entry: M3, onClose: noop, onDeleted: noop }));
    expect(out).toContain("Delete entry M003?");
    expect(out).toContain("Shipment · Oct 14 · PO0104001 · A1 American · 24,500.00 USD");
    expect(out).toContain("Cancel Delete entry");
  });

  it("asks for the workbook with a labelled .xlsx picker and says the sheet replaces the list", () => {
    const markup = html(ImportDialog, { onClose: noop, onImported: noop });
    expect(input(markup, { type: "file" })).toMatchObject({
      accept: ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    expect(text(markup)).toContain("Workbook (.xlsx, up to 2 MB)");
    expect(text(markup)).toContain("it replaces the whole list");
    expect(markup).toContain('role="status"');
    expect(markup).toContain('role="alert"');
  });
});

describe("helpers", () => {
  it("encodes uploads exactly, across the chunk boundary", () => {
    const bytes = new Uint8Array(70_001);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 7919) % 256;
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
    expect(bytesToBase64(new Uint8Array())).toBe("");
  });

  it("shows stored decimals with separators", () => {
    expect([decimal("24500.00", 2), decimal("10050.000", 0), decimal(null, 2), decimal("n/a", 2)]).toEqual(["24,500.00", "10,050", "", "n/a"]);
  });
});
