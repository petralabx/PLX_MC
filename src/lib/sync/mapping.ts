// Mapping layer: MC entity fields ↔ SharePoint columns, per the §3 direction
// tables in docs/product/SHAREPOINT_INTEGRATION.md. Internal column names
// come from config/sharepoint-schema.json; directions mirror SP_LISTS in
// src/lib/mc-data/data.ts (keep all three aligned — the spec wins).
//
// Person columns on ToDos (Assigned To ↔, Accountable Owner →, Reporter →) ARE
// mapped (Item 1): SharePoint stores a Person as `<InternalName>LookupId` — the
// numeric id of the user in the site User Information List — so this pure layer
// emits a PRE-RESOLVED id passed in `opts.persons`; the engine (graph.ts) does
// the email→lookupId resolution + caching and the honest fail-visible miss path.
// The Initiative lookup column stays deferred (no lookup-id resolution yet).
//
// §5.2: the Risk Register's Likelihood column stores High/Med/Low BY DESIGN;
// this layer normalizes MC's "Medium" → "Med" outbound and back inbound —
// exactly the bug class the error queue exists to surface.

import { ACTORS, HUMANS, PRIORITY, STAGES } from "@/lib/mc-data/data";
import { evidenceComplete } from "@/lib/mc-data/helpers";
import type { Repo, Risk, StageKey, Subtask, Task } from "@/lib/mc-data/types";

export type EntityType = "task" | "risk" | "file";
export type EntityData = Record<string, unknown>;

