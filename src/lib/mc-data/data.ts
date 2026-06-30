// PROTOTYPE FIXTURE — illustrative mock data, faithful to docs/product/prototype/mc-data.js.
// Replaced at the sync-engine milestone by the API + SharePoint mirror
// (docs/product/SHAREPOINT_INTEGRATION.md). Entities are added per-screen as
// each screen is built; this file currently carries what the shell + Inbox use.

import type {
  Agent,
  AgentMode,
  Bucket,
  Project,
  Cycle,
  FileEntry,
  Human,
  InboxNotification,
  Milestone,
  Prd,
  PriorityConfig,
  PriorityKey,
  Repo,
  Risk,
  SpConflict,
  SpError,
  SpListDef,
  SpSite,
  Stage,
  SyncRegister,
  TargetEnv,
  Task,
  Trace,
} from "./types";

// The signed-in human whose cockpit this is (the operator, until M365 auth lands).
export const CURRENT_USER = "vince";

export const STAGES: Stage[] = [
  { n: "01", key: "backlog", name: "Backlog", band: "todo" },
  { n: "02", key: "specced", name: "Specced", band: "todo", gate: "PRD" },
  { n: "03", key: "approved", name: "Approved", band: "todo" },
  { n: "04", key: "planned", name: "Planned", band: "todo" },
  { n: "05", key: "progress", name: "In Progress", band: "doing" },
  { n: "06", key: "qa", name: "In QA", band: "doing", gate: "Evidence" },
  { n: "07", key: "review", name: "In Review", band: "doing" },
  { n: "08", key: "merged", name: "Merged", band: "done" },
  { n: "09", key: "verified", name: "Verified", band: "done" },
];

export const STAGE_IDX: Record<string, number> = Object.fromEntries(
  STAGES.map((s, i) => [s.key, i])
);

export const BANDS: { key: "todo" | "doing" | "done"; name: string }[] = [
  { key: "todo", name: "To do" },
  { key: "doing", name: "In progress" },
  { key: "done", name: "Done" },
];

export const PRIORITY: Record<PriorityKey, PriorityConfig> = {
  urgent: { label: "Urgent", cls: "hot", tick: "▰▰▰▰" },
  high: { label: "High", cls: "warn", tick: "▰▰▰▱" },
  medium: { label: "Medium", cls: "info", tick: "▰▰▱▱" },
  low: { label: "Low", cls: "muted", tick: "▰▱▱▱" },
};

export const TARGET_ENV: Record<TargetEnv, { label: string }> = {
  staging: { label: "Staging" },
  production: { label: "Production" },
};

export const DEFAULT_TARGET_ENV: TargetEnv = "staging";

// Real PLX directory — the six people resolved from the Microsoft 365 tenant
// via Microsoft Graph (EN-003 / WS-1; see scripts/resolve-directory.mjs and
// WS1-NOTES.md). All confirmed @petrasoap.com identities. `role` uses each
// person's confirmed Graph jobTitle where present, else the honest default
// "Contributor" (never an invented title). `online` is presence we do not yet
// wire — only the signed-in operator (vince) is shown present.
export const HUMANS: Record<string, Human> = {
  greg: { id: "greg", kind: "human", name: "Greg Mitchell", init: "GM", role: "Contributor", online: false, email: "greg.m@petrasoap.com", dept: "Marketing" },
  rishi: { id: "rishi", kind: "human", name: "Rishi", init: "RI", role: "Contributor", online: false, email: "rishi@petrasoap.com" },
  ricardo: { id: "ricardo", kind: "human", name: "Ricardo Savelli Fuzito", init: "RS", role: "Contributor", online: false, email: "ricardo@petrasoap.com", dept: "Production" },
  stephen: { id: "stephen", kind: "human", name: "Stephen Alton", init: "SA", role: "Operations Director", online: false, email: "stephen@petrasoap.com", dept: "IT" },
  ross: { id: "ross", kind: "human", name: "Ross Pennino", init: "RP", role: "Contributor", online: false, email: "ross@petrasoap.com", dept: "Customer Service" },
  vince: { id: "vince", kind: "human", name: "Vince Alton", init: "VA", role: "Owner", online: true, email: "vince@petrasoap.com", dept: "IT" },
};

