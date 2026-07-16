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
  BUCKETS,
  CURRENT_USER,
  FILES,
  INBOX,
  PROJECTS,
  REPOS,
  ALLOWED_REPO_ORGS,
  DEFAULT_NEW_REPO_ORG,
  RISKS,
  SP_CONFLICTS,
  SP_ERRORS,
  PRIORITY,
  SP_LAST_SWEEP,
  SP_LISTS,
  STAGE_IDX,
  STAGES,
  TARGET_ENV,
  TASKS,
} from "./data";
import { parseMentions } from "./collab";
import { domainOf, isPetraEmail } from "./helpers";
import { assignmentViolation, isAgentId, stageAdvanceViolation } from "./policy";
import { allowedReposOnly, disallowedRepos, isAllowedRepoOrg, isApprover, repoFromRequest } from "./repos";
import type {
  Actor,
  AuditRow,
  Bucket,
  Comment,
  FileEntry,
  Human,
  InboxNotification,
  Project,
  Repo,
  RepoRequest,
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
  // EN-002 / WS-2: the repo registry (= allow-list) and the self-service
  // request queue. Seeded from the REPOS fixture; an approved request adds to
  // `repos`. Runtime-only for now (not yet mirrored to the system of record).
  repos: Record<string, Repo>;
  repoRequests: RepoRequest[];
  // Bucket discussion threads (EN-001 / WS-3), keyed by bucket id. Task comments,
  // by contrast, persist through the task PATCH spine.
  bucketComments: Record<string, Comment[]>;
  // EN-005: buckets/initiatives, keyed by id. Seeded from the BUCKETS fixture,
  // hydrated from the server snapshot; a created bucket adds here. The single
  // source of truth behind allBuckets()/bucketById() (no more direct fixture reads).
  buckets: Record<string, Bucket>;
  // P2: projects (parent above buckets), keyed by id. Seeded from PROJECTS fixture.
  projects: Record<string, Project>;
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
    repos: clone(REPOS),
    repoRequests: [],
    bucketComments: Object.fromEntries(
      BUCKETS.map((b) => [b.id, clone(b.comments ?? [])])
    ),
    buckets: Object.fromEntries(BUCKETS.map((b) => [b.id, clone(b)])),
    projects: Object.fromEntries(PROJECTS.map((p) => [p.id, clone(p)])),
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
// EN-002 / WS-2 — the repo registry (allow-list) and self-service request queue.
export const allRepos = (): Record<string, Repo> => state.repos;
export const repoRequests = (): RepoRequest[] => state.repoRequests;

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

// Everyone who can be @mentioned in a comment (EN-001 / WS-3): the ordered
// human directory followed by the agent roster. Reused by the composer's
// mention autocomplete and as the validity set for parseMentions.
export function mentionables(): Actor[] {
  const agents = Object.values(state.actors).filter((a): a is Actor => a.kind === "agent");
  return [...directory(), ...agents];
}

const mentionableIdSet = (): Set<string> => new Set(mentionables().map((a) => a.id));

// Bucket discussion thread (persisted via the bucket-comment mirror).
export const commentsForBucket = (bucketId: string): Comment[] =>
  state.bucketComments[bucketId] ?? [];

// EN-005 — the live bucket/initiative set: the single source of truth that
// replaces direct BUCKETS / BUCKET_IDX fixture reads. Reactive via useMcVersion.
export const allBuckets = (): Bucket[] => Object.values(state.buckets);
export const bucketById = (id: string): Bucket | undefined => state.buckets[id];
export const allProjects = (): Project[] => Object.values(state.projects);
export const projectById = (id: string): Project | undefined => state.projects[id];
export const bucketsForProject = (projectId: string): Bucket[] =>
  allBuckets().filter((b) => b.project === projectId);

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
  // EN-002 / Item 2 — the persisted repo registry + request queue.
  repos?: Repo[];
  repoRequests?: RepoRequest[];
  // EN-001 / Item 4 — persisted bucket discussion threads.
  bucketComments?: Record<string, Comment[]>;
  // EN-005 — persisted buckets/initiatives.
  buckets?: Bucket[];
  // P2 — persisted projects.
  projects?: Project[];
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
  // EN-002 / Item 2 — adopt the persisted registry + request queue so approvals
  // and requests survive a reload (the server is the source of truth on hydrate).
  if (snapshot.repos) state.repos = Object.fromEntries(snapshot.repos.map((r) => [r.id, r]));
  if (snapshot.repoRequests) state.repoRequests = snapshot.repoRequests;
  // EN-001 / Item 4 — adopt the persisted bucket threads so they survive a
  // reload (the server is the source of truth on hydrate).
  if (snapshot.bucketComments) state.bucketComments = snapshot.bucketComments;
  // EN-005 — adopt the persisted buckets so created/edited initiatives survive a
  // reload (the server is the source of truth on hydrate).
  if (snapshot.buckets) state.buckets = Object.fromEntries(snapshot.buckets.map((b) => [b.id, b]));
  if (snapshot.projects) state.projects = Object.fromEntries(snapshot.projects.map((p) => [p.id, p]));
  for (const list of state.lists) {
    const counts = snapshot.counts[list.key];
    if (counts) {
      list.counts = { ...counts };
      list.lastSync = snapshot.lastSweep;
    }
  }
  emit();
}

