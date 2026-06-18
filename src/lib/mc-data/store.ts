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
  PRIORITY,
  SP_LAST_SWEEP,
  SP_LISTS,
  STAGE_IDX,
  STAGES,
  TASKS,
} from "./data";
import { domainOf, isPetraEmail } from "./helpers";
import { assignmentViolation, isAgentId, stageAdvanceViolation } from "./policy";
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
  Subtask,
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

// ─── Notices (minimal toast/notice channel) ───────────────────────────────────
// No toast primitive existed in atoms.tsx / chrome.tsx (the only "trail" was the
// assignment-specific NotifyTrail), so this is a tiny, self-contained reactive
// channel. Its first and only producer is the optimistic-rollback path in
// patchTaskFields: when a mirrored PATCH fails, the optimistic edit is restored
// and a NON-SILENT notice is surfaced here (SPEC §5 Module B "recommended"
// reconcile-on-failure). Rendered by <NoticeHost> (mounted in shell.tsx).

export type NoticeTone = "error" | "info";

export interface Notice {
  id: string;
  tone: NoticeTone;
  body: string;
}

let notices: Notice[] = [];
let noticeSeq = 0;
const noticeListeners = new Set<() => void>();

function emitNotices() {
  for (const l of noticeListeners) l();
}

export const activeNotices = (): Notice[] => notices;

export function subscribeNotices(listener: () => void): () => void {
  noticeListeners.add(listener);
  return () => noticeListeners.delete(listener);
}

export function pushNotice(body: string, tone: NoticeTone = "error"): string {
  const id = `ntc-${++noticeSeq}`;
  notices = [{ id, tone, body }, ...notices];
  emitNotices();
  return id;
}