// Agent roster (EN-005 / WS-5). Curated in-repo fixture is the source of truth
// for v1 (no runtime coupling to agentic-swarm; the operator can swap in live
// swarm names later). Each agent now carries a real operational model:
// `capabilities` (what it does), `defaultRepos` (advisory — registry ids; the
// task allow-list still governs), and an enforced `mode` (auto vs needs-approval,
// see policy.ts). `online` is honest: there is no heartbeat, so it is false —
// live presence is DERIVED from in-flight assignment (helpers.agentIsActive).
export const AGENTS: Record<string, Agent> = {
  vibes: { id: "vibes", kind: "agent", name: "Vibes", init: "VB", model: "Sonnet", team: "Dev", mode: "auto", online: false, capabilities: ["code", "refactor", "tests"], defaultRepos: ["portal-web", "agentic-swarm"] },
  atlas: { id: "atlas", kind: "agent", name: "Atlas", init: "AT", model: "Opus", team: "Research", mode: "approve", online: false, capabilities: ["research", "prd", "design"], defaultRepos: ["plx-mc"] },
  sentry: { id: "sentry", kind: "agent", name: "Sentry", init: "SY", model: "Sonnet", team: "QA", mode: "auto", online: false, capabilities: ["qa", "tests", "evidence"], defaultRepos: ["portal-web"] },
  scribe: { id: "scribe", kind: "agent", name: "Scribe", init: "SC", model: "Opus", team: "Ops", mode: "approve", online: false, capabilities: ["docs", "sync", "prd"], defaultRepos: ["plx-mc"] },
};

export const ACTORS: Record<string, Human | Agent> = {
  ...HUMANS,
  ...AGENTS,
};

export const MODE: Record<AgentMode, { label: string; short: string }> = {
  auto: { label: "Autonomous", short: "AUTO" },
  approve: { label: "Needs-approval", short: "APPROVE" },
};

export const PETRA_DOMAINS = ["petralabx.com", "petrasoap.com"];

// Repo registry = the allow-list (EN-002 / WS-2). Exactly the three canonical
// repos under the taylorvalton GitHub org; the four demo placeholders were
// removed. Metadata (visibility, default branch, language) is resolved from the
// GitHub org — honest values only, no fabricated PR/task counts (the Repos
// screen derives live counts from task membership and PRs). The org is the
// validation source for self-service additions (see lib/mc-data/repos.ts).
export const REPO_ORG = "taylorvalton";

export const REPOS: Record<string, Repo> = {
  "portal-web": { id: "portal-web", name: "plx-customer-portal", lang: "TypeScript · Next.js", def: "staging", owner: REPO_ORG, visibility: "private", scope: "Customer portal web application — the go-live codebase." },
  "agentic-swarm": { id: "agentic-swarm", name: "agentic-swarm", lang: "TypeScript", def: "main", owner: REPO_ORG, visibility: "private", scope: "Background agent swarm that does the work." },
  "plx-mc": { id: "plx-mc", name: "PLX_MC", lang: "TypeScript", def: "main", owner: REPO_ORG, visibility: "public", scope: "Mission Control — the human cockpit over the agents." },
};

// Demo/prototype buckets purged 2026-06-11 — only the PLX Portal go-live plan
// remains (operator request; the prototype look/behavior spec lives in
// docs/product/prototype/ if reference data is ever needed again).
// Projects (P2) — the parent layer above buckets. All current go-live buckets
// roll up to one umbrella project; the FK is optional so this stays additive.
export const PROJECTS: Project[] = [
  { id: "PRJ-PORTAL-GOLIVE", name: "PLX Portal Go-Live", owner: "vince", health: "track", target: "Oct 01", started: "2026.06.11", desc: "Umbrella project for all PLX Portal go-live initiatives.", repos: ["portal-web"], sync: { state: "pending", ts: "—", sp: "Roadmap · unprovisioned" }, prd: null },
];

