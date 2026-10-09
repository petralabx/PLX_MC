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
// Initiative on ToDos is two-way via `InitiativeLookupId` (pre-resolved in
// `opts.initiativeLookupId` the same way persons are).
//
// §5.2: the Risk Register's Likelihood column stores High/Med/Low BY DESIGN;
// this layer normalizes MC's "Medium" → "Med" outbound and back inbound —
// exactly the bug class the error queue exists to surface.

import { ACTORS, HUMANS, PRIORITY, STAGES } from "@/lib/mc-data/data";
import { evidenceComplete } from "@/lib/mc-data/helpers";
import type { Bucket, Project, Repo, Risk, StageKey, Subtask, Task } from "@/lib/mc-data/types";

export type EntityType = "task" | "risk" | "file" | "bucket";
/** Subjects persisted in sync_conflicts; Projects live outside entities. */
export type SyncConflictSubject = EntityType | "project";
export type EntityData = Record<string, unknown>;

export const LIST_KEY_FOR: Record<EntityType, string> = {
  task: "todos",
  risk: "risks",
  file: "documents",
  bucket: "roadmap",
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
  opts: {
    creating?: boolean;
    only?: string[];
    persons?: Partial<Record<TaskPersonMc, number | null>>;
    /** Pre-resolved Roadmap item id for the Initiative lookup (null clears). */
    initiativeLookupId?: number | null;
  } = {}
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
    // Initiative lookup: emit only when the engine supplied a resolved id (or
    // null to clear). Absent means "leave untouched" (bucket not yet mirrored).
    if (include("bucket") && opts.initiativeLookupId !== undefined) {
      out.InitiativeLookupId = opts.initiativeLookupId;
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

const HEALTH_TO_SP: Record<string, string> = {
  track: "On track",
  risk: "At risk",
  off: "Off track",
};

// MC display dates: "Mon DD" (dueToIso) or "YYYY.MM.DD" (fixture started dates).
export function mcDateToIso(value: string | undefined): string | null {
  const iso = dueToIso(value);
  if (iso) return iso;
  const dotted = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(String(value ?? "").trim());
  if (!dotted) return null;
  return new Date(Date.UTC(Number(dotted[1]), Number(dotted[2]) - 1, Number(dotted[3]))).toISOString();
}

// ─── Projects list (P2 — push-only mirror) ───────────────────────────────────

export function projectOutboundFields(project: Project, opts: { creating?: boolean } = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {
    Title: project.name,
    Health: HEALTH_TO_SP[project.health] ?? "On track",
    Description: project.desc || undefined,
    PRDLink: project.prd || undefined,
  };
  const started = mcDateToIso(project.started);
  const target = mcDateToIso(project.target);
  if (started) out.StartDate = started;
  if (target) out.TargetDate = target;
  if (opts.creating) out.ProjectID = project.id;
  return out;
}

// ─── Roadmap / buckets list (EN-005 — push-only mirror) ──────────────────────

export function bucketOutboundFields(
  bucket: Bucket,
  opts: { creating?: boolean; ownerLookupId?: number | null; projectLookupId?: number | null } = {}
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    Title: bucket.name,
    Health: HEALTH_TO_SP[bucket.health] ?? "On track",
    PRDLink: bucket.prd || undefined,
  };
  const started = mcDateToIso(bucket.started);
  const target = mcDateToIso(bucket.target);
  if (started) out.StartDate = started;
  if (target) out.TargetDate = target;
  if (opts.creating) out.InitiativeID = bucket.id;
  if (opts.ownerLookupId) out.OwnerLookupId = opts.ownerLookupId;
  if (opts.projectLookupId) out.ProjectLookupId = opts.projectLookupId;
  if (typeof bucket.progress === "number") out.PercentComplete = bucket.progress;
  return out;
}

const SP_TO_HEALTH: Record<string, Bucket["health"]> = {
  "On track": "track",
  "At risk": "risk",
  "Off track": "off",
};

// Roadmap inbound (routing-relevant Gantt + optional resolved project).
// Owner/PRD remain push-only — never applied here.
export function inboundBucketPatches(
  spFields: Record<string, unknown>,
  opts: { project?: string | null } = {}
): Partial<Bucket> {
  const patches: Partial<Bucket> = {};
  if (typeof spFields.Title === "string" && spFields.Title.trim()) patches.name = spFields.Title;
  if (typeof spFields.Health === "string") {
    const health = SP_TO_HEALTH[spFields.Health];
    if (health) patches.health = health;
  }
  if (typeof spFields.StartDate === "string") {
    const started = isoToDue(spFields.StartDate);
    if (started) patches.started = started;
  }
  if (typeof spFields.TargetDate === "string") {
    const target = isoToDue(spFields.TargetDate);
    if (target) patches.target = target;
  }
  if (typeof spFields.PercentComplete === "number" && Number.isFinite(spFields.PercentComplete)) {
    patches.progress = spFields.PercentComplete;
  }
  if (opts.project !== undefined) patches.project = opts.project;
  return patches;
}

/** Projects inbound (routing-relevant). Owner/PRD stay push-only. */
export function inboundProjectPatches(spFields: Record<string, unknown>): Partial<Project> {
  const patches: Partial<Project> = {};
  if (typeof spFields.Title === "string" && spFields.Title.trim()) patches.name = spFields.Title;
  if (typeof spFields.Health === "string") {
    const health = SP_TO_HEALTH[spFields.Health];
    if (health) patches.health = health;
  }
  if (typeof spFields.StartDate === "string") {
    const started = isoToDue(spFields.StartDate) ?? isoToDotted(spFields.StartDate);
    if (started) patches.started = started;
  }
  if (typeof spFields.TargetDate === "string") {
    const target = isoToDue(spFields.TargetDate) ?? isoToDotted(spFields.TargetDate);
    if (target) patches.target = target;
  }
  if (typeof spFields.Description === "string") patches.desc = spFields.Description;
  return patches;
}

function isoToDotted(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}`;
}

// ─── Adoption ID + row validation (P4) ───────────────────────────────────────

export const TASK_ID_RE = /^TASK-[0-9]+$/;
export const BUCKET_ID_RE = /^BKT-[A-Z0-9-]+$/;
export const PROJECT_ID_RE = /^PRJ-[A-Z0-9-]+$/;

export type FieldSource = "human" | "service" | "unknown";

export interface FieldAttribution {
  source: FieldSource;
  at: string;
  actorId?: string;
}

/** Routing fields where a newer attributable human SharePoint edit may beat service pending. */
export const ROUTING_TASK_FIELDS = new Set([
  "title",
  "stage",
  "priority",
  "due",
  "description",
  "assignee",
  "bucket",
]);
export const ROUTING_BUCKET_FIELDS = new Set([
  "name",
  "health",
  "started",
  "target",
  "progress",
  "project",
]);
export const ROUTING_PROJECT_FIELDS = new Set(["name", "health", "started", "target", "desc"]);

export interface AdoptionValidation {
  ok: boolean;
  id?: string;
  errors: string[];
}

export function validateAdoptedTaskId(raw: unknown): AdoptionValidation {
  if (typeof raw !== "string" || !TASK_ID_RE.test(raw)) {
    return { ok: false, errors: ["invalid_or_missing_task_id"] };
  }
  return { ok: true, id: raw, errors: [] };
}

export function validateAdoptedBucketId(raw: unknown): AdoptionValidation {
  if (typeof raw !== "string" || !BUCKET_ID_RE.test(raw)) {
    return { ok: false, errors: ["invalid_or_missing_initiative_id"] };
  }
  return { ok: true, id: raw, errors: [] };
}

export function validateAdoptedProjectId(raw: unknown): AdoptionValidation {
  if (typeof raw !== "string" || !PROJECT_ID_RE.test(raw)) {
    return { ok: false, errors: ["invalid_or_missing_project_id"] };
  }
  return { ok: true, id: raw, errors: [] };
}

/** Validate required identity + enum values for an inbound adoption candidate. */
export function validateInboundAdoptionRow(
  kind: "task" | "bucket" | "project",
  fields: Record<string, unknown>
): AdoptionValidation {
  const errors: string[] = [];
  if (kind === "task") {
    const idCheck = validateAdoptedTaskId(fields.TaskID);
    if (!idCheck.ok) return idCheck;
    if (typeof fields.Title !== "string" || !fields.Title.trim()) errors.push("missing_title");
    if (typeof fields.Status === "string" && !(fields.Status in STATUS_TO_STAGE)) {
      errors.push("invalid_status");
    }
    if (typeof fields.Priority === "string" && !(fields.Priority.toLowerCase() in PRIORITY)) {
      errors.push("invalid_priority");
    }
    return { ok: errors.length === 0, id: idCheck.id, errors };
  }
  if (kind === "bucket") {
    const idCheck = validateAdoptedBucketId(fields.InitiativeID);
    if (!idCheck.ok) return idCheck;
    if (typeof fields.Title !== "string" || !fields.Title.trim()) errors.push("missing_title");
    if (typeof fields.Health === "string" && !(fields.Health in SP_TO_HEALTH)) {
      errors.push("invalid_health");
    }
    return { ok: errors.length === 0, id: idCheck.id, errors };
  }
  const idCheck = validateAdoptedProjectId(fields.ProjectID);
  if (!idCheck.ok) return idCheck;
  if (typeof fields.Title !== "string" || !fields.Title.trim()) errors.push("missing_title");
  if (typeof fields.Health === "string" && !(fields.Health in SP_TO_HEALTH)) {
    errors.push("invalid_health");
  }
  return { ok: errors.length === 0, id: idCheck.id, errors };
}

export function numericTaskId(taskId: string): number | null {
  const m = /^TASK-([0-9]+)$/.exec(taskId);
  return m ? Number(m[1]) : null;
}

// ─── Inbound (pull + two-way columns) ────────────────────────────────────────

// Maps SharePoint fields → MC entity patches. Unknown/unparseable values are
// skipped (never guess); push-only columns are never applied inbound.
// InitiativeLookupId is resolved by the engine (sp_item_id → bucket id) before
// reconcile — pass the resolved bucket id via `opts.bucket` when known.
export function inboundPatches(
  type: EntityType,
  spFields: Record<string, unknown>,
  opts: { bucket?: string | null } = {}
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
    if (opts.bucket !== undefined) patches.bucket = opts.bucket;
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
    bucket: "Initiative",
    reqs: "PRD Requirements",
    estimate: "Estimate",
    repos: "Repos",
    targetEnv: "Target Environment",
    evidence: "Evidence Complete",
    subtasks: "Sub-tasks",
  },
  risk: { title: "Title", like: "Likelihood", impact: "Impact", status: "Status", mit: "Mitigation" },
  file: { name: "Name", docType: "Document Type", modified: "Modified" },
  bucket: {
    name: "Title",
    health: "Health",
    started: "Start Date",
    target: "Target Date",
    progress: "% Complete",
    project: "Project",
  },
};

const PROJECT_FIELD_DISPLAY: Record<string, string> = {
  name: "Title",
  health: "Health",
  started: "Start Date",
  target: "Target Date",
  desc: "Description",
};

export const CONFLICT_LIST_KEY_FOR: Record<SyncConflictSubject, string> = {
  task: "todos",
  risk: "risks",
  file: "documents",
  bucket: "roadmap",
  project: "projects",
};

export function displayFieldFor(type: SyncConflictSubject, mcField: string): string | undefined {
  if (type === "project") return PROJECT_FIELD_DISPLAY[mcField];
  return FIELD_DISPLAY[type][mcField];
}

export function mcFieldFor(type: SyncConflictSubject, displayField: string): string | undefined {
  if (type === "project") {
    return Object.entries(PROJECT_FIELD_DISPLAY).find(([, d]) => d === displayField)?.[0];
  }
  return Object.entries(FIELD_DISPLAY[type]).find(([, d]) => d === displayField)?.[0];
}

// Validating parse of a display-string value back into a typed MC field value
// (used when a human keeps the SharePoint side of a conflict). Returns
// undefined when the value cannot be applied safely — never guess.
export function parseFieldValue(
  type: SyncConflictSubject,
  mcField: string,
  raw: string
): unknown | undefined {
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
      case "bucket":
        // Engine resolves InitiativeLookupId → BKT-* before conflict rows are
        // written, so keep-SP receives a bucket id — accept BKT- prefixed ids.
        return /^BKT-[A-Z0-9-]+$/.test(raw) ? raw : undefined;
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
  if (type === "bucket" || type === "project") {
    switch (mcField) {
      case "name":
      case "desc":
        return raw;
      case "health":
        return raw === "track" || raw === "risk" || raw === "off"
          ? raw
          : SP_TO_HEALTH[raw];
      case "started":
      case "target":
        return /^(?:[A-Z][a-z]{2}\s+\d{1,2}|\d{4}\.\d{2}\.\d{2})$/.test(raw)
          ? raw
          : (isoToDue(raw) ?? undefined);
      case "progress": {
        const n = Number(raw);
        return Number.isFinite(n) && n >= 0 && n <= 100 ? n : undefined;
      }
      case "project":
        if (raw === "—" || raw === "") return null;
        return PROJECT_ID_RE.test(raw) ? raw : undefined;
      default:
        return undefined;
    }
  }
  return undefined;
}

/**
 * Serialize one routing-relevant planning field for conflict keep-MC.
 * Person ownership and PRD are intentionally excluded (MC-push-only but not
 * conflict subjects); Project lookup requires a pre-resolved item id.
 */
export function planningOutboundField(
  type: "bucket" | "project",
  data: Bucket | Project,
  mcField: string,
  opts: { projectLookupId?: number | null } = {}
): Record<string, unknown> | null {
  if (mcField === "name") return { Title: data.name };
  if (mcField === "health") {
    return { Health: HEALTH_TO_SP[data.health] ?? "On track" };
  }
  if (mcField === "started" || mcField === "target") {
    const value = mcDateToIso(data[mcField]);
    if (!value) return null;
    return { [mcField === "started" ? "StartDate" : "TargetDate"]: value };
  }
  if (type === "project" && mcField === "desc") {
    return { Description: (data as Project).desc ?? "" };
  }
  if (type === "bucket" && mcField === "progress") {
    const progress = (data as Bucket).progress;
    return typeof progress === "number" ? { PercentComplete: progress } : null;
  }
  if (type === "bucket" && mcField === "project") {
    if ((data as Bucket).project == null) return { ProjectLookupId: null };
    return opts.projectLookupId !== undefined
      ? { ProjectLookupId: opts.projectLookupId }
      : null;
  }
  return null;
}

// Human-readable serialization used for conflict rows (mcVal/spVal) so both
// sides of the review queue show comparable values.
export function displayValue(value: unknown): string {
  if (value == null) return "—";
  if (Array.isArray(value)) return value.join("\n");
  return String(value);
}

export interface ReconcileInboundOpts {
  /** Attribution of the inbound SharePoint edit (from lastModifiedBy). */
  inboundSource?: FieldSource;
  inboundAt?: string;
  /** Per-field local dirty attribution (human/service/unknown). */
  localAttribution?: Record<string, FieldAttribution>;
  /** Fields eligible for human-over-service precedence. */
  routingFields?: Set<string>;
}

export interface ReconcileInboundResult {
  apply: EntityData;
  conflicts: { field: string; mcVal: string; spVal: string }[];
  /** Dirty fields cleared because a newer human SharePoint edit won. */
  clearedDirty: string[];
  attributionEvents: {
    field: string;
    action: "human_over_service";
    inboundAt: string;
    localAt: string;
  }[];
}

function inboundBeatsServicePending(
  field: string,
  opts: ReconcileInboundOpts | undefined
): { beat: boolean; localAt?: string } {
  if (!opts?.inboundSource || opts.inboundSource !== "human" || !opts.inboundAt) {
    return { beat: false };
  }
  if (opts.routingFields && !opts.routingFields.has(field)) return { beat: false };
  const local = opts.localAttribution?.[field];
  if (!local || local.source !== "service") return { beat: false };
  const inboundMs = Date.parse(opts.inboundAt);
  const localMs = Date.parse(local.at);
  if (Number.isNaN(inboundMs) || Number.isNaN(localMs)) return { beat: false };
  if (inboundMs <= localMs) return { beat: false };
  return { beat: true, localAt: local.at };
}

// Pure reconciliation (§5.1 + P4 attribution): a patch applies cleanly unless
// the same field is locally dirty with a different value. Exception: a newer
// SharePoint edit attributed to a human beats an older agent/service pending
// edit on routing fields (audited). Human-vs-human and unknown/ambiguous stay
// manual conflicts.
export function reconcileInbound(
  data: EntityData,
  dirtyFields: string[],
  patches: EntityData,
  opts?: ReconcileInboundOpts
): ReconcileInboundResult {
  const apply: EntityData = {};
  const conflicts: { field: string; mcVal: string; spVal: string }[] = [];
  const clearedDirty: string[] = [];
  const attributionEvents: ReconcileInboundResult["attributionEvents"] = [];
  for (const [field, spVal] of Object.entries(patches)) {
    const mcVal = data[field];
    if (displayValue(mcVal) === displayValue(spVal)) continue;
    if (dirtyFields.includes(field)) {
      const { beat, localAt } = inboundBeatsServicePending(field, opts);
      if (beat && localAt && opts?.inboundAt) {
        apply[field] = spVal;
        clearedDirty.push(field);
        attributionEvents.push({
          field,
          action: "human_over_service",
          inboundAt: opts.inboundAt,
          localAt,
        });
      } else {
        conflicts.push({ field, mcVal: displayValue(mcVal), spVal: displayValue(spVal) });
      }
    } else {
      apply[field] = spVal;
    }
  }
  return { apply, conflicts, clearedDirty, attributionEvents };
}

/** Classify Graph lastModifiedBy into human / service / unknown. */
export function classifyLastModifiedBy(input: {
  user?: { id?: string; displayName?: string; email?: string | null } | null;
  application?: { id?: string; displayName?: string } | null;
} | null | undefined): { source: FieldSource; actorId?: string; email?: string } {
  if (!input) return { source: "unknown" };
  if (input.application?.id) {
    return { source: "service", actorId: input.application.id };
  }
  const user = input.user;
  if (user?.id || user?.email) {
    return {
      source: "human",
      actorId: user.id,
      email: user.email ?? undefined,
    };
  }
  return { source: "unknown" };
}
