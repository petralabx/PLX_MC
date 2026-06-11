// Mission Control runtime store — the PROTOTYPE sync engine.
// Faithful port of the mutation semantics in docs/product/prototype/mc-data.js
// (MC_addTask, MC_invitePerson, MC_markAllSynced, MC_applyInbound, conflict
// resolution) plus the audit-log contract from SHAREPOINT_INTEGRATION.md §5.
// At the sync-engine milestone these actions become API mutations; the
// component-facing surface (getters + actions + subscribe) stays.
//
// FROZEN FOR SCREEN LANES: screens consume this store via
// `useMcVersion()` (hooks.ts) + the getters/actions below. Do not fork
// per-screen state for anything that the topbar pill / sidebar badges or other
// screens must observe.

import {
  ACTORS,
  CURRENT_USER,
  FILES,
  INBOX,
  RISKS,
  SP_CONFLICTS,
  SP_ERRORS,
  SP_LAST_SWEEP,
  SP_LISTS,
  TASKS,
} from "./data";
import { domainOf, isPetraEmail } from "./helpers";
import type {
  Actor,
  AuditRow,
  FileEntry,
  Human,
  InboxNotification,
  Risk,
  SpConflict,
  SpError,
  SpListDef,
  SyncState,
  Task,
} from "./types";

const USER_TASKS_KEY = "plx_mc_user_tasks_v1";
const INVITED_KEY = "plx_mc_invited_people_v1";