export const BUCKETS: Bucket[] = [
  // ─── PLX Portal go-live plan (seeded 2026-06-11) — one bucket per workstream.
  // All pending with "unprovisioned" refs until /sites/plx-mission-control is
  // provisioned and the engine points at it (no fabricated sync evidence).
  // EN-002 backfill (2026-06-17): every bucket attaches plx-customer-portal
  // (id "portal-web") — all current workstreams are PLX Portal go-live work.
  { id: "BKT-WMS", name: "WMS Integration", owner: "vince", health: "track", target: "Jun 15", started: "2026.06.11", desc: "Warehouse management system integration for the portal go-live.", repos: ["portal-web"], sync: { state: "pending", ts: "—", sp: "Roadmap · unprovisioned" }, prd: null, project: "PRJ-PORTAL-GOLIVE" },
  { id: "BKT-DAPI", name: "Decoupling API", owner: "vince", health: "track", target: "Jun 15", started: "2026.06.11", desc: "Decouple the portal from backend services — the Swagger-first contract is the deliverable.", repos: ["portal-web"], sync: { state: "pending", ts: "—", sp: "Roadmap · unprovisioned" }, prd: null, project: "PRJ-PORTAL-GOLIVE" },
  { id: "BKT-PROD", name: "Product Development", owner: "vince", health: "track", target: "Jun 29", started: "2026.06.11", desc: "Portal product development through the Jun 29 test gate; Account Management is stretch scope.", repos: ["portal-web"], sync: { state: "pending", ts: "—", sp: "Roadmap · unprovisioned" }, prd: null, project: "PRJ-PORTAL-GOLIVE" },
  { id: "BKT-FIN", name: "Finance", owner: "vince", health: "track", target: "Jul 20", started: "2026.06.11", desc: "Finance workstream — build Jun 29–Jul 13, test complete Jul 20.", repos: ["portal-web"], sync: { state: "pending", ts: "—", sp: "Roadmap · unprovisioned" }, prd: null, project: "PRJ-PORTAL-GOLIVE" },
  { id: "BKT-QMS", name: "QMS", owner: "vince", health: "track", target: "Jul 20", started: "2026.06.11", desc: "Quality management system — forms + DocuSign.", repos: ["portal-web"], sync: { state: "pending", ts: "—", sp: "Roadmap · unprovisioned" }, prd: null, project: "PRJ-PORTAL-GOLIVE" },
  { id: "BKT-SHOP", name: "Shopify → Business Central", owner: "vince", health: "track", target: "Aug 31", started: "2026.06.11", desc: "Shopify to Business Central migration — owned by Greg and Stephen (directory entries pending).", repos: ["portal-web"], sync: { state: "pending", ts: "—", sp: "Roadmap · unprovisioned" }, prd: null, project: "PRJ-PORTAL-GOLIVE" },
  { id: "BKT-INFRA", name: "Backend Infra", owner: "vince", health: "track", target: "Oct 01", started: "2026.06.11", desc: "Cross-cutting platform/infra work supporting go-live.", repos: ["portal-web"], sync: { state: "pending", ts: "—", sp: "Roadmap · unprovisioned" }, prd: null, project: "PRJ-PORTAL-GOLIVE" },
  { id: "BKT-UAT", name: "UAT", owner: "vince", health: "track", target: "Oct 01", started: "2026.06.11", desc: "Owns parallel testing and the go-live milestones. UAT posture is the portal-published uat quality-ledger surfaced via Loop Ledgers; see docs/modules/uat.", repos: ["portal-web"], sync: { state: "pending", ts: "—", sp: "Roadmap · unprovisioned" }, prd: null, project: "PRJ-PORTAL-GOLIVE" },
];

export const BUCKET_IDX: Record<string, Bucket> = Object.fromEntries(
  BUCKETS.map((b) => [b.id, b])
);