export function dismissNotice(id: string) {
  const next = notices.filter((n) => n.id !== id);
  if (next.length === notices.length) return;
  notices = next;
  emitNotices();
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

// Ordered directory for pickers: by role (Owner/Admin/Lead first), then online,
// then name. No hardcoded id list (EN-003 / WS-1 — the directory is the real
// roster resolved from M365).
const DIRECTORY_ROLE_RANK: Record<string, number> = { Owner: 0, Admin: 1, Lead: 2 };

export function directory(): Human[] {
  const humans = Object.values(state.actors).filter((a): a is Human => a.kind === "human");
  const rank = (p: Human) => DIRECTORY_ROLE_RANK[p.role] ?? 50;
  return humans.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      Number(b.online) - Number(a.online) ||
      a.name.localeCompare(b.name)
  );
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
  accountableOwner?: string | null;
  humanOnly?: boolean;
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
  // A human-only task can never carry an agent executor (EN-003 policy) — clamp
  // defensively even though the authoring picker hides agents in that mode.
  const assignee =
    input.humanOnly && isAgentId(input.assignee ?? null) ? null : (input.assignee ?? null);
  const who = assignee ? state.actors[assignee] : undefined;
  const task: Task = {
    id,
    title: (input.title ?? "").trim(),
    description: (input.description ?? "").trim(),
    bucket: input.bucket,
    stage: input.stage ?? "backlog",
    priority: input.priority ?? "medium",
    assignee,
    coassignees: input.coassignees ?? [],
    reporter,
    accountableOwner: input.accountableOwner ?? null,
    humanOnly: input.humanOnly,
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

// The patchable subset of a Task — the fields routed through the single
// persisted-mutation path. Mirrors PatchTaskInput (state.ts) on the server.
export type TaskFieldPatch = Partial<
  Pick<
    Task,
    | "stage"
    | "priority"
    | "bucket"
    | "labels"
    | "coassignees"
    | "subtasks"
    | "assignee"
    | "accountableOwner"
    | "humanOnly"
  >
>;

// The PATCH mirror seam. Production default issues the real PATCH and returns
// the server's reconciled task; the catch in patchTaskFields turns a rejection
// into a rollback + notice. Overridable in tests (__setPatchMirrorForTests) so
// the rollback-on-failure path is unit-testable even though `serverCall` is a
// no-op under SSR/test (typeof window === "undefined").
type PatchMirror = (taskId: string, patch: TaskFieldPatch) => Promise<Task>;

const defaultPatchMirror: PatchMirror = (taskId, patch) =>
  api<Task>(`/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify({ actor: CURRENT_USER, ...patch }),
  });

let patchMirror: PatchMirror = defaultPatchMirror;
let patchMirrorInjected = false;

// Test-only: inject a mirror that resolves/rejects deterministically so the
// real optimistic→mirror→(reconcile | rollback) path runs in the Node test
// env (where `serverCall`/the default mirror would otherwise be a no-op). Pass
// null to restore the production default. While injected, patchTaskFields runs
// the mirror regardless of `window`, so a test can await the settle.
export function __setPatchMirrorForTests(fn: PatchMirror | null) {
  patchMirror = fn ?? defaultPatchMirror;
  patchMirrorInjected = fn !== null;
}

// The single persisted task mutation: optimistic local apply + honest activity,
// emit(), then mirror to PATCH /api/tasks/{id}. On SUCCESS adopt the server's
// returned task so optimistic state reconciles to DB truth (closes the
// "optimistic-only, lost on hydrate" gap). On FAILURE restore the pre-edit
// values of exactly the patched fields (+ the optimistic activity line),
// re-emit, and surface a non-silent notice — so a write the user saw is never
// silently dropped (the prime-directive guard, SPEC §5 Module B "recommended").
// A no-op when the patch is empty. Returns the in-flight mirror promise (for
// tests); fire-and-forget for callers.
export function patchTaskFields(
  taskId: string,
  patch: TaskFieldPatch,
  opts?: { activity?: string }
): Promise<void> | void {
  const t = taskById(taskId);
  if (!t) return;
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return; // empty patch is a safe no-op

  // Accountability policy (EN-003): block a stage advance that would orphan the
  // task past `planned` without a human owner, or mark it done with incomplete
  // evidence. Surface the reason and leave state untouched (no optimistic apply).
  if (patch.stage !== undefined) {
    const reason = stageAdvanceViolation(t, patch.stage);
    if (reason) {
      pushNotice(reason);
      return;
    }
  }

  // Snapshot the prior values of exactly the patched fields, plus the activity
  // array (we prepend an optimistic line below — a failed write must revert it
  // too, or a spurious "moved to…" entry would persist). Deep-cloned so a later
  // in-place mutation of the live object can't corrupt the snapshot.
  const patchedKeys = entries.map(([k]) => k) as Array<keyof Task>;
  const prior = clone(
    Object.fromEntries(patchedKeys.map((k) => [k, t[k]]))
  ) as Partial<Task>;
  const priorActivity = opts?.activity ? t.activity : undefined;

  Object.assign(t, Object.fromEntries(entries));
  if (opts?.activity) {
    t.activity = [{ age: "now", who: CURRENT_USER, kind: "move", what: opts.activity }, ...t.activity];
  }
  emit();

  const rollback = (err: unknown) => {
    const cur = taskById(taskId);
    if (cur) {
      Object.assign(cur, prior);
      if (priorActivity) cur.activity = priorActivity;
    }
    pushNotice(
      `Couldn't save the change to ${taskId} — it was rolled back. ${
        err instanceof Error ? err.message : "The server rejected the update."
      }`
    );
    emit();
  };

  const reconcile = (updated: Task) => {
    // Adopt the server's DB truth for this task.
    const i = state.tasks.findIndex((x) => x.id === taskId);
    if (i !== -1) {
      state.tasks[i] = updated;
      emit();
    }
  };

  // SSR/tests: with no injected mirror, the optimistic state simply stands (no
  // network to fail) — matching the existing serverCall no-op contract. On the
  // client (or when a test injects a mirror) the mirror runs and either
  // reconciles to server truth or rolls back + notices.
  if (typeof window === "undefined" && !patchMirrorInjected) return;
  return patchMirror(taskId, patch).then(reconcile, rollback);
}

// ─── Thin persisted-mutation wrappers (used by drag + inline editing) ─────────

export const setTaskStage = (taskId: string, stage: Task["stage"]) =>
  // Stage display name via the existing STAGES/STAGE_IDX pattern (no
  // STAGE_IDX_NAME map exists — do not invent one, Pillar 3).
  patchTaskFields(taskId, { stage }, { activity: `moved to ${STAGES[STAGE_IDX[stage]].name} — pending push` });

export const setTaskPriority = (taskId: string, priority: Task["priority"]) =>
  patchTaskFields(taskId, { priority }, { activity: `set priority to ${PRIORITY[priority].label} — pending push` });

export const setTaskBucket = (taskId: string, bucket: string) =>
  // DB-only — Initiative mirror lands with the directory/lookup increment.
  patchTaskFields(taskId, { bucket }, { activity: "moved to a different initiative" });

export const setTaskLabels = (taskId: string, labels: string[]) =>
  patchTaskFields(taskId, { labels }, { activity: "updated labels" }); // DB-only — no sync claim

export const setCoassignees = (taskId: string, ids: string[]) => {
  const t = taskById(taskId);
  if (!t) return;
  // Dedupe and never include the primary assignee as a co-assignee.
  const coassignees = Array.from(new Set(ids)).filter((id) => id !== t.assignee);
  patchTaskFields(taskId, { coassignees }, { activity: "updated co-assignees" }); // DB-only
};

// Set the human accountable owner (EN-003). Rejects an agent — accountability
// is always human. DB-only: the Accountable Owner person column is part of the
// deferred directory mirror, so no sync claim is made here.
export const setAccountableOwner = (taskId: string, ownerId: string | null) => {
  if (isAgentId(ownerId)) {
    pushNotice("Accountability is always human — an agent can't be the accountable owner.");
    return;
  }
  patchTaskFields(taskId, { accountableOwner: ownerId }, { activity: "set the accountable owner" });
};

// Toggle the per-task human-only policy. Turning it on while an agent is the
// executor clears the executor so the invariant holds.
export const setHumanOnly = (taskId: string, humanOnly: boolean) => {
  const t = taskById(taskId);
  if (!t) return;
  const patch: TaskFieldPatch = { humanOnly };
  if (humanOnly && isAgentId(t.assignee)) patch.assignee = null;
  patchTaskFields(taskId, patch, { activity: humanOnly ? "marked human-only" : "allowed agent execution" });
};

export const addSubtask = (taskId: string, text: string, who: string) => {
  const t = taskById(taskId);
  if (!t) return;
  const body = text.trim();
  if (!body) return;
  // SUB-${max+1} scoped to the task (mirrors nextTaskId style).
  const max = Math.max(
    0,
    ...t.subtasks.map((s) => parseInt((/(\d+)/.exec(s.id) ?? [])[1] ?? "0", 10))
  );
  const sub: Subtask = { id: `SUB-${max + 1}`, t: body, done: false, who };
  patchTaskFields(taskId, { subtasks: [...t.subtasks, sub] }, { activity: "added a subtask" }); // DB-only
};

export const toggleSubtask = (taskId: string, subtaskId: string) => {
  const t = taskById(taskId);
  if (!t) return;
  const subtasks = t.subtasks.map((s) => (s.id === subtaskId ? { ...s, done: !s.done } : s));
  patchTaskFields(taskId, { subtasks }, { activity: "toggled a subtask" }); // DB-only
};

// Reassign a task (null = unassign). Thin wrapper over the shared mutation
// spine. The Assigned To person column is NOT mirrored yet (M365 directory
// increment) — the activity + audit copy reflect that deferral honestly, the
// server (state.ts) likewise does not re-queue the entity for push.
export function reassignTask(taskId: string, actorId: string | null) {
  const t = taskById(taskId);
  if (!t) return;
  // Human-only tasks reject an agent executor (EN-003 policy) before anything
  // is logged or mirrored.
  const violation = assignmentViolation(t, actorId);
  if (violation) {
    pushNotice(violation);
    return;
  }
  if (actorId === null) {
    if (t.assignee === null) return;
    pushAudit(
      CURRENT_USER,
      `Unassigned ${taskId} — Assigned To mirror deferred to the directory increment.`,
      "pending"
    );
    patchTaskFields(
      taskId,
      { assignee: null },
      { activity: "unassigned — Assigned To mirror deferred to the directory increment" }
    );
    return;
  }
  const who = state.actors[actorId];
  if (!who) return;
  // Client audit intentionally carries the assignee name for the local trail;
  // the server audit (state.ts) omits it — a documented divergence, not parity.
  pushAudit(
    CURRENT_USER,
    `Reassigned ${taskId} to ${who.name} — Assigned To mirror deferred to the directory increment.`,
    "pending"
  );
  patchTaskFields(
    taskId,
    { assignee: actorId },
    { activity: `reassigned to ${who.name} — Assigned To mirror deferred to the directory increment` }
  );
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
  notices = [];
  noticeSeq = 0;
  patchMirror = defaultPatchMirror;
  patchMirrorInjected = false;
  emit();
}