interface McState {
  tasks: Task[];
  files: FileEntry[];
  risks: Risk[];
  notifications: InboxNotification[];
  actors: Record<string, Actor>;
  lists: SpListDef[];
  conflicts: SpConflict[];
  errors: SpError[];
  audit: AuditRow[];
  lastSweep: string;
  inboundApplied: boolean;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function initialState(): McState {
  return {
    tasks: clone(TASKS),
    files: clone(FILES),
    risks: clone(RISKS),
    notifications: clone(INBOX),
    actors: { ...ACTORS },
    lists: clone(SP_LISTS),
    conflicts: clone(SP_CONFLICTS),
    errors: clone(SP_ERRORS),
    audit: [
      { ts: SP_LAST_SWEEP, actor: "scribe", body: "Sweep completed — 1 outbound push, 0 inbound changes.", state: "synced" },
      { ts: "2026.06.09 · 06:31", actor: "dana", body: "Conflict detected on TASK-140 · Status (edited both sides).", state: "conflict" },
    ],
    lastSweep: SP_LAST_SWEEP,
    inboundApplied: false,
  };
}

let state: McState = initialState();
let version = 0;
const listeners = new Set<() => void>();

function emit() {
  version += 1;
  for (const l of listeners) l();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getVersion(): number {
  return version;
}

// ─── Getters ─────────────────────────────────────────────────────────────────

export const allTasks = (): Task[] => state.tasks;
export const taskById = (id: string): Task | undefined => state.tasks.find((t) => t.id === id);
export const allFiles = (): FileEntry[] => state.files;
export const allRisks = (): Risk[] => state.risks;
export const inboxNotifications = (): InboxNotification[] => state.notifications;
export const unreadCount = (): number => state.notifications.filter((n) => n.unread).length;
export const filesIn = (parentId: string | null): FileEntry[] =>
  state.files.filter((f) => (f.parent ?? null) === (parentId ?? null));
export const fileById = (id: string): FileEntry | undefined => state.files.find((f) => f.id === id);
export const actorById = (id: string): Actor | undefined => state.actors[id];
export const allActors = (): Record<string, Actor> => state.actors;
export const spLists = (): SpListDef[] => state.lists;
export const openConflicts = (): SpConflict[] => state.conflicts;
export const openErrors = (): SpError[] => state.errors;
export const auditLog = (): AuditRow[] => state.audit;
export const lastSweep = (): string => state.lastSweep;

export interface StoreSyncCounts {
  pending: number;
  conflict: number;
  error: number;
}

export function storeSyncCounts(): StoreSyncCounts {
  return state.lists.reduce<StoreSyncCounts>(
    (acc, l) => ({
      pending: acc.pending + l.counts.pending,
      conflict: acc.conflict + l.counts.conflict,
      error: acc.error + l.counts.error,
    }),
    { pending: 0, conflict: 0, error: 0 }
  );
}

// Ordered directory for pickers: core team first, then the rest, alpha.
export function directory(): Human[] {
  const core = ["maya", "tariq", "lena", "evan", "noor"];
  const humans = Object.values(state.actors).filter((a): a is Human => a.kind === "human");
  const rank = (p: Human) => {
    const i = core.indexOf(p.id);
    return i === -1 ? 99 : i;
  };
  return humans.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

export function personByEmail(email: string): Human | undefined {
  const needle = String(email).toLowerCase();
  return Object.values(state.actors).find(
    (a): a is Human => a.kind === "human" && (a.email ?? "").toLowerCase() === needle
  );
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function stamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())} · ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function pushAudit(actor: string, body: string, syncState: SyncState) {
  state.audit = [{ ts: stamp(), actor, body, state: syncState }, ...state.audit];
}

const canPersist = () => typeof window !== "undefined" && !!window.localStorage;

function persistUserTasks() {
  if (!canPersist()) return;
  try {
    window.localStorage.setItem(
      USER_TASKS_KEY,
      JSON.stringify(state.tasks.filter((t) => t.userCreated))
    );
  } catch {
    // storage unavailable — stays in-memory for the session
  }
}

function persistInvited() {
  if (!canPersist()) return;
  try {
    const invited = Object.values(state.actors).filter(
      (a): a is Human => a.kind === "human" && !!a.invited
    );
    window.localStorage.setItem(INVITED_KEY, JSON.stringify(invited));
  } catch {
    // ignore
  }
}

// ─── Actions ─────────────────────────────────────────────────────────────────

// Rehydrate persisted user tasks + invited people. Call from a client effect
// AFTER hydration (never at module init) so SSR and first client render match.
export function hydrateFromStorage() {
  if (!canPersist()) return;
  let changed = false;
  try {
    const rawTasks = window.localStorage.getItem(USER_TASKS_KEY);
    if (rawTasks) {
      for (const t of JSON.parse(rawTasks) as Task[]) {
        if (t?.id && !state.tasks.some((x) => x.id === t.id)) {
          state.tasks.push(t);
          changed = true;
        }
      }
    }
    const rawInvited = window.localStorage.getItem(INVITED_KEY);
    if (rawInvited) {
      for (const p of JSON.parse(rawInvited) as Human[]) {
        if (p?.id && !state.actors[p.id]) {
          state.actors[p.id] = p;
          changed = true;
        }
      }
    }
  } catch {
    // corrupt payload — ignore, fall back to seed data
  }
  if (changed) emit();
}

export function nextTaskId(): string {
  const nums = state.tasks.map((t) => parseInt((String(t.id).match(/(\d+)/) ?? [])[1] ?? "0", 10));
  return `TASK-${Math.max(0, ...nums) + 1}`;
}

export interface NewTaskInput {
  title: string;
  description?: string;
  bucket: string;
  stage?: Task["stage"];
  priority?: Task["priority"];
  assignee?: string | null;
  coassignees?: string[];
  reporter?: string;
  reqs?: string[];
  repos?: string[];
  estimate?: Task["estimate"];
  labels?: string[];
  due?: string;
}

// Build a fully-formed task from the modal's form values, append + persist.
// New tasks land PENDING in the ToDos register until the next sweep.
export function addTask(input: NewTaskInput): Task {
  const id = nextTaskId();
  const num = (id.match(/(\d+)/) ?? ["", ""])[1];
  const reporter = input.reporter ?? CURRENT_USER;
  const who = input.assignee ? state.actors[input.assignee] : undefined;
  const task: Task = {
    id,
    title: (input.title ?? "").trim(),
    description: (input.description ?? "").trim(),
    bucket: input.bucket,
    stage: input.stage ?? "backlog",
    priority: input.priority ?? "medium",
    assignee: input.assignee ?? null,
    coassignees: input.coassignees ?? [],
    reporter,
    reqs: input.reqs ?? [],
    repos: input.repos ?? [],
    estimate: input.estimate ?? "M",
    labels: input.labels ?? [],
    prs: [],
    due: input.due || "—",
    sync: { state: "pending", ts: stamp(), sp: `ToDos · item ${num}` },
    subtasks: [],
    activity: [
      {
        age: "now",
        who: reporter,
        kind: "move",
        what: `created the task${who ? ` — assigned to ${who.name}` : " — unassigned"}`,
      },
    ],
    userCreated: true,
  };
  state.tasks = [...state.tasks, task];
  const todos = state.lists.find((l) => l.key === "todos");
  if (todos) todos.counts.pending += 1;
  persistUserTasks();
  emit();
  return task;
}

// Invite a new person by email (must be a Petra domain). Returns the new
// person id, or null when the domain rule rejects the address.
export function invitePerson(email: string): string | null {
  const addr = String(email ?? "").trim();
  if (!isPetraEmail(addr)) return null;
  const existing = personByEmail(addr);
  if (existing) return existing.id;
  const local = addr.split("@")[0];
  const parts = local.split(/[._-]+/).filter(Boolean);
  const name = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ") || local;
  const init = ((parts[0]?.[0] ?? local[0]) + (parts[1]?.[0] ?? local[1] ?? "")).toUpperCase();
  const id = `inv-${local.replace(/[^a-z0-9]/gi, "").toLowerCase()}`;
  const person: Human = {
    id,
    kind: "human",
    name,
    init,
    role: "Invited",
    dept: domainOf(addr) === "petrasoap.com" ? "Petra Soap" : "Petra Lab-X",
    email: addr,
    online: false,
    invited: true,
  };
  state.actors = { ...state.actors, [id]: person };
  persistInvited();
  emit();
  return id;
}

// Mark an inbox notification read (clears the topbar/sidebar unread badge).
export function markRead(notificationId: string) {
  const n = state.notifications.find((x) => x.id === notificationId);
  if (!n || !n.unread) return;
  n.unread = false;
  emit();
}

// Reassign a task (null = unassign). Mirrors assignee → SharePoint
// "Assigned To" and (in the prototype) dispatches the Teams/email trail.
export function reassignTask(taskId: string, actorId: string | null) {
  const t = taskById(taskId);
  if (!t) return;
  if (actorId === null) {
    if (t.assignee === null) return;
    t.assignee = null;
    t.activity = [
      { age: "now", who: CURRENT_USER, kind: "sync", what: "unassigned — mirrored to SharePoint" },
      ...t.activity,
    ];
    pushAudit(CURRENT_USER, `Unassigned ${taskId} — Assigned To cleared in SharePoint.`, "synced");
    persistUserTasks();
    emit();
    return;
  }
  const who = state.actors[actorId];
  if (!who) return;
  t.assignee = actorId;
  t.activity = [
    {
      age: "now",
      who: CURRENT_USER,
      kind: "sync",
      what: `reassigned to ${who.name} — mirrored to SharePoint · notified via Teams + email`,
    },
    ...t.activity,
  ];
  pushAudit(CURRENT_USER, `Reassigned ${taskId} to ${who.name} — Assigned To mirrored.`, "synced");
  persistUserTasks();
  emit();
}

// "Sync now": outbound push — everything pending flips to synced.
export function markAllSynced(): string {
  const ts = stamp();
  for (const t of state.tasks) {
    if (t.sync.state === "pending") {
      t.sync.state = "synced";
      t.sync.ts = ts;
    }
  }
  for (const f of state.files) {
    if (f.sync?.state === "pending") {
      f.sync.state = "synced";
      f.sync.ts = ts;
    }
  }
  for (const l of state.lists) {
    if (l.counts.pending > 0) {
      l.counts.synced += l.counts.pending;
      l.counts.pending = 0;
    }
    l.lastSync = ts;
  }
  state.lastSweep = ts;
  pushAudit(CURRENT_USER, "Sweep completed — outbound pending pushed to SharePoint.", "synced");
  persistUserTasks();
  emit();
  return ts;
}

// Apply a single simulated INBOUND SharePoint edit (TASK-188 due date) so the
// two-way flow is visible. Idempotent: only the first sweep pulls it.
export function applyInbound(): { taskId: string; field: string; from: string; to: string; by: string } | null {
  if (state.inboundApplied) return null;
  const t = taskById("TASK-188");
  if (!t) return null;
  state.inboundApplied = true;
  const from = t.due;
  t.due = "Jun 13";
  t.activity = [
    { age: "now", who: "dana", what: `↓ inbound from SharePoint — Due Date ${from} → Jun 13`, kind: "sync" },
    ...t.activity,
  ];
  pushAudit("dana", `Inbound change pulled — TASK-188 Due Date ${from} → Jun 13.`, "synced");
  emit();
  return { taskId: "TASK-188", field: "Due Date", from, to: "Jun 13", by: "dana" };
}

// Manual conflict resolution — a human picks the winner; the choice is audited.
export function resolveConflict(conflictId: string, winner: "mc" | "sp") {
  const c = state.conflicts.find((x) => x.id === conflictId);
  if (!c) return;
  state.conflicts = state.conflicts.filter((x) => x.id !== conflictId);
  const list = state.lists.find((l) => l.key === c.list);
  if (list && list.counts.conflict > 0) {
    list.counts.conflict -= 1;
    list.counts.synced += 1;
  }
  if (c.entity === "Task") {
    const t = taskById(c.entityId);
    if (t) {
      t.sync.state = "synced";
      t.sync.ts = stamp();
      delete t.sync.wsVal;
      delete t.sync.spVal;
    }
  }
  if (c.entity === "Risk") {
    const r = state.risks.find((x) => x.id === c.entityId);
    if (r) {
      r.sync.state = "synced";
      r.sync.ts = stamp();
    }
  }
  const kept = winner === "mc" ? c.mcVal : c.spVal;
  pushAudit(
    CURRENT_USER,
    `Resolved conflict on ${c.entityId} · ${c.field} — kept ${winner === "mc" ? "Mission Control" : "SharePoint"} (\u201c${kept}\u201d).`,
    "synced"
  );
  emit();
}

// Retry a push error. The mapping layer normalizes the Likelihood value
// (Medium → Med per SHAREPOINT_INTEGRATION.md §5.2), so the retry succeeds.
export function retryError(errorId: string) {
  const e = state.errors.find((x) => x.id === errorId);
  if (!e) return;
  state.errors = state.errors.filter((x) => x.id !== errorId);
  const list = state.lists.find((l) => l.key === e.list);
  if (list && list.counts.error > 0) {
    list.counts.error -= 1;
    list.counts.synced += 1;
  }
  if (e.entity === "Risk") {
    const r = state.risks.find((x) => x.id === e.entityId);
    if (r) {
      r.sync.state = "synced";
      r.sync.ts = stamp();
      delete r.sync.reason;
    }
  }
  pushAudit(
    CURRENT_USER,
    `Retried push for ${e.entityId} · ${e.field} — value normalized (\u201c${e.value}\u201d → \u201cMed\u201d) and accepted.`,
    "synced"
  );
  emit();
}

// Test-only: reset the store to the seed fixture.
export function resetStore() {
  state = initialState();
  emit();
}