// Demo/prototype tasks purged 2026-06-11 — only the go-live plan remains.
export const TASKS: Task[] = [
  // ─── PLX Portal go-live plan (seeded 2026-06-11): 10-week schedule. All
  // pending with "unprovisioned" refs until /sites/plx-mission-control lands.
  // Greg/Stephen (Shopify → BC owners) are not in the directory yet, so those
  // tasks stay unassigned.
  {
    id: "TASK-221", title: "WMS integration", bucket: "BKT-WMS", stage: "planned", priority: "medium",
    assignee: null, coassignees: [], reporter: "vince", accountableOwner: "vince", reqs: [], repos: ["portal-web"], estimate: "M",
    labels: ["go-live"], prs: [],
    due: "Jun 15", sync: { state: "pending", ts: "—", sp: "ToDos · unprovisioned" }, subtasks: [],
    activity: [{ age: "now", who: "vince", what: "seeded from the PLX Portal go-live plan — week of Jun 15", kind: "move" }],
  },
  {
    id: "TASK-222", title: "Decoupling API — Swagger-first contract", bucket: "BKT-DAPI", stage: "planned", priority: "medium",
    assignee: null, coassignees: [], reporter: "vince", accountableOwner: "vince", reqs: [], repos: ["portal-web"], estimate: "M",
    labels: ["go-live", "api"], prs: [],
    due: "Jun 15", sync: { state: "pending", ts: "—", sp: "ToDos · unprovisioned" }, subtasks: [],
    activity: [{ age: "now", who: "vince", what: "seeded from the PLX Portal go-live plan — the Swagger contract is the deliverable", kind: "move" }],
  },
  {
    id: "TASK-223", title: "Product development", bucket: "BKT-PROD", stage: "planned", priority: "medium",
    assignee: null, coassignees: [], reporter: "vince", accountableOwner: "vince", reqs: [], repos: ["portal-web"], estimate: "M",
    labels: ["go-live"], prs: [],
    due: "Jun 15", sync: { state: "pending", ts: "—", sp: "ToDos · unprovisioned" }, subtasks: [],
    activity: [{ age: "now", who: "vince", what: "seeded from the PLX Portal go-live plan — week of Jun 15", kind: "move" }],
  },
  {
    id: "TASK-224", title: "Product development (cont.)", bucket: "BKT-PROD", stage: "planned", priority: "medium",
    assignee: null, coassignees: [], reporter: "vince", accountableOwner: "vince", reqs: [], repos: ["portal-web"], estimate: "M",
    labels: ["go-live"], prs: [],
    due: "Jun 22", sync: { state: "pending", ts: "—", sp: "ToDos · unprovisioned" }, subtasks: [],
    activity: [{ age: "now", who: "vince", what: "seeded from the PLX Portal go-live plan — week of Jun 22", kind: "move" }],
  },
  {
    id: "TASK-225", title: "Stretch: Account Management", bucket: "BKT-PROD", stage: "backlog", priority: "low",
    description: "Stretch scope — only pulled if Product Development is ahead of schedule.",
    assignee: null, coassignees: [], reporter: "vince", accountableOwner: "vince", reqs: [], repos: ["portal-web"], estimate: "M",
    labels: ["go-live", "stretch"], prs: [],
    due: "Jun 22", sync: { state: "pending", ts: "—", sp: "ToDos · unprovisioned" }, subtasks: [],
    activity: [{ age: "now", who: "vince", what: "seeded as stretch scope — pulled only if ahead", kind: "move" }],
  },
  {
    id: "TASK-226", title: "Build Finance", bucket: "BKT-FIN", stage: "planned", priority: "medium",
    assignee: null, coassignees: [], reporter: "vince", accountableOwner: "vince", reqs: [], repos: ["portal-web"], estimate: "M",
    labels: ["go-live", "finance"], prs: [],
    due: "Jun 29", sync: { state: "pending", ts: "—", sp: "ToDos · unprovisioned" }, subtasks: [],
    activity: [{ age: "now", who: "vince", what: "seeded from the PLX Portal go-live plan — build starts week of Jun 29", kind: "move" }],
  },
  {
    id: "TASK-227", title: "Test product development", bucket: "BKT-PROD", stage: "qa", priority: "high",
    assignee: null, coassignees: [], reporter: "vince", accountableOwner: "vince", reqs: [], repos: ["portal-web"], estimate: "M",
    labels: ["go-live", "testing"], prs: [],
    due: "Jun 29", sync: { state: "pending", ts: "—", sp: "ToDos · unprovisioned" }, subtasks: [],
    evidence: {
      summary: "Evidence-gated test week for Product Development (Jun 29).",
      items: [
        { key: "summary", label: "Summary — what was tested", done: false },
        { key: "qa", label: "E2E QA results", done: false },
        { key: "shots", label: "Before / after screenshots", done: false },
        { key: "rollback", label: "Rollback plan", done: false },
      ],
    },
    activity: [{ age: "now", who: "vince", what: "seeded as the evidence-gated Product Development test week", kind: "move" }],
  },
  {
    id: "TASK-228", title: "Build Finance (cont.)", bucket: "BKT-FIN", stage: "planned", priority: "medium",
    assignee: null, coassignees: [], reporter: "vince", accountableOwner: "vince", reqs: [], repos: ["portal-web"], estimate: "M",
    labels: ["go-live", "finance"], prs: [],
    due: "Jul 06", sync: { state: "pending", ts: "—", sp: "ToDos · unprovisioned" }, subtasks: [],
    activity: [{ age: "now", who: "vince", what: "seeded from the PLX Portal go-live plan — week of Jul 6", kind: "move" }],
  },
  {
    id: "TASK-229", title: "Build Finance (cont.)", bucket: "BKT-FIN", stage: "planned", priority: "medium",
    assignee: null, coassignees: [], reporter: "vince", accountableOwner: "vince", reqs: [], repos: ["portal-web"], estimate: "M",
    labels: ["go-live", "finance"], prs: [],
    due: "Jul 13", sync: { state: "pending", ts: "—", sp: "ToDos · unprovisioned" }, subtasks: [],
    activity: [{ age: "now", who: "vince", what: "seeded from the PLX Portal go-live plan — week of Jul 13", kind: "move" }],
  },
  {
    id: "TASK-230", title: "Test Finance", bucket: "BKT-FIN", stage: "qa", priority: "high",
    assignee: null, coassignees: [], reporter: "vince", accountableOwner: "vince", reqs: [], repos: ["portal-web"], estimate: "M",
    labels: ["go-live", "testing", "finance"], prs: [],
    due: "Jul 20", sync: { state: "pending", ts: "—", sp: "ToDos · unprovisioned" }, subtasks: [],
    evidence: {
      summary: "Evidence-gated test week for Finance (Jul 20).",
      items: [
        { key: "summary", label: "Summary — what was tested", done: false },
        { key: "qa", label: "E2E QA results", done: false },
        { key: "shots", label: "Before / after screenshots", done: false },
        { key: "rollback", label: "Rollback plan", done: false },
      ],
    },
    activity: [{ age: "now", who: "vince", what: "seeded as the evidence-gated Finance test week", kind: "move" }],
  },
  {
    id: "TASK-231", title: "QMS — Forms + DocuSign", bucket: "BKT-QMS", stage: "planned", priority: "medium",
    assignee: null, coassignees: [], reporter: "vince", accountableOwner: "vince", reqs: [], repos: ["portal-web"], estimate: "M",
    labels: ["go-live", "qms"], prs: [],
    due: "Jul 20", sync: { state: "pending", ts: "—", sp: "ToDos · unprovisioned" }, subtasks: [],
    activity: [{ age: "now", who: "vince", what: "seeded from the PLX Portal go-live plan — week of Jul 20", kind: "move" }],
  },
  {
    id: "TASK-232", title: "Shopify → Business Central migration", bucket: "BKT-SHOP", stage: "planned", priority: "medium",
    description: "Owned by Greg and Stephen — unassigned until their directory entries exist.",
    assignee: null, coassignees: [], reporter: "vince", accountableOwner: "vince", reqs: [], repos: ["portal-web"], estimate: "L",
    labels: ["go-live", "migration"], prs: [],
    due: "Aug 31", sync: { state: "pending", ts: "—", sp: "ToDos · unprovisioned" }, subtasks: [],
    activity: [{ age: "now", who: "vince", what: "seeded from the PLX Portal go-live plan — August, owners Greg & Stephen", kind: "move" }],
  },
  {
    id: "TASK-233", title: "Unstructured to-dos — needs breakdown", bucket: "BKT-SHOP", stage: "backlog", priority: "low",
    description: "Single placeholder for the August unstructured items; break down before the build window.",
    assignee: null, coassignees: [], reporter: "vince", accountableOwner: "vince", reqs: [], repos: ["portal-web"], estimate: "M",
    labels: ["go-live", "needs-breakdown"], prs: [],
    due: "Aug 31", sync: { state: "pending", ts: "—", sp: "ToDos · unprovisioned" }, subtasks: [],
    activity: [{ age: "now", who: "vince", what: "seeded as a placeholder — needs breakdown", kind: "move" }],
  },
  {
    id: "TASK-234", title: "Parallel system testing — execution", bucket: "BKT-UAT", stage: "planned", priority: "high",
    assignee: null, coassignees: [], reporter: "vince", accountableOwner: "vince", reqs: [], repos: ["portal-web"], estimate: "L",
    labels: ["go-live", "testing", "uat"], prs: [],
    due: "Sep 01", sync: { state: "pending", ts: "—", sp: "ToDos · unprovisioned" }, subtasks: [],
    activity: [{ age: "now", who: "vince", what: "seeded from the PLX Portal go-live plan — parallel testing from Sept 1", kind: "move" }],
  },
  {
    id: "TASK-235", title: "Define go-live infra checklist — environments, cutover, rollback", bucket: "BKT-INFRA", stage: "backlog", priority: "medium",
    assignee: null, coassignees: [], reporter: "vince", accountableOwner: "vince", reqs: [], repos: ["portal-web"], estimate: "M",
    labels: ["go-live", "infra"], prs: [],
    due: "Oct 01", sync: { state: "pending", ts: "—", sp: "ToDos · unprovisioned" }, subtasks: [],
    activity: [{ age: "now", who: "vince", what: "seeded as the Backend Infra placeholder — concrete items to follow", kind: "move" }],
  },
];

