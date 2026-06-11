// Mission Control runtime store — the client cache over the sync engine.
// The component-facing surface (getters + actions + subscribe) is FROZEN and
// unchanged from the prototype port; the internals now mirror every mutation
// to the API (src/app/api/*, the real engine in src/lib/sync) and hydrate
// from GET /api/state. Mutations stay optimistic-local-first so the UI is
// instant and degrades to read-only of last-synced state when the server is
// unreachable (TOOLS.md fallback) — including SSR/tests, where no server
// calls are made at all.
//
// FROZEN FOR SCREEN LANES: screens consume this store via
// `useMcVersion()` (hooks.ts) + the getters/actions below. Do not fork
// per-screen state for anything that the topbar pill / sidebar badges or other
// screens must observe.

import { api } from "@/lib/api";

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
      { ts: "—", actor: "scribe", body: "Go-live plan seeded — awaiting first outbound push to the record.", state: "pending" },
    ],
    lastSweep: SP_LAST_SWEEP,
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

// Server mirror: fire-and-forget on the client, a no-op on the server/tests.
// Failures keep the optimistic local state — the UI degrades to the
// last-synced view rather than blocking (TOOLS.md fallback path).
function serverCall(fn: () => Promise<void>) {
  if (typeof window === "undefined") return;
  void fn().catch((err) => {
    console.warn("[mc-store] server mirror unavailable — staying on local state:", err);
  });
}

// API response shape of GET /api/state (the engine's snapshot).
interface ServerSnapshot {
  tasks: Task[];
  risks: Risk[];
  files: FileEntry[];
  conflicts: SpConflict[];
  errors: SpError[];
  audit: AuditRow[];
  counts: Record<string, { synced: number; pending: number; conflict: number; error: number }>;
  lastSweep: string;
}

// Adopt the server's truth for everything the engine owns; notifications,
// actors, and the not-yet-mirrored lists keep their local/fixture state.
function applyServerState(snapshot: ServerSnapshot) {
  state.tasks = snapshot.tasks;
  state.risks = snapshot.risks;
  state.files = snapshot.files;
  state.conflicts = snapshot.conflicts;
  state.errors = snapshot.errors;
  state.audit = snapshot.audit;
  state.lastSweep = snapshot.lastSweep;
  for (const list of state.lists) {
    const counts = snapshot.counts[list.key];
    if (counts) {
      list.counts = { ...counts };
      list.lastSync = snapshot.lastSweep;
    }
  }
  emit();
}

async function refreshFromServer() {
  applyServerState(await api<ServerSnapshot>("/state"));
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

// Hydrate after mount (never at module init, so SSR and the first client
// render match): invited people from localStorage (directory increment is
// not server-side yet), then the engine's snapshot from the API. User tasks
// now persist server-side — localStorage no longer carries them.
export function hydrate() {
  if (canPersist()) {
    try {
      const rawInvited = window.localStorage.getItem(INVITED_KEY);
      if (rawInvited) {
        let changed = false;
        for (const p of JSON.parse(rawInvited) as Human[]) {
          if (p?.id && !state.actors[p.id]) {
            state.actors[p.id] = p;
            changed = true;
          }
        }
        if (changed) emit();
      }
    } catch {
      // corrupt payload — ignore, fall back to seed data
    }
  }
  serverCall(refreshFromServer);
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
  emit();
  // Mirror to the engine; the server owns id assignment, so adopt its task
  // if the optimistic id raced another writer.
  serverCall(async () => {
    const created = await api<Task>("/tasks", {
      method: "POST",
      body: JSON.stringify({ ...input, reporter }),
    });
    const local = state.tasks.findIndex((t) => t.id === id);
    if (local !== -1 && created.id !== id) {
      state.tasks[local] = created;
      emit();
    }
  });
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
    emit();
    serverCall(async () => {
      await api<Task>(`/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify({ actor: CURRENT_USER, assignee: null }),
      });
    });
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
  emit();
  serverCall(async () => {
    await api<Task>(`/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({ actor: CURRENT_USER, assignee: actorId }),
    });
  });
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
  emit();
  // Run a REAL sweep (outbound push + inbound delta) and adopt the engine's
  // resulting truth — counts, conflicts, audit — when it lands.
  serverCall(async () => {
    await api("/sync/sweep", { method: "POST", body: JSON.stringify({ actor: CURRENT_USER }) });
    await refreshFromServer();
  });
  return ts;
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
  // The engine writes the chosen value to the loser and audits the choice.
  serverCall(async () => {
    await api(`/sync/conflicts/${conflictId}/resolve`, {
      method: "POST",
      body: JSON.stringify({ winner, actor: CURRENT_USER }),
    });
    await refreshFromServer();
  });
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
  // The engine re-pushes through the mapping layer's §5.2 normalization.
  serverCall(async () => {
    await api(`/sync/errors/${errorId}/retry`, {
      method: "POST",
      body: JSON.stringify({ actor: CURRENT_USER }),
    });
    await refreshFromServer();
  });
}

// Test-only: reset the store to the seed fixture.
export function resetStore() {
  state = initialState();
  emit();
}