export const LIST_KEY_FOR: Record<EntityType, string> = {
  task: "todos",
  risk: "risks",
  file: "documents",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// MC due dates are display strings ("Jun 16", "—"). Serialize parseable ones
// to UTC ISO (current year); omit the rest. Inbound renders back to "Mon D".
export function dueToIso(due: string | undefined): string | null {
  const m = /^([A-Z][a-z]{2})\s+(\d{1,2})$/.exec(String(due ?? "").trim());
  if (!m) return null;
  const month = MONTHS.indexOf(m[1]);
  if (month === -1) return null;
  const year = new Date().getUTCFullYear();
  return new Date(Date.UTC(year, month, Number(m[2]))).toISOString();
}

export function isoToDue(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // Pad the day to two digits — the canonical MC display format ("Jun 06"),
  // so inbound comparison is stable against the fixtures.
  return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, "0")}`;
}

const STAGE_TO_STATUS = Object.fromEntries(STAGES.map((s) => [s.key, s.name]));
const STATUS_TO_STAGE = Object.fromEntries(STAGES.map((s) => [s.name, s.key]));

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ─── Person columns (ToDos) ──────────────────────────────────────────────────

// MC actor field → SharePoint Person column (internal name) + direction. A
// Person column is written via `<sp>LookupId`; the resolved id is supplied by
// the engine in `outboundFields(..., { persons })`. assignee is two-way; the
// accountable owner + reporter are push-only (SP_LISTS / schema is the authority).
export type TaskPersonMc = "assignee" | "accountableOwner" | "reporter";
export const TASK_PERSON_FIELDS: { mc: TaskPersonMc; sp: string; dir: "two-way" | "push" }[] = [
  { mc: "assignee", sp: "AssignedTo", dir: "two-way" },
  { mc: "accountableOwner", sp: "AccountableOwner", dir: "push" },
  { mc: "reporter", sp: "Reporter", dir: "push" },
];

// What the engine must do for each person column on a task, decided purely
// (no I/O) so it is unit-testable: `clear` (no actor → send a null LookupId to
// empty the column), `resolve` (a human with an email → resolve to a site-user
// lookup id), or `skip` (an agent / actor with no SharePoint identity → leave
// the column untouched, never fabricate a person). UIL-miss is decided by the
// engine after resolution (a resolve target whose id comes back null).
export interface PersonPlan {
  clear: TaskPersonMc[];
  resolve: { mc: TaskPersonMc; sp: string; actorId: string; email: string }[];
  skip: { mc: TaskPersonMc; actorId: string }[];
}

export function planTaskPersons(task: Pick<Task, TaskPersonMc>): PersonPlan {
  const plan: PersonPlan = { clear: [], resolve: [], skip: [] };
  for (const { mc, sp } of TASK_PERSON_FIELDS) {
    const actorId = task[mc];
    if (!actorId) {
      plan.clear.push(mc);
      continue;
    }
    const human = HUMANS[actorId];
    if (human?.email) plan.resolve.push({ mc, sp, actorId, email: human.email });
    else plan.skip.push({ mc, actorId }); // agent or unknown — no SharePoint person
  }
  return plan;
}

// Reverse of the directory email lookup, for inbound assignee mirroring: a
// SharePoint site-user email → the MC human actor id (or null when no human
// matches — never guess).
export function actorIdByEmail(email: string): string | null {
  const needle = String(email).toLowerCase();
  const hit = Object.values(HUMANS).find((h) => (h.email ?? "").toLowerCase() === needle);
  return hit?.id ?? null;
}

// ─── Sub-tasks (ToDos, push-only — Item 3) ───────────────────────────────────

// Serialize a task's sub-tasks to a stable, human-readable multiline string for
// the push-only `Subtasks` ToDos column. One line per sub-task:
//   `[x] SUB-1 · title · @Executor · due Jun 16 · status`
// Push-only by design — Mission Control owns the structured Subtask[] (the
// system of record), so the column is a one-way human-readable mirror and is
// never parsed back (inboundPatches ignores it).
export function serializeSubtasks(subtasks: Subtask[] | undefined): string {
  return (subtasks ?? [])
    .map((s) => {
      const parts = [`${s.done ? "[x]" : "[ ]"} ${s.id} · ${s.t}`];
      const exec = s.assignee ?? s.who;
      if (exec) parts.push(`@${ACTORS[exec]?.name ?? exec}`);
      if (s.due && s.due !== "—") parts.push(`due ${s.due}`);
      if (s.status) parts.push(s.status);
      return parts.join(" · ");
    })
    .join("\n");
}

// ─── Outbound (push + two-way columns) ───────────────────────────────────────

// Returns the Graph `fields` payload for an entity. `creating` additionally
// writes the pull-direction identity key (Task ID) — SharePoint owns it
// afterwards, but the unique key must exist from the first write.
export function outboundFields(
  type: EntityType,
  data: EntityData,
  opts: { creating?: boolean; only?: string[]; persons?: Partial<Record<TaskPersonMc, number | null>> } = {}
): Record<string, unknown> {
  const include = (mcField: string) => !opts.only || opts.only.includes(mcField);
  const out: Record<string, unknown> = {};

  if (type === "task") {
    const t = data as unknown as Task;
    if (opts.creating) out.TaskID = t.id;
    if (include("title")) out.Title = t.title;
    if (include("stage")) out.Status = STAGE_TO_STATUS[t.stage] ?? capitalize(t.stage);
    if (include("priority")) out.Priority = PRIORITY[t.priority]?.label ?? capitalize(t.priority);
    if (include("due")) {
      const iso = dueToIso(t.due);
      if (iso) out.DueDate = iso;
    }
    if (include("description")) out.Description = t.description ?? "";
    if (include("reqs")) out.PRDRequirements = (t.reqs ?? []).join("\n");
    if (include("estimate")) out.Estimate = t.estimate;
    if (include("repos")) out.Repos = (t.repos ?? []).join("\n");
    if (include("targetEnv")) out.TargetEnvironment = capitalize(t.targetEnv ?? "staging");
    if (include("evidence")) out.EvidenceComplete = evidenceComplete(t.evidence);
    if (include("subtasks")) out.Subtasks = serializeSubtasks(t.subtasks); // Item 3 — push-only
    // Person columns: emit `<sp>LookupId` from the pre-resolved `persons` map.
    // A number sets the person, `null` clears it; a field absent from the map is
    // left untouched (the engine omits UIL-miss / agent persons — never faked).
    if (opts.persons) {
      for (const { mc, sp } of TASK_PERSON_FIELDS) {
        if (!include(mc)) continue;
        const lookupId = opts.persons[mc];
        if (lookupId !== undefined) out[`${sp}LookupId`] = lookupId;
      }
    }
    return out;
  }

  if (type === "risk") {
    const r = data as unknown as Risk;
    if (include("title")) out.Title = r.title;
    // §5.2 normalization: MC "Medium" → SharePoint "Med".
    if (include("like")) out.Likelihood = r.like === "Medium" ? "Med" : r.like;
    if (include("impact")) out.Impact = r.impact;
    if (include("status")) out.Status = capitalize(r.status);
    if (include("mit")) out.Mitigation = r.mit;
    return out;
  }

  // Documents (file content + driveItem metadata) are a later increment.
  throw new Error(`outbound mapping not implemented for entity type "${type}"`);
}

// ─── Repo Registry list (EN-002 / Item 2) ────────────────────────────────────

// The repo registry is push-only — Mission Control is authoritative for the
// allow-list, so the "Repo Registry" list is a one-way mirror (never read back).
// RepoID is the indexed unique key, set on the first write (like Task ID).
export function repoOutboundFields(repo: Repo, opts: { creating?: boolean } = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {
    Title: repo.name,
    Owner: repo.owner,
    Visibility: repo.visibility === "public" ? "Public" : "Private",
    DefaultBranch: repo.def,
    Language: repo.lang,
    Scope: repo.scope,
  };
  if (opts.creating) out.RepoID = repo.id;
  return out;
}

// ─── Inbound (pull + two-way columns) ────────────────────────────────────────

// Maps SharePoint fields → MC entity patches. Unknown/unparseable values are
// skipped (never guess); push-only columns are never applied inbound.
export function inboundPatches(
  type: EntityType,
  spFields: Record<string, unknown>
): EntityData {
  const patches: EntityData = {};

  if (type === "task") {
    if (typeof spFields.Title === "string") patches.title = spFields.Title;
    if (typeof spFields.Status === "string") {
      const stage = STATUS_TO_STAGE[spFields.Status] as StageKey | undefined;
      if (stage) patches.stage = stage;
    }
    if (typeof spFields.Priority === "string") {
      const key = spFields.Priority.toLowerCase();
      if (key in PRIORITY) patches.priority = key;
    }
    if (typeof spFields.DueDate === "string") {
      const due = isoToDue(spFields.DueDate);
      if (due) patches.due = due;
    }
    if (typeof spFields.Description === "string") patches.description = spFields.Description;
    return patches;
  }

  if (type === "risk") {
    if (typeof spFields.Title === "string") patches.title = spFields.Title;
    if (typeof spFields.Likelihood === "string") {
      // Inverse of the §5.2 normalization.
      const like = spFields.Likelihood === "Med" ? "Medium" : spFields.Likelihood;
      if (["High", "Medium", "Low"].includes(like)) patches.like = like;
    }
    if (typeof spFields.Impact === "string" && ["High", "Medium", "Low"].includes(spFields.Impact)) {
      patches.impact = spFields.Impact;
    }
    if (typeof spFields.Status === "string") {
      const status = spFields.Status.toLowerCase();
      if (["open", "mitigating", "closed"].includes(status)) patches.status = status;
    }
    if (typeof spFields.Mitigation === "string") patches.mit = spFields.Mitigation;
    return patches;
  }

  return patches;
}

// ─── Field name translation (conflict/error rows use SP display names) ──────

const FIELD_DISPLAY: Record<EntityType, Record<string, string>> = {
  task: {
    title: "Title",
    stage: "Status",
    priority: "Priority",
    due: "Due Date",
    description: "Description",
    assignee: "Assigned To",
    accountableOwner: "Accountable Owner",
    reporter: "Reporter",
    reqs: "PRD Requirements",
    estimate: "Estimate",
    repos: "Repos",
    targetEnv: "Target Environment",
    evidence: "Evidence Complete",
    subtasks: "Sub-tasks",
  },
  risk: { title: "Title", like: "Likelihood", impact: "Impact", status: "Status", mit: "Mitigation" },
  file: { name: "Name", docType: "Document Type", modified: "Modified" },
};

export function displayFieldFor(type: EntityType, mcField: string): string | undefined {
  return FIELD_DISPLAY[type][mcField];
}

export function mcFieldFor(type: EntityType, displayField: string): string | undefined {
  return Object.entries(FIELD_DISPLAY[type]).find(([, d]) => d === displayField)?.[0];
}

// Validating parse of a display-string value back into a typed MC field value
// (used when a human keeps the SharePoint side of a conflict). Returns
// undefined when the value cannot be applied safely — never guess.
export function parseFieldValue(type: EntityType, mcField: string, raw: string): unknown | undefined {
  if (type === "task") {
    switch (mcField) {
      case "title":
      case "description":
        return raw;
      case "assignee":
      case "accountableOwner":
      case "reporter":
        // The engine resolves an inbound person to an MC actor id BEFORE a
        // conflict is raised, so the SharePoint side of a person conflict is an
        // actor id — validate it against the directory, never guess.
        return raw in ACTORS ? raw : undefined;
      case "stage":
        if (raw in STAGE_TO_STATUS) return raw;
        return STATUS_TO_STAGE[raw];
      case "priority": {
        const key = raw.toLowerCase();
        return key in PRIORITY ? key : undefined;
      }
      case "due":
        return /^[A-Z][a-z]{2}\s+\d{1,2}$/.test(raw) ? raw : (isoToDue(raw) ?? undefined);
      default:
        return undefined;
    }
  }
  if (type === "risk") {
    switch (mcField) {
      case "title":
      case "mit":
        return raw;
      case "like":
      case "impact": {
        const v = raw === "Med" ? "Medium" : raw;
        return ["High", "Medium", "Low"].includes(v) ? v : undefined;
      }
      case "status": {
        const v = raw.toLowerCase();
        return ["open", "mitigating", "closed"].includes(v) ? v : undefined;
      }
      default:
        return undefined;
    }
  }
  return undefined;
}

// Human-readable serialization used for conflict rows (mcVal/spVal) so both
// sides of the review queue show comparable values.
export function displayValue(value: unknown): string {
  if (value == null) return "—";
  if (Array.isArray(value)) return value.join("\n");
  return String(value);
}

// Pure reconciliation step for one inbound item (unit-tested): a patch
// applies cleanly unless the same field is locally dirty with a different
// value — that is a two-sided conflict (§5.1), never an overwrite.
export function reconcileInbound(
  data: EntityData,
  dirtyFields: string[],
  patches: EntityData
): {
  apply: EntityData;
  conflicts: { field: string; mcVal: string; spVal: string }[];
} {
  const apply: EntityData = {};
  const conflicts: { field: string; mcVal: string; spVal: string }[] = [];
  for (const [field, spVal] of Object.entries(patches)) {
    const mcVal = data[field];
    if (displayValue(mcVal) === displayValue(spVal)) continue;
    if (dirtyFields.includes(field)) {
      conflicts.push({ field, mcVal: displayValue(mcVal), spVal: displayValue(spVal) });
    } else {
      apply[field] = spVal;
    }
  }
  return { apply, conflicts };
}