export const TASK_IDX: Record<string, Task> = Object.fromEntries(
  TASKS.map((t) => [t.id, t])
);

// Demo notifications purged 2026-06-11; one honest seed entry remains so the
// unread-badge path stays exercised until real notifications land.
export const INBOX: InboxNotification[] = [
  { id: "n1", kind: "mention", task: "TASK-221", actor: "scribe", text: "Go-live plan seeded — 15 tasks across 8 workstreams await owners", age: "now", unread: true },
];

// ─── PRDs (Problem · Requirements · Acceptance · Non-goals · Rollback) ───────
// Demo PRD purged 2026-06-11; go-live workstreams have no PRDs yet (prd: null).
export const PRDS: Record<string, Prd> = {};

// ─── Cycles + Milestones (timeline overlays; day cols in a 30-day June grid) ─
export const CYCLES: Cycle[] = [
  { id: "C-23", name: "Cycle 23", from: 1, to: 14 },
  { id: "C-24", name: "Cycle 24", from: 15, to: 28 },
];

// Demo milestones purged 2026-06-11 — only the go-live plan remains.
export const MILESTONES: Milestone[] = [
  // PLX Portal go-live plan (2026-06-11). col is days from Jun 1 — these fall
  // beyond the 30-day June timeline grid, so the timeline pins them at the
  // grid's right edge (pctOfDay clamps); milestone lists show them in full.
  { id: "M-6", bucket: "BKT-UAT", name: "Parallel System Testing", col: 93, state: "upcoming", sp: "Milestone Register · unprovisioned" },
  { id: "M-7", bucket: "BKT-UAT", name: "Production Go-Live", col: 123, state: "upcoming", sp: "Milestone Register · unprovisioned" },
];

