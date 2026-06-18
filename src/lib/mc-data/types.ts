// Canonical entity shapes for Mission Control.
// Mirrors docs/product/DATA_MODEL.md and the prototype's mc-data.js. This is the
// PROTOTYPE data contract; at the sync-engine milestone these types stay, but
// the in-memory fixtures (data.ts) are replaced by the API + SharePoint mirror
// (docs/product/SHAREPOINT_INTEGRATION.md).

export type Band = "todo" | "doing" | "done";

export type StageKey =
  | "backlog"
  | "specced"
  | "approved"
  | "planned"
  | "progress"
  | "qa"
  | "review"
  | "merged"
  | "verified";

export interface Stage {
  n: string;
  key: StageKey;
  name: string;
  band: Band;
  gate?: string;
}

export type PriorityKey = "urgent" | "high" | "medium" | "low";
export type Tone = "ok" | "warn" | "info" | "hot" | "muted" | "acc";

export interface PriorityConfig {
  label: string;
  cls: Extract<Tone, "hot" | "warn" | "info" | "muted">;
  tick: string;
}

export interface Human {
  id: string;
  kind: "human";
  name: string;
  init: string;
  role: string;
  online: boolean;
  email?: string;
  dept?: string;
  invited?: boolean;
}

export type AgentMode = "auto" | "approve";

export interface Agent {
  id: string;
  kind: "agent";
  name: string;
  init: string;
  model: string;
  team: string;
  mode: AgentMode;
  online: boolean;
}

export type Actor = Human | Agent;

export type RepoVisibility = "public" | "private";

export interface Repo {
  id: string;
  name: string;
  lang: string;
  // Default branch (the repo's GitHub default). `def` predates EN-002.
  def: string;
  // EN-002 governance metadata — the allow-list registry carries an owner,
  // visibility, and a one-line scope. Honest values only (resolved from the
  // GitHub org, never fabricated).
  owner: string;
  visibility: RepoVisibility;
  scope: string;
}

// A self-service request to add a repo to the registry/allow-list (EN-002).
// Any collaborator may file one; an approver (Owner/Admin) approves before it
// joins the registry. `verified` records the GitHub-org validation outcome at
// request time — an unverified request is never auto-promoted or fabricated.
export type RepoRequestStatus = "pending" | "approved" | "rejected";

export interface RepoRequest {
  id: string;
  name: string;
  owner: string;
  lang?: string;
  visibility?: RepoVisibility;
  scope?: string;
  def?: string;
  requestedBy: string;
  requestedTs: string;
  status: RepoRequestStatus;
  verified: boolean;
  note?: string;
  decidedBy?: string;
  decidedTs?: string;
}

export type Health = "track" | "risk" | "off";
export type SyncState = "synced" | "pending" | "conflict" | "error";

export interface SyncRef {
  state: SyncState;
  ts: string;
  sp: string;
  wsVal?: string;
  spVal?: string;
  reason?: string;
}

export interface Bucket {
  id: string;
  name: string;
  owner: string;
  health: Health;
  target: string;
  started: string;
  desc: string;
  repos: string[];
  sync: SyncRef;
  prd: string | null;
  empty?: boolean;
  // Bucket-level discussion thread (EN-001 / WS-3). Optional + app-only; the
  // runtime authority is the store's bucket-comment map (buckets have no
  // server persistence layer yet).
  comments?: Comment[];
}

export interface PullRequest {
  repo: string;
  num: number;
  status: "open" | "merged" | "closed";
  title: string;
}

// Sub-task status (EN-001 / WS-3 medium depth). `done` stays the canonical
// completion flag (drives the existing checkbox + counts); `status` is the
// richer lifecycle label, defaulting to derived from `done` when unset.
export type SubtaskStatus = "todo" | "doing" | "blocked" | "done";

export interface Subtask {
  id: string;
  t: string;
  done: boolean;
  // Original single-avatar field; kept for back-compat. `assignee` (below)
  // augments it as the explicit executor (human or agent) for v1 enrichment.
  who: string;
  // EN-001 / WS-3 sub-task enrichment (all optional — additive over the
  // prototype's flat checklist).
  description?: string;
  assignee?: string | null;
  due?: string;
  status?: SubtaskStatus;
}

// A free-form discussion comment (EN-001 / WS-3). App-only — never mirrored to
// a SharePoint column (aligned decision); lives in the task jsonb blob (server
// DB-only tier) or, for buckets, the store's bucket-comment map (no bucket
// server persistence exists yet — see WS3-NOTES.md).
export interface Comment {
  id: string;
  author: string;
  body: string;
  ts: string;
  mentions: string[];
  editedTs?: string;
}

export interface ActivityEntry {
  age: string;
  who: string;
  what: string;
  kind: string;
}

export interface EvidenceItem {
  key: string;
  label: string;
  done: boolean;
}

export interface QaTest {
  name: string;
  status: "pass" | "fail";
}

