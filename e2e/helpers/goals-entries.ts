import type { Page, Route } from "@playwright/test";

import type { GoalsPage, ImportPreview, ManualEntry } from "../../src/lib/reporting/goals";
import { entryValuesOf, validateEntry, type EntryDraft, type EntryFields } from "../../src/lib/reporting/goals/entry-input";
import { ImportFileError, planImport, readEntriesSheet, rowErrorsMessage } from "../../src/lib/reporting/goals/excel/import";
import { DATASETS, ENTRIES, goalsPage, refsOf } from "../../tests/reporting-goals-helpers";

// A stand-in for the entries API (TASK-2897) for the browser specs: the e2e
// server has no database, so the routes are served here, in memory, with the
// module's own validation, sheet reader and planner. A write really changes
// what the next GET /api/reporting/goals shows, so the specs see the page
// reload the way it does against the real routes (tests/reporting-goals-entries-postgres.test.ts).

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const fail = (route: Route, status: number, code: string, message: string) => json(route, status, { error: { code, message } });

const CTX = { monthStart: "2026-10-01", monthEnd: "2026-10-31", filemakerRefs: refsOf("filemaker"), sageRefs: refsOf("sage") };

export interface Call {
  method: string;
  path: string;
  body: unknown;
}

export class EntriesApi {
  entries: ManualEntry[];
  calls: Call[] = [];
  /** The next confirm answers 409, as if someone changed an entry after the preview. */
  conflictOnConfirm = false;
  private nextId = 8;
  private previews = new Map<number, ImportPreview>();

  constructor(
    entries: ManualEntry[] = ENTRIES,
    private editor = true
  ) {
    this.entries = entries.map((e) => ({ ...e }));
  }

  page(): GoalsPage {
    return goalsPage({ viewer: { editor: this.editor } }, this.entries);
  }

  writes(): Call[] {
    return this.calls.filter((c) => c.method !== "GET");
  }

  async install(page: Page): Promise<void> {
    await page.route("**/api/reporting/goals", (route) => json(route, 200, { data: this.page() }));
    await page.route("**/api/reporting/goals/customers", (route) =>
      json(route, 200, { data: { customers: DATASETS.customers } })
    );
    await page.route("**/api/reporting/goals/entries", (route) => this.add(route));
    await page.route("**/api/reporting/goals/entries/*", (route) => this.change(route));
    await page.route("**/api/reporting/goals/import", (route) => this.preview(route));
    await page.route("**/api/reporting/goals/import/confirm", (route) => this.confirm(route));
  }

  private record(route: Route): EntryDraft {
    const request = route.request();
    const body = (request.postDataJSON() ?? {}) as EntryDraft;
    this.calls.push({ method: request.method(), path: new URL(request.url()).pathname, body });
    return body;
  }

  private store(entryId: string, fields: EntryFields, like?: ManualEntry, source = "ui"): ManualEntry {
    return {
      entryId,
      ...fields,
      customerCode: null,
      enteredBy: like?.enteredBy ?? "editor@petrasoap.com",
      enteredAt: like?.enteredAt ?? "2026-10-14T15:00:00.000Z",
      updatedBy: "editor@petrasoap.com",
      updatedAt: "2026-10-14T15:00:00.000Z",
      source: like?.source ?? source,
    };
  }

  private newId(): string {
    return `M${String(this.nextId++).padStart(3, "0")}`;
  }

  private add(route: Route) {
    const body = this.record(route);
    const checked = validateEntry(body);
    if (!checked.ok) return fail(route, 400, "invalid_entry", checked.errors.map((e) => e.message).join(" "));
    const entry = this.store(this.newId(), checked.value);
    this.entries.push(entry);
    return json(route, 201, { data: { entry } });
  }

  private change(route: Route) {
    const body = this.record(route);
    const entryId = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop() ?? "");
    const index = this.entries.findIndex((e) => e.entryId === entryId);
    if (index < 0) return fail(route, 404, "not_found", `There is no entry ${entryId} (it may have been deleted).`);
    if (route.request().method() === "DELETE") {
      this.entries.splice(index, 1);
      return json(route, 200, { data: { entryId, deleted: true } });
    }
    const checked = validateEntry({ ...entryValuesOf(this.entries[index]), ...body });
    if (!checked.ok) return fail(route, 400, "invalid_entry", checked.errors.map((e) => e.message).join(" "));
    this.entries[index] = this.store(entryId, checked.value, this.entries[index]);
    return json(route, 200, { data: { entry: this.entries[index] } });
  }

  private async preview(route: Route) {
    const body = this.record(route) as unknown as { fileName: string; fileBase64: string };
    let rows;
    try {
      rows = await readEntriesSheet(Buffer.from(body.fileBase64, "base64"));
    } catch (err) {
      if (err instanceof ImportFileError) return fail(route, 422, err.code, err.message);
      throw err;
    }
    const planned = planImport(rows, this.entries, CTX);
    if (!planned.ok) return fail(route, 422, "invalid_rows", rowErrorsMessage(planned.errors));
    const preview: ImportPreview = { importId: this.previews.size + 1, token: "f".repeat(64), fileName: body.fileName, ...planned.plan };
    this.previews.set(preview.importId, preview);
    return json(route, 200, { data: preview });
  }

  private confirm(route: Route) {
    const body = this.record(route) as unknown as { importId: number; token: string };
    const preview = this.previews.get(body.importId);
    if (!preview || preview.token !== body.token) return fail(route, 404, "not_found", "There is no import preview of yours.");
    if (this.conflictOnConfirm) {
      return fail(
        route,
        409,
        "entries_changed",
        "The entries changed since this preview (someone added, edited, deleted or imported entries), so nothing was imported. Upload the file again to see a fresh preview."
      );
    }
    const source = `import:${preview.fileName}`;
    for (const item of preview.change) {
      const index = this.entries.findIndex((e) => e.entryId === item.entryId);
      this.entries[index] = this.store(item.entryId, item.fields, this.entries[index]);
    }
    const removed = new Set(preview.remove.map((r) => r.entryId));
    this.entries = this.entries.filter((e) => !removed.has(e.entryId));
    for (const item of preview.add) this.entries.push(this.store(this.newId(), item.fields, undefined, source));
    return json(route, 200, {
      data: {
        importId: preview.importId,
        added: preview.add.length,
        changed: preview.change.length,
        removed: preview.remove.length,
        unchanged: preview.unchanged,
      },
    });
  }
}