// ─── Risks (roll up to buckets, mirror to Risk Register) ─────────────────────
// Demo risks purged 2026-06-11 — only the go-live plan remains.
export const RISKS: Risk[] = [
  // PLX Portal go-live plan (2026-06-11).
  { id: "RISK-8", bucket: "BKT-PROD", title: "Account Management slips out of scope if Product Development runs long", like: "Medium", impact: "Medium", owner: "vince", status: "open", mit: "Stretch scope is only pulled if ahead; review at the Jun 29 test gate.", sync: { state: "pending", ts: "—", sp: "Risk Register · unprovisioned" } },
  { id: "RISK-9", bucket: "BKT-SHOP", title: "Shopify → BC migration owned outside the core team, landing directly before parallel testing", like: "Medium", impact: "High", owner: "vince", status: "open", mit: "Confirm Greg/Stephen ownership and a mid-August checkpoint before Sept 1 parallel testing.", sync: { state: "pending", ts: "—", sp: "Risk Register · unprovisioned" } },
  { id: "RISK-10", bucket: "BKT-UAT", title: "SharePoint provisioning not complete before the plan needs to sync", like: "Medium", impact: "High", owner: "vince", status: "open", mit: "Track site provisioning; keep sync sweeps off until /sites/plx-mission-control is live and the engine points at it.", sync: { state: "pending", ts: "—", sp: "Risk Register · unprovisioned" } },
];

// ─── Agent activity feed ─────────────────────────────────────────────────────
// Derived from real agent-authored task activity at render (EN-005 / WS-5; see
// components/mc/record-logic.ts deriveAgentFeed) — no static fixture. Empty until
// agents actually pick up go-live plan tasks.

// ─── Traceability matrix (REQ → Task → PR → Evidence → Test → Merge) ─────────
// Demo matrix purged 2026-06-11; rows return when the first go-live PRD lands.
export const TRACE: Trace = {
  bucket: "BKT-PROD",
  rows: [],
};