export interface Evidence {
  summary: string;
  items: EvidenceItem[];
  shots?: { label: string; cap: string }[];
  qa?: { pass: number; fail: number; total: number; suite: string; ran: string; tests: QaTest[] };
  rollback?: string | null;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  bucket: string;
  stage: StageKey;
  priority: PriorityKey;
  assignee: string | null;
  coassignees: string[];
  reporter: string;
  // Accountable owner — always a human (EN-003 split model): distinct from the
  // executor (`assignee`, human or agent). null until a human takes it on; a
  // task cannot advance past `planned` without one (see lib/mc-data/policy.ts).
  accountableOwner: string | null;
  // When set, agents cannot be the executor — enforced across the picker
  // (allowAgents=false), the store mutation, and the server.
  humanOnly?: boolean;
  reqs: string[];
  repos: string[];
  estimate: "S" | "M" | "L";
  labels: string[];
  prs: PullRequest[];
  due: string;
  sync: SyncRef;
  subtasks: Subtask[];
  activity: ActivityEntry[];
  // Task discussion thread (EN-001 / WS-3). Optional + app-only; persisted in
  // the task jsonb blob (server DB-only tier), never mirrored to a SharePoint
  // comment column (aligned decision).
  comments?: Comment[];
  evidence?: Evidence;
  blocked?: boolean;
  blockedReason?: string;
  merge?: { sha: string; on: string };
  userCreated?: boolean;
}

export type InboxKind = "approval" | "review" | "conflict" | "mention" | "assigned";

export interface InboxNotification {
  id: string;
  kind: InboxKind;
  task: string;
  actor: string;
  text: string;
  age: string;
  unread: boolean;
}

export interface SyncRegister {
  key: string;
  title: string;
  kind: "list" | "library";
  maps: string;
  counts: { synced: number; pending: number; conflict: number; error: number };
}

export type ConfidenceState = "ready" | "building" | "gap" | "blocked";

export interface Confidence {
  state: ConfidenceState;
  label: string;
  pct: number;
}

// ─── PRDs ────────────────────────────────────────────────────────────────────

export interface PrdRequirement {
  id: string;
  text: string;
  crit: string;
}

export interface Prd {
  id: string;
  bucket: string;
  title: string;
  status: string;
  approvedBy: string;
  drafted: string;
  problem: string;
  reqs: PrdRequirement[];
  nonGoals: string[];
  rollback: string;
}

// ─── Timeline overlays ───────────────────────────────────────────────────────

export interface Cycle {
  id: string;
  name: string;
  from: number;
  to: number;
}

export type MilestoneState = "now" | "upcoming" | "risk";

export interface Milestone {
  id: string;
  bucket: string;
  name: string;
  col: number;
  state: MilestoneState;
  sp: string;
}

// ─── Risks ───────────────────────────────────────────────────────────────────

export type RiskLevel = "High" | "Medium" | "Low";

export interface Risk {
  id: string;
  bucket: string;
  title: string;
  like: RiskLevel;
  impact: RiskLevel;
  owner: string;
  status: "open" | "mitigating" | "closed";
  mit: string;
  sync: SyncRef;
}

// ─── Agent activity feed ─────────────────────────────────────────────────────

export type FeedKind =
  | "run"
  | "review"
  | "pr"
  | "shot"
  | "sync"
  | "approve"
  | "block"
  | "comment";

export interface FeedEvent {
  age: string;
  actor: string;
  task: string;
  kind: FeedKind;
  text: string;
  chip: string;
  live?: boolean;
  human?: boolean;
  warn?: boolean;
  shots?: string[];
}

// ─── Traceability matrix ─────────────────────────────────────────────────────

export type TraceStatus = "satisfied" | "in-review" | "in-progress" | "gap";

export interface TraceRow {
  req: string;
  tasks: string[];
  prs: string[];
  evidence: "complete" | "partial" | "incomplete";
  test: string;
  merge: string;
  status: TraceStatus;
}

export interface Trace {
  bucket: string;
  rows: TraceRow[];
}

// ─── Files / document library ────────────────────────────────────────────────

export type FileKind = "folder" | "doc" | "pdf" | "sheet" | "img" | "zip" | "md";
export type DocType = "PRD" | "Evidence" | "Deed" | "Report" | "Spec" | "Export";

export interface FileEntry {
  id: string;
  name: string;
  kind: FileKind;
  parent: string | null;
  bucket?: string;
  docType?: DocType;
  modified?: string;
  modifiedBy?: string;
  size?: string;
  sync?: SyncRef;
}

// ─── SharePoint schema (the system-of-record spec) ───────────────────────────

export type SyncDirection = "two-way" | "push" | "pull";

export interface SpColumn {
  name: string;
  type: string;
  mc: string;
  dir: SyncDirection;
  required?: boolean;
  note?: string;
}

export interface SpListDef {
  key: string;
  title: string;
  kind: "list" | "library";
  entity: string;
  icon: string;
  maps: string;
  itemCount: number;
  direction: SyncDirection;
  lastSync: string;
  counts: { synced: number; pending: number; conflict: number; error: number };
  columns: SpColumn[];
  folders?: string;
}

export interface SpSite {
  name: string;
  host: string;
  path: string;
  tz: string;
  connected: boolean;
}

export interface SpConflict {
  id: string;
  list: string;
  entity: string;
  entityId: string;
  field: string;
  mcVal: string;
  spVal: string;
  detected: string;
  by: string;
  note: string;
}

export interface SpError {
  id: string;
  list: string;
  entity: string;
  entityId: string;
  field: string;
  value: string;
  reason: string;
}

export interface AuditRow {
  ts: string;
  actor: string;
  body: string;
  state: SyncState;
}