// Mirror a repo request to the server (persist). Fire-and-forget; a no-op under
// SSR/tests, like every other serverCall — the optimistic state stands.
function mirrorRepoRequest(request: RepoRequest) {
  serverCall(async () => {
    await api("/repos/requests", { method: "POST", body: JSON.stringify(request) });
  });
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
  targetEnv?: Task["targetEnv"];
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
  // Allow-list enforcement (EN-002): a task may only attach registry repos.
  // Anything off the list is dropped at the boundary with a non-silent notice.
  const requestedRepos = input.repos ?? [];
  const repos = allowedReposOnly(requestedRepos, state.repos);
  const droppedRepos = disallowedRepos(requestedRepos, state.repos);
  if (droppedRepos.length > 0) {
    pushNotice(
      `Skipped repos not in the registry: ${droppedRepos.join(", ")}. Request them first.`,
      "info"
    );
  }
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
    repos,
    targetEnv: input.targetEnv ?? "staging",
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
      body: JSON.stringify({ ...input, reporter, repos }),
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

// ─── Repo registry: self-service request → approve (EN-002 / WS-2) ───────────

// GitHub-org validation seam. Production default issues the real POST to
// /api/repos/validate (which calls the org with GITHUB_TOKEN). Overridable in
// tests (__setRepoValidatorForTests) so the request→validate→reconcile path is
// unit-testable even though `serverCall`/the default validator are no-ops under
// SSR/test. Result shape mirrors lib/sync/github.ts RepoValidation.
interface RepoValidationResult {
  ok: boolean;
  visibility?: Repo["visibility"];
  def?: string;
  lang?: string;
  note?: string;
}
type RepoValidator = (owner: string, name: string) => Promise<RepoValidationResult>;

const defaultRepoValidator: RepoValidator = (owner, name) =>
  api<RepoValidationResult>("/repos/validate", {
    method: "POST",
    body: JSON.stringify({ owner, name }),
  });

let repoValidator: RepoValidator = defaultRepoValidator;
let repoValidatorInjected = false;
let repoRequestSeq = 0;
// Test seam: the in-flight validation of the last requestRepo call so a test
// can await the reconcile (mirrors the patchTaskFields return-promise pattern).
let repoValidationInFlight: Promise<void> = Promise.resolve();

export function __setRepoValidatorForTests(fn: RepoValidator | null) {
  repoValidator = fn ?? defaultRepoValidator;
  repoValidatorInjected = fn !== null;
}

export function __repoValidationSettled(): Promise<void> {
  return repoValidationInFlight;
}

export interface NewRepoRequestInput {
  name: string;
  owner?: string;
  scope?: string;
}

// File a self-service request to add a repo to the registry. Any collaborator
// may request; the request lands `pending` + unverified, then is validated
// against the GitHub org. An unverified request is never auto-promoted — an
// approver still has to approve it (approveRepo) before it joins the allow-list.
export function requestRepo(input: NewRepoRequestInput, actorId: string = CURRENT_USER): RepoRequest {
  const name = (input.name ?? "").trim();
  const owner = (input.owner ?? "").trim() || DEFAULT_NEW_REPO_ORG;
  const id = `RR-${++repoRequestSeq}`;
  const request: RepoRequest = {
    id,
    name,
    owner,
    scope: (input.scope ?? "").trim() || undefined,
    requestedBy: actorId,
    requestedTs: stamp(),
    status: "pending",
    verified: false,
    note: isAllowedRepoOrg(owner)
      ? undefined
      : `Org ${owner} is not allowed — permitted orgs: ${ALLOWED_REPO_ORGS.join(", ")}.`,
  };
  state.repoRequests = [request, ...state.repoRequests];
  pushAudit(actorId, `Requested repo ${name} — pending GitHub-org validation and approval.`, "pending");
  emit();
  mirrorRepoRequest(request);

  if (!isAllowedRepoOrg(owner)) {
    return request;
  }

  const reconcile = (result: RepoValidationResult) => {
    const r = state.repoRequests.find((x) => x.id === id);
    if (!r) return;
    r.verified = result.ok;
    if (result.ok) {
      r.visibility = result.visibility;
      r.def = result.def;
      r.lang = result.lang;
      r.note = `Validated against ${owner} on GitHub.`;
    } else {
      r.note = result.note ?? "Could not be validated against the org.";
    }
    emit();
    mirrorRepoRequest(r);
  };
  const onError = (err: unknown) => {
    const r = state.repoRequests.find((x) => x.id === id);
    if (!r) return;
    r.verified = false;
    r.note = `Validation failed: ${err instanceof Error ? err.message : "unknown error"}.`;
    emit();
    mirrorRepoRequest(r);
  };

  // SSR/tests with no injected validator: leave the request unverified (no
  // network to call) — matching the serverCall no-op contract.
  if (typeof window !== "undefined" || repoValidatorInjected) {
    repoValidationInFlight = repoValidator(owner, name).then(reconcile, onError);
  }
  return request;
}

// Approve a pending request — gated to an approver (Owner/Admin, EN-003 roles).
// Adds the repo to the registry/allow-list. Returns true on success. An
// UNVERIFIED request (one that failed GitHub-org validation) can never be
// approved — that would put an unvalidated repo on the allow-list, exactly what
// the validation gate prevents (error-code-style reason: repo_unverified).
export function approveRepo(requestId: string, actorId: string = CURRENT_USER): boolean {
  if (!isApprover(state.actors[actorId])) {
    pushNotice("Only an Owner or Admin can approve a repo request.");
    return false;
  }
  const req = state.repoRequests.find((r) => r.id === requestId);
  if (!req || req.status !== "pending") return false;
  if (!req.verified) {
    pushNotice(`${req.name} hasn't been verified against the GitHub org — it can't be approved.`);
    return false;
  }
  req.status = "approved";
  req.decidedBy = actorId;
  req.decidedTs = stamp();
  const repo = repoFromRequest(req);
  state.repos = { ...state.repos, [repo.id]: repo };
  pushAudit(actorId, `Approved repo ${req.name} — added to the registry allow-list.`, "pending");
  emit();
  // Persist the decision + the new registry repo (the repo route re-checks the
  // approver gate server-side) so the approval survives a reload.
  mirrorRepoRequest(req);
  serverCall(async () => {
    await api("/repos", { method: "POST", body: JSON.stringify({ actor: actorId, repo }) });
  });
  return true;
}

// Reject a pending request — gated to an approver. Nothing joins the registry.
export function rejectRepo(requestId: string, actorId: string = CURRENT_USER): boolean {
  if (!isApprover(state.actors[actorId])) {
    pushNotice("Only an Owner or Admin can reject a repo request.");
    return false;
  }
  const req = state.repoRequests.find((r) => r.id === requestId);
  if (!req || req.status !== "pending") return false;
  req.status = "rejected";
  req.decidedBy = actorId;
  req.decidedTs = stamp();
  pushAudit(actorId, `Rejected repo request ${req.name}.`, "pending");
  emit();
  mirrorRepoRequest(req); // persist the decision
  return true;
}

let notifSeq = 0;

// Fire the @mention notification path (EN-001 / WS-3). Reuses the SAME honest
// deferred-mirror narrative as assignment (reassignTask): an in-app inbox
// notification is created now, and an audit row records that the Teams + email
// mirror is deferred to the directory/notification increment — we never claim a
// delivery that did not happen (Truth Before Action). Bucket threads have no
// task target for the inbox row, so they record the audit trail only.
function notifyMentions(
  mentions: string[],
  author: string,
  target: { taskId?: string; label: string }
) {
  const recipients = mentions.filter((id) => id !== author);
  if (recipients.length === 0) return;
  const names = recipients.map((id) => state.actors[id]?.name ?? id).join(", ");
  if (target.taskId) {
    for (const id of recipients) {
      state.notifications = [
        {
          id: `ntf-${++notifSeq}`,
          kind: "mention",
          task: target.taskId,
          actor: author,
          text: `${state.actors[author]?.name ?? author} mentioned ${
            state.actors[id]?.name ?? id
          } on ${target.label}`,
          age: "now",
          unread: true,
        },
        ...state.notifications,
      ];
    }
  }
  pushAudit(
    author,
    `Mentioned ${names} on ${target.label} — Teams + email mirror deferred to the directory/notification increment.`,
    "pending"
  );
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
    | "description"
    | "labels"
    | "coassignees"
    | "subtasks"
    | "comments"
    | "assignee"
    | "accountableOwner"
    | "humanOnly"
    | "repos"
    | "targetEnv"
    | "agentRunApproved"
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

// Edit a task's repos post-creation (EN-005). Constrained to the registry
// allow-list (humans + agents alike) — anything off-list is dropped at the
// boundary with a non-silent notice; the server (state.ts) re-validates against
// the same persisted registry. A reason marks an in-flight Retarget action.
export const setTaskRepos = (taskId: string, repos: string[], opts?: { reason?: string }) => {
  const t = taskById(taskId);
  if (!t) return;
  const allowed = Array.from(new Set(allowedReposOnly(repos, state.repos)));
  const dropped = disallowedRepos(repos, state.repos);
  if (dropped.length > 0) {
    pushNotice(`Skipped repos not in the registry: ${dropped.join(", ")}. Request them first.`, "info");
  }
  const reason = opts?.reason?.trim();
  if (reason) {
    pushAudit(CURRENT_USER, `Retargeted repos for ${taskId} — reason: "${reason}".`, "pending");
    patchTaskFields(taskId, { repos: allowed }, { activity: `retargeted repos — reason: "${reason}" — pending push` });
    return;
  }
  patchTaskFields(taskId, { repos: allowed }, { activity: "updated target repos — pending push" });
};

// Target environment — a PUSHED field (Target Environment Choice column).
// Not lifecycle-locked: promoting staging → production is normal progression.
export const setTaskTargetEnv = (taskId: string, targetEnv: NonNullable<Task["targetEnv"]>) =>
  patchTaskFields(
    taskId,
    { targetEnv },
    { activity: `set target environment to ${TARGET_ENV[targetEnv].label} — pending push` }
  );

// Operator approval of an approve-mode agent's run (EN-005). Unblocks a stage
// advance into the doing band for a task whose executor is a needs-approval
// agent (see policy.stageAdvanceViolation). DB-only — no SharePoint column.
export const setAgentRunApproved = (taskId: string, approved: boolean) =>
  patchTaskFields(
    taskId,
    { agentRunApproved: approved },
    { activity: approved ? "approved the agent run" : "revoked agent-run approval" }
  );

export const setCoassignees = (taskId: string, ids: string[]) => {
  const t = taskById(taskId);
  if (!t) return;
  // Dedupe and never include the primary assignee as a co-assignee.
  const coassignees = Array.from(new Set(ids)).filter((id) => id !== t.assignee);
  patchTaskFields(taskId, { coassignees }, { activity: "updated co-assignees" }); // DB-only
};

// Set the human accountable owner (EN-003). Rejects an agent — accountability
// is always human. The Accountable Owner person column now mirrors to SharePoint
// on the next sync (Item 1, push-only), so the trail says so honestly.
export const setAccountableOwner = (taskId: string, ownerId: string | null) => {
  if (isAgentId(ownerId)) {
    pushNotice("Accountability is always human — an agent can't be the accountable owner.");
    return;
  }
  patchTaskFields(
    taskId,
    { accountableOwner: ownerId },
    { activity: "set the accountable owner — Accountable Owner mirrors to SharePoint on the next sync" }
  );
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

// Edit the enriched sub-task fields (EN-001 / WS-3 medium depth). `done` and
// `status` are kept consistent: a "done" status implies done=true and vice
// versa, so the existing checkbox + counts never disagree with the label.
export type SubtaskPatch = Partial<Pick<Subtask, "t" | "description" | "assignee" | "due" | "status" | "done">>;

export const updateSubtask = (taskId: string, subtaskId: string, patch: SubtaskPatch) => {
  const t = taskById(taskId);
  if (!t) return;
  let touched = false;
  const subtasks = t.subtasks.map((s) => {
    if (s.id !== subtaskId) return s;
    touched = true;
    const next: Subtask = { ...s, ...patch };
    if (patch.status !== undefined) next.done = patch.status === "done";
    else if (patch.done !== undefined) next.status = patch.done ? "done" : (s.status === "done" ? "doing" : s.status);
    return next;
  });
  if (!touched) return;
  patchTaskFields(taskId, { subtasks }, { activity: "edited a subtask" }); // DB-only
};

// Reorder sub-tasks to the given id order (drag/keyboard reorder). Ignores
// unknown ids and appends any not listed, so a partial order is safe.
export const reorderSubtasks = (taskId: string, orderedIds: string[]) => {
  const t = taskById(taskId);
  if (!t) return;
  const byId = new Map(t.subtasks.map((s) => [s.id, s]));
  const ordered: Subtask[] = [];
  for (const id of orderedIds) {
    const s = byId.get(id);
    if (s) {
      ordered.push(s);
      byId.delete(id);
    }
  }
  for (const s of byId.values()) ordered.push(s);
  if (ordered.length !== t.subtasks.length) return;
  patchTaskFields(taskId, { subtasks: ordered }, { activity: "reordered subtasks" }); // DB-only
};

// Promote a sub-task into a full governed Task (EN-001 / WS-3). Reuses addTask
// (Pillar 3) — the new task inherits the parent's bucket + repos, carries the
// sub-task's description/assignee/due, and the sub-task is removed from the
// parent. Returns the new task, or null when nothing matched.
export function promoteSubtaskToTask(taskId: string, subtaskId: string): Task | null {
  const t = taskById(taskId);
  if (!t) return null;
  const sub = t.subtasks.find((s) => s.id === subtaskId);
  if (!sub) return null;
  const created = addTask({
    title: sub.t,
    description: sub.description ?? "",
    bucket: t.bucket,
    assignee: sub.assignee ?? null,
    reporter: CURRENT_USER,
    repos: t.repos,
    due: sub.due,
  });
  patchTaskFields(
    taskId,
    { subtasks: t.subtasks.filter((s) => s.id !== subtaskId) },
    { activity: `promoted a subtask to ${created.id}` }
  );
  return created;
}

// ─── Description (SP-tier — mirrors via the Description column) ────────────────

// Edit the task description. Unlike the person/lookup columns, Description IS
// mapped two-way (mapping.ts), so the trail honestly claims a pending push.
export const setTaskDescription = (taskId: string, description: string) =>
  patchTaskFields(taskId, { description }, { activity: "edited the description — pending push" });

// ─── Comments (app-only discussion thread) ────────────────────────────────────

let commentSeq = 0;

function buildComment(body: string, author: string): Comment | null {
  const text = body.trim();
  if (!text) return null;
  return {
    id: `CMT-${++commentSeq}`,
    author,
    body: text,
    ts: stamp(),
    mentions: parseMentions(text, mentionableIdSet()),
  };
}

// Add a comment to a task's thread (EN-001 / WS-3). Persists through the task
// PATCH spine (DB-only tier — comments are never mirrored to SharePoint), then
// fires the @mention notify path for anyone tagged.
export function addComment(taskId: string, body: string, author: string = CURRENT_USER): Comment | null {
  const t = taskById(taskId);
  if (!t) return null;
  const comment = buildComment(body, author);
  if (!comment) return null;
  patchTaskFields(taskId, { comments: [...(t.comments ?? []), comment] }, { activity: "added a comment" });
  notifyMentions(comment.mentions, author, { taskId, label: taskId });
  return comment;
}

// Edit one's own comment. Re-parses mentions and stamps editedTs; newly-added
// mentions fire the notify path (already-notified recipients are not re-fired
// because the inbox is append-only and the author dedup excludes the editor).
export function editComment(taskId: string, commentId: string, body: string, editor: string = CURRENT_USER) {
  const t = taskById(taskId);
  if (!t) return;
  const text = body.trim();
  if (!text) return;
  const existing = (t.comments ?? []).find((c) => c.id === commentId);
  if (!existing || existing.author !== editor) return;
  const mentions = parseMentions(text, mentionableIdSet());
  const added = mentions.filter((id) => !existing.mentions.includes(id));
  const comments = (t.comments ?? []).map((c) =>
    c.id === commentId ? { ...c, body: text, mentions, editedTs: stamp() } : c
  );
  patchTaskFields(taskId, { comments }, { activity: "edited a comment" });
  if (added.length) notifyMentions(added, editor, { taskId, label: taskId });
}

// Delete one's own comment.
export function deleteComment(taskId: string, commentId: string, actor: string = CURRENT_USER) {
  const t = taskById(taskId);
  if (!t) return;
  const existing = (t.comments ?? []).find((c) => c.id === commentId);
  if (!existing || existing.author !== actor) return;
  patchTaskFields(
    taskId,
    { comments: (t.comments ?? []).filter((c) => c.id !== commentId) },
    { activity: "deleted a comment" }
  );
}

// ─── Bucket comments (EN-001 / Item 4 — persisted, app-only) ─────────────────
// Buckets have no entity row, so their threads persist in a dedicated table via
// PATCH /api/buckets/{id}/comments (the whole array round-trips, the same shape
// task comments use). Each mutation applies optimistically, then mirrors through
// the same reconcile-on-success / rollback+notice-on-failure spine as
// patchTaskFields, so a thread the user saw survives the next hydrate and a
// failed write is never silently dropped. Comments stay app-only (never pushed
// to SharePoint, per the EN-001 decision).

type BucketCommentMirror = (bucketId: string, comments: Comment[]) => Promise<Comment[]>;

const defaultBucketCommentMirror: BucketCommentMirror = (bucketId, comments) =>
  api<Comment[]>(`/buckets/${bucketId}/comments`, {
    method: "PATCH",
    body: JSON.stringify({ actor: CURRENT_USER, comments }),
  });

let bucketCommentMirror = defaultBucketCommentMirror;
let bucketCommentMirrorInjected = false;
let bucketMirrorInFlight: Promise<void> = Promise.resolve();

// Test seam (mirrors __setPatchMirrorForTests): inject a deterministic mirror so
// the reconcile/rollback path runs under the Node test env. Pass null to restore.
export function __setBucketCommentMirrorForTests(fn: BucketCommentMirror | null) {
  bucketCommentMirror = fn ?? defaultBucketCommentMirror;
  bucketCommentMirrorInjected = fn !== null;
}

// Test seam: await the in-flight bucket-thread mirror (like __repoValidationSettled).
export function __bucketMirrorSettled(): Promise<void> {
  return bucketMirrorInFlight;
}

// Mirror the bucket's CURRENT thread to the server; reconcile to the stored
// result on success, restore `prior` + surface a notice on failure. No-op under
// SSR/tests with no injected mirror (the optimistic state stands).
function persistBucketThread(bucketId: string, prior: Comment[]): void {
  if (typeof window === "undefined" && !bucketCommentMirrorInjected) return;
  const next = state.bucketComments[bucketId] ?? [];
  bucketMirrorInFlight = bucketCommentMirror(bucketId, next).then(
    (saved) => {
      state.bucketComments = { ...state.bucketComments, [bucketId]: saved };
      emit();
    },
    (err) => {
      state.bucketComments = { ...state.bucketComments, [bucketId]: prior };
      pushNotice(
        `Couldn't save the comment on ${bucketId} — it was rolled back. ${
          err instanceof Error ? err.message : "The server rejected the update."
        }`
      );
      emit();
    }
  );
}

export function addBucketComment(bucketId: string, body: string, author: string = CURRENT_USER): Comment | null {
  const comment = buildComment(body, author);
  if (!comment) return null;
  const prior = clone(state.bucketComments[bucketId] ?? []);
  state.bucketComments = {
    ...state.bucketComments,
    [bucketId]: [...(state.bucketComments[bucketId] ?? []), comment],
  };
  emit();
  notifyMentions(comment.mentions, author, { label: bucketId });
  persistBucketThread(bucketId, prior);
  return comment;
}

export function editBucketComment(bucketId: string, commentId: string, body: string, editor: string = CURRENT_USER) {
  const text = body.trim();
  if (!text) return;
  const list = state.bucketComments[bucketId] ?? [];
  const existing = list.find((c) => c.id === commentId);
  if (!existing || existing.author !== editor) return;
  const prior = clone(list);
  const mentions = parseMentions(text, mentionableIdSet());
  const added = mentions.filter((id) => !existing.mentions.includes(id));
  state.bucketComments = {
    ...state.bucketComments,
    [bucketId]: list.map((c) =>
      c.id === commentId ? { ...c, body: text, mentions, editedTs: stamp() } : c
    ),
  };
  emit();
  if (added.length) notifyMentions(added, editor, { label: bucketId });
  persistBucketThread(bucketId, prior);
}

export function deleteBucketComment(bucketId: string, commentId: string, actor: string = CURRENT_USER) {
  const list = state.bucketComments[bucketId] ?? [];
  const existing = list.find((c) => c.id === commentId);
  if (!existing || existing.author !== actor) return;
  const prior = clone(list);
  state.bucketComments = {
    ...state.bucketComments,
    [bucketId]: list.filter((c) => c.id !== commentId),
  };
  emit();
  persistBucketThread(bucketId, prior);
}

// ─── Projects (P2 — parent above buckets) ────────────────────────────────────

export interface NewProjectInput {
  name: string;
  owner?: string;
  health?: Project["health"];
  target?: string;
  started?: string;
  desc?: string;
  repos?: string[];
  prd?: string | null;
}

function projectIdFromName(name: string, existing: Set<string>): string {
  const slug = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  const base = `PRJ-${slug || "NEW"}`;
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

type ProjectCreateMirror = (input: NewProjectInput & { repos: string[] }) => Promise<Project>;
const defaultProjectCreateMirror: ProjectCreateMirror = (input) =>
  api<Project>("/projects", { method: "POST", body: JSON.stringify(input) });
let projectCreateMirror = defaultProjectCreateMirror;
let projectCreateMirrorInjected = false;
let projectCreateInFlight: Promise<void> = Promise.resolve();

export function __setProjectCreateMirrorForTests(fn: ProjectCreateMirror | null) {
  projectCreateMirror = fn ?? defaultProjectCreateMirror;
  projectCreateMirrorInjected = fn !== null;
}

export function __projectCreateSettled(): Promise<void> {
  return projectCreateInFlight;
}

export function addProject(input: NewProjectInput): Project {
  const name = (input.name ?? "").trim();
  const id = projectIdFromName(name, new Set(Object.keys(state.projects)));
  const requestedRepos = input.repos ?? [];
  const repos = allowedReposOnly(requestedRepos, state.repos);
  const dropped = disallowedRepos(requestedRepos, state.repos);
  if (dropped.length > 0) {
    pushNotice(`Skipped repos not in the registry: ${dropped.join(", ")}. Request them first.`, "info");
  }
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, ".");
  const project: Project = {
    id,
    name,
    owner: input.owner || CURRENT_USER,
    health: input.health ?? "track",
    target: (input.target ?? "").trim() || "—",
    started: (input.started ?? "").trim() || today,
    desc: (input.desc ?? "").trim(),
    repos,
    sync: { state: "pending", ts: stamp(), sp: "Projects · unprovisioned" },
    prd: input.prd ?? null,
  };
  state.projects = { ...state.projects, [id]: project };
  pushAudit(project.owner, `Created project ${id} (${name}) — pending Projects mirror.`, "pending");
  emit();
  if (typeof window === "undefined" && !projectCreateMirrorInjected) return project;
  projectCreateInFlight = projectCreateMirror({ ...input, repos }).then(
    (created) => {
      const next = { ...state.projects };
      if (created.id !== id) delete next[id];
      next[created.id] = created;
      state.projects = next;
      emit();
    },
    (err) => {
      const next = { ...state.projects };
      delete next[id];
      state.projects = next;
      pushNotice(
        `Couldn't save the new project "${name}" — it was rolled back. ${
          err instanceof Error ? err.message : "The server rejected it."
        }`
      );
      emit();
    }
  );
  return project;
}

export type ProjectPatch = Partial<
  Pick<Project, "name" | "owner" | "health" | "target" | "started" | "desc" | "repos" | "prd">
>;

type ProjectUpdateMirror = (id: string, patch: ProjectPatch) => Promise<Project>;
const defaultProjectUpdateMirror: ProjectUpdateMirror = (id, patch) =>
  api<Project>(`/projects/${id}`, { method: "PATCH", body: JSON.stringify({ actor: CURRENT_USER, ...patch }) });
let projectUpdateMirror = defaultProjectUpdateMirror;
let projectUpdateMirrorInjected = false;
let projectUpdateInFlight: Promise<void> = Promise.resolve();

export function __setProjectUpdateMirrorForTests(fn: ProjectUpdateMirror | null) {
  projectUpdateMirror = fn ?? defaultProjectUpdateMirror;
  projectUpdateMirrorInjected = fn !== null;
}

export function __projectUpdateSettled(): Promise<void> {
  return projectUpdateInFlight;
}

export function updateProject(id: string, patch: ProjectPatch): Promise<void> | void {
  const existing = state.projects[id];
  if (!existing) return;
  let clamped: ProjectPatch = patch;
  if (patch.repos) {
    const repos = allowedReposOnly(patch.repos, state.repos);
    const dropped = disallowedRepos(patch.repos, state.repos);
    if (dropped.length > 0) pushNotice(`Skipped repos not in the registry: ${dropped.join(", ")}.`, "info");
    clamped = { ...patch, repos };
  }
  const entries = Object.entries(clamped).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;
  const prior = clone(existing);
  state.projects = { ...state.projects, [id]: { ...existing, ...Object.fromEntries(entries) } };
  emit();
  if (typeof window === "undefined" && !projectUpdateMirrorInjected) return;
  projectUpdateInFlight = projectUpdateMirror(id, clamped).then(
    (saved) => {
      state.projects = { ...state.projects, [id]: saved };
      emit();
    },
    (err) => {
      state.projects = { ...state.projects, [id]: prior };
      pushNotice(
        `Couldn't save the change to ${id} — it was rolled back. ${
          err instanceof Error ? err.message : "The server rejected the update."
        }`
      );
      emit();
    }
  );
  return projectUpdateInFlight;
}

// ─── Buckets / initiatives (EN-005) ──────────────────────────────────────────

export interface NewBucketInput {
  name: string;
  owner?: string;
  health?: Bucket["health"];
  target?: string;
  started?: string;
  desc?: string;
  repos?: string[];
  prd?: string | null;
  project?: string | null;
}

function bucketIdFromName(name: string, existing: Set<string>): string {
  const slug = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  const base = `BKT-${slug || "NEW"}`;
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

// The bucket-create POST mirror seam (parallels bucketUpdateMirror): default
// issues the real POST; tests inject a deterministic mirror to exercise the
// reconcile (adopt server id) / rollback (remove optimistic + notice) paths.
type BucketCreateMirror = (input: NewBucketInput & { repos: string[] }) => Promise<Bucket>;
const defaultBucketCreateMirror: BucketCreateMirror = (input) =>
  api<Bucket>("/buckets", { method: "POST", body: JSON.stringify(input) });
let bucketCreateMirror = defaultBucketCreateMirror;
let bucketCreateMirrorInjected = false;
let bucketCreateInFlight: Promise<void> = Promise.resolve();

export function __setBucketCreateMirrorForTests(fn: BucketCreateMirror | null) {
  bucketCreateMirror = fn ?? defaultBucketCreateMirror;
  bucketCreateMirrorInjected = fn !== null;
}

export function __bucketCreateSettled(): Promise<void> {
  return bucketCreateInFlight;
}

// Create an initiative/bucket. Optimistic-local (client id from the name) +
// mirror to POST /api/buckets; the server owns the id, so adopt its bucket if
// the optimistic id raced/collided. On a FAILED mirror the optimistic bucket is
// rolled back with a non-silent notice — a created initiative is never silently
// dropped (it would otherwise vanish on the next hydrate). Repos are clamped to
// the allow-list at the boundary with a non-silent notice (EN-002).
export function addBucket(input: NewBucketInput): Bucket {
  const name = (input.name ?? "").trim();
  const id = bucketIdFromName(name, new Set(Object.keys(state.buckets)));
  const requestedRepos = input.repos ?? [];
  const repos = allowedReposOnly(requestedRepos, state.repos);
  const dropped = disallowedRepos(requestedRepos, state.repos);
  if (dropped.length > 0) {
    pushNotice(`Skipped repos not in the registry: ${dropped.join(", ")}. Request them first.`, "info");
  }
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, ".");
  const defaultProject =
    input.project === undefined
      ? (state.projects["PRJ-PORTAL-GOLIVE"]?.id ?? Object.keys(state.projects)[0] ?? null)
      : input.project;
  const bucket: Bucket = {
    id,
    name,
    owner: input.owner || CURRENT_USER,
    health: input.health ?? "track",
    target: (input.target ?? "").trim() || "—",
    started: (input.started ?? "").trim() || today,
    desc: (input.desc ?? "").trim(),
    repos,
    sync: { state: "pending", ts: stamp(), sp: "Roadmap · unprovisioned" },
    prd: input.prd ?? null,
    project: defaultProject,
  };
  state.buckets = { ...state.buckets, [id]: bucket };
  pushAudit(bucket.owner, `Created initiative ${id} (${name}) — pending Roadmap mirror.`, "pending");
  emit();
  if (typeof window === "undefined" && !bucketCreateMirrorInjected) return bucket;
  bucketCreateInFlight = bucketCreateMirror({ ...input, repos }).then(
    (created) => {
      const next = { ...state.buckets };
      if (created.id !== id) delete next[id]; // adopt the server's id
      next[created.id] = created;
      state.buckets = next;
      emit();
    },
    (err) => {
      const next = { ...state.buckets };
      delete next[id]; // never leave an unpersisted initiative that vanishes on reload
      state.buckets = next;
      pushNotice(
        `Couldn't save the new initiative "${name}" — it was rolled back. ${
          err instanceof Error ? err.message : "The server rejected it."
        }`
      );
      emit();
    }
  );
  return bucket;
}

// The editable subset of a Bucket, routed through the single persisted-edit path.
export type BucketPatch = Partial<
  Pick<Bucket, "name" | "owner" | "health" | "target" | "started" | "desc" | "repos" | "prd" | "project">
>;

// The bucket-edit PATCH mirror seam (mirrors patchMirror): default issues the
// real PATCH; tests inject a deterministic mirror to exercise reconcile/rollback.
type BucketUpdateMirror = (id: string, patch: BucketPatch) => Promise<Bucket>;
const defaultBucketUpdateMirror: BucketUpdateMirror = (id, patch) =>
  api<Bucket>(`/buckets/${id}`, { method: "PATCH", body: JSON.stringify({ actor: CURRENT_USER, ...patch }) });
let bucketUpdateMirror = defaultBucketUpdateMirror;
let bucketUpdateMirrorInjected = false;
let bucketUpdateInFlight: Promise<void> = Promise.resolve();

export function __setBucketUpdateMirrorForTests(fn: BucketUpdateMirror | null) {
  bucketUpdateMirror = fn ?? defaultBucketUpdateMirror;
  bucketUpdateMirrorInjected = fn !== null;
}

export function __bucketUpdateSettled(): Promise<void> {
  return bucketUpdateInFlight;
}

// Edit an initiative. Optimistic merge + emit, then mirror PATCH /api/buckets/{id};
// on SUCCESS adopt the server's bucket, on FAILURE restore the prior bucket and
// surface a non-silent notice (the same reconcile/rollback spine as patchTaskFields).
export function updateBucket(id: string, patch: BucketPatch): Promise<void> | void {
  const existing = state.buckets[id];
  if (!existing) return;
  let clamped: BucketPatch = patch;
  if (patch.repos) {
    const repos = allowedReposOnly(patch.repos, state.repos);
    const dropped = disallowedRepos(patch.repos, state.repos);
    if (dropped.length > 0) pushNotice(`Skipped repos not in the registry: ${dropped.join(", ")}.`, "info");
    clamped = { ...patch, repos };
  }
  const entries = Object.entries(clamped).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;
  const prior = clone(existing);
  state.buckets = { ...state.buckets, [id]: { ...existing, ...Object.fromEntries(entries) } };
  emit();
  if (typeof window === "undefined" && !bucketUpdateMirrorInjected) return;
  bucketUpdateInFlight = bucketUpdateMirror(id, clamped).then(
    (saved) => {
      state.buckets = { ...state.buckets, [id]: saved };
      emit();
    },
    (err) => {
      state.buckets = { ...state.buckets, [id]: prior };
      pushNotice(
        `Couldn't save the change to ${id} — it was rolled back. ${
          err instanceof Error ? err.message : "The server rejected the update."
        }`
      );
      emit();
    }
  );
  return bucketUpdateInFlight;
}

// Reassign a task (null = unassign). Thin wrapper over the shared mutation
// spine. The Assigned To person column now mirrors to SharePoint on the next
// sync (Item 1) — the server (state.ts) re-queues the entity for push and the
// engine resolves the actor to a site-user id. A Teams/email notification on
// assignment is still deferred, so the trail never claims that delivery.
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
      `Unassigned ${taskId} — clearing Assigned To on the next SharePoint sync.`,
      "pending"
    );
    patchTaskFields(
      taskId,
      { assignee: null },
      { activity: "unassigned — Assigned To clears on the next SharePoint sync" }
    );
    return;
  }
  const who = state.actors[actorId];
  if (!who) return;
  // Client audit intentionally carries the assignee name for the local trail;
  // the server audit (state.ts) omits it — a documented divergence, not parity.
  pushAudit(
    CURRENT_USER,
    `Reassigned ${taskId} to ${who.name} — Assigned To mirrors to SharePoint on the next sync.`,
    "pending"
  );
  patchTaskFields(
    taskId,
    { assignee: actorId },
    { activity: `reassigned to ${who.name} — Assigned To mirrors to SharePoint on the next sync` }
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

// Test-only: inject open conflicts (non-seed). Seed SP_CONFLICTS is []; the
// console queue is fed by openConflicts() which hydrates from repo.openConflicts.
export function __setOpenConflictsForTests(conflicts: SpConflict[]) {
  state.conflicts = clone(conflicts);
  emit();
}

// Test-only: reset the store to the seed fixture.
export function resetStore() {
  state = initialState();
  notices = [];
  noticeSeq = 0;
  notifSeq = 0;
  commentSeq = 0;
  patchMirror = defaultPatchMirror;
  patchMirrorInjected = false;
  repoValidator = defaultRepoValidator;
  repoValidatorInjected = false;
  repoRequestSeq = 0;
  repoValidationInFlight = Promise.resolve();
  bucketCommentMirror = defaultBucketCommentMirror;
  bucketCommentMirrorInjected = false;
  bucketMirrorInFlight = Promise.resolve();
  bucketUpdateMirror = defaultBucketUpdateMirror;
  bucketUpdateMirrorInjected = false;
  bucketUpdateInFlight = Promise.resolve();
  bucketCreateMirror = defaultBucketCreateMirror;
  bucketCreateMirrorInjected = false;
  bucketCreateInFlight = Promise.resolve();
  projectCreateMirror = defaultProjectCreateMirror;
  projectCreateMirrorInjected = false;
  projectCreateInFlight = Promise.resolve();
  projectUpdateMirror = defaultProjectUpdateMirror;
  projectUpdateMirrorInjected = false;
  projectUpdateInFlight = Promise.resolve();
  emit();
}