// ─── Project Documents library (flat list with parent pointers) ──────────────
// Demo documents purged 2026-06-11. One folder per go-live workstream plus
// Shared (the spec's per-initiative tree grows when documents sync lands);
// no fabricated files.
export const FILES: FileEntry[] = [
  { id: "fo-wms", name: "WMS Integration", kind: "folder", parent: null, bucket: "BKT-WMS" },
  { id: "fo-dapi", name: "Decoupling API", kind: "folder", parent: null, bucket: "BKT-DAPI" },
  { id: "fo-prod", name: "Product Development", kind: "folder", parent: null, bucket: "BKT-PROD" },
  { id: "fo-fin", name: "Finance", kind: "folder", parent: null, bucket: "BKT-FIN" },
  { id: "fo-qms", name: "QMS", kind: "folder", parent: null, bucket: "BKT-QMS" },
  { id: "fo-shop", name: "Shopify → Business Central", kind: "folder", parent: null, bucket: "BKT-SHOP" },
  { id: "fo-infra", name: "Backend Infra", kind: "folder", parent: null, bucket: "BKT-INFRA" },
  { id: "fo-uat", name: "UAT", kind: "folder", parent: null, bucket: "BKT-UAT" },
  { id: "fo-shared", name: "Shared", kind: "folder", parent: null },
];

// ─── Canonical SharePoint schema (system of record) ──────────────────────────
export const SP_SITE: SpSite = {
  name: "PLX Mission Control",
  host: "petrasoap.sharepoint.com",
  path: "/sites/plx-mission-control",
  tz: "UTC",
  connected: true,
};
// No sweep has run against the production site yet; live values arrive from
// the API on hydration.
export const SP_LAST_SWEEP = "—";
export const SP_CADENCE = "every 5 min + on change (webhook)";

export const SP_LISTS: SpListDef[] = [
  {
    key: "todos", title: "ToDos", kind: "list", entity: "Task", icon: "▦",
    maps: "Tasks", itemCount: 15, direction: "two-way",
    lastSync: "—", counts: { synced: 0, pending: 15, conflict: 0, error: 0 },
    columns: [
      { name: "Title", type: "Single line of text", mc: "title", dir: "two-way", required: true },
      { name: "Task ID", type: "Single line of text", mc: "id", dir: "pull", required: true, note: "indexed · unique key" },
      { name: "Status", type: "Choice", mc: "stage", dir: "two-way", note: "Backlog→Verified (9)" },
      { name: "Assigned To", type: "Person", mc: "assignee", dir: "two-way" },
      { name: "Accountable Owner", type: "Person", mc: "accountableOwner", dir: "push", note: "EN-003 — human accountable owner" },
      { name: "Reporter", type: "Person", mc: "reporter", dir: "push" },
      { name: "Priority", type: "Choice", mc: "priority", dir: "two-way", note: "Urgent/High/Medium/Low" },
      { name: "Due Date", type: "Date and time", mc: "due", dir: "two-way" },
      { name: "Initiative", type: "Lookup → Roadmap", mc: "bucket", dir: "two-way" },
      { name: "PRD Requirements", type: "Multi line of text", mc: "reqs", dir: "push" },
      { name: "Estimate", type: "Choice", mc: "estimate", dir: "push", note: "S/M/L" },
      { name: "Repos", type: "Multi line of text", mc: "repos", dir: "push" },
      { name: "Target Environment", type: "Choice", mc: "targetEnv", dir: "push", note: "Staging/Production" },
      { name: "Evidence Complete", type: "Yes/No", mc: "evidence", dir: "push" },
      { name: "Description", type: "Multi line of text", mc: "description", dir: "two-way" },
      { name: "Sub-tasks", type: "Multi line of text", mc: "subtasks", dir: "push", note: "Item 3 — serialized push-only mirror" },
    ],
  },
  {
    key: "roadmap", title: "Roadmap", kind: "list", entity: "Initiative", icon: "◷",
    maps: "Buckets / Initiatives + Gantt", itemCount: 8, direction: "two-way",
    lastSync: "—", counts: { synced: 0, pending: 8, conflict: 0, error: 0 },
    columns: [
      { name: "Title", type: "Single line of text", mc: "name", dir: "two-way", required: true },
      { name: "Initiative ID", type: "Single line of text", mc: "id", dir: "pull", required: true },
      { name: "Owner", type: "Person", mc: "owner", dir: "two-way" },
      { name: "Health", type: "Choice", mc: "health", dir: "two-way", note: "On track/At risk/Off track" },
      { name: "Start Date", type: "Date and time", mc: "started", dir: "two-way", note: "Gantt bar start" },
      { name: "Target Date", type: "Date and time", mc: "target", dir: "two-way", note: "Gantt bar end" },
      { name: "% Complete", type: "Number", mc: "progress", dir: "push" },
      { name: "PRD Link", type: "Hyperlink", mc: "prd", dir: "push" },
    ],
  },
  {
    key: "milestones", title: "Milestone Register", kind: "list", entity: "Milestone", icon: "◆",
    maps: "Milestones", itemCount: 2, direction: "two-way",
    lastSync: "—", counts: { synced: 0, pending: 2, conflict: 0, error: 0 },
    columns: [
      { name: "Title", type: "Single line of text", mc: "name", dir: "two-way", required: true },
      { name: "Initiative", type: "Lookup → Roadmap", mc: "bucket", dir: "two-way" },
      { name: "State", type: "Choice", mc: "state", dir: "two-way", note: "Upcoming/Active/At risk/Met" },
      { name: "Due Date", type: "Date and time", mc: "col", dir: "two-way" },
      { name: "Register Ref", type: "Single line of text", mc: "sp", dir: "pull" },
    ],
  },
  {
    key: "risks", title: "Risk Register", kind: "list", entity: "Risk", icon: "△",
    maps: "Risks", itemCount: 3, direction: "two-way",
    lastSync: "—", counts: { synced: 0, pending: 3, conflict: 0, error: 0 },
    columns: [
      { name: "Title", type: "Single line of text", mc: "title", dir: "two-way", required: true },
      { name: "Initiative", type: "Lookup → Roadmap", mc: "bucket", dir: "two-way" },
      { name: "Likelihood", type: "Choice", mc: "like", dir: "two-way", note: "High/Medium/Low" },
      { name: "Impact", type: "Choice", mc: "impact", dir: "two-way", note: "High/Medium/Low" },
      { name: "Owner", type: "Person", mc: "owner", dir: "two-way" },
      { name: "Status", type: "Choice", mc: "status", dir: "two-way", note: "Open/Mitigating/Closed" },
      { name: "Mitigation", type: "Multi line of text", mc: "mit", dir: "two-way" },
    ],
  },
  {
    key: "documents", title: "Project Documents", kind: "library", entity: "File", icon: "❒",
    maps: "Files / folders", itemCount: 9, direction: "two-way",
    lastSync: "—", counts: { synced: 0, pending: 0, conflict: 0, error: 0 },
    folders: "/{Initiative}/PRD · /Evidence · /Deeds · /Reports  +  /Shared",
    columns: [
      { name: "Name", type: "File", mc: "name", dir: "two-way", required: true },
      { name: "Initiative", type: "Lookup → Roadmap", mc: "bucket", dir: "push", note: "folder metadata" },
      { name: "Document Type", type: "Choice", mc: "docType", dir: "two-way", note: "PRD/Evidence/Deed/Report/Spec/Export" },
      { name: "Modified", type: "Date and time", mc: "modified", dir: "two-way" },
      { name: "Modified By", type: "Person", mc: "modifiedBy", dir: "pull" },
    ],
  },
  {
    // EN-002 / Item 2 — push-only mirror of the repo registry/allow-list. MC is
    // authoritative; persistence + approvals live in the plx_mc DB.
    key: "reporegistry", title: "Repo Registry", kind: "list", entity: "Repo", icon: "⎇",
    maps: "Repo registry / allow-list", itemCount: 3, direction: "push",
    lastSync: "—", counts: { synced: 0, pending: 3, conflict: 0, error: 0 },
    columns: [
      { name: "Repo ID", type: "Single line of text", mc: "id", dir: "push", required: true, note: "indexed · unique key" },
      { name: "Title", type: "Single line of text", mc: "name", dir: "push", required: true },
      { name: "Owner", type: "Single line of text", mc: "owner", dir: "push" },
      { name: "Visibility", type: "Choice", mc: "visibility", dir: "push", note: "Public/Private" },
      { name: "Default Branch", type: "Single line of text", mc: "def", dir: "push" },
      { name: "Language", type: "Single line of text", mc: "lang", dir: "push" },
      { name: "Scope", type: "Multi line of text", mc: "scope", dir: "push" },
    ],
  },
];

// Conflict review queue (manual resolution — a human picks the winner).
// Demo conflicts purged 2026-06-11; the engine raises real ones (§5.1).
export const SP_CONFLICTS: SpConflict[] = [];

// Push errors (one-sided rejects). Demo error purged 2026-06-11; the engine
// queues real ones (§5.2).
export const SP_ERRORS: SpError[] = [];

// Per-list sync counts — derived from the SharePoint schema so the topbar
// pill, sidebar badge, and Sync console all read one source.
export const SYNC_REGISTERS: SyncRegister[] = SP_LISTS.map((l) => ({
  key: l.key,
  title: l.title,
  kind: l.kind,
  maps: l.maps,
  counts: l.counts,
}));
