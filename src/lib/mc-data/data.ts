// PROTOTYPE FIXTURE — illustrative mock data, faithful to docs/product/prototype/mc-data.js.
// Replaced at the sync-engine milestone by the API + SharePoint mirror
// (docs/product/SHAREPOINT_INTEGRATION.md). Entities are added per-screen as
// each screen is built; this file currently carries what the shell + Inbox use.

import type {
  Agent,
  AgentMode,
  Bucket,
  Cycle,
  FeedEvent,
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
  Task,
  Trace,
} from "./types";

// The signed-in human whose cockpit this is (the prototype's fixed viewer).
export const CURRENT_USER = "maya";

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

export const HUMANS: Record<string, Human> = {
  maya: { id: "maya", kind: "human", name: "Maya Aldosari", init: "MA", role: "Admin", online: true, email: "maya.aldosari@petralabx.com", dept: "Engineering" },
  tariq: { id: "tariq", kind: "human", name: "Tariq Del Mar", init: "TD", role: "Lead", online: true, email: "tariq.delmar@petralabx.com", dept: "Engineering" },
  lena: { id: "lena", kind: "human", name: "Lena Pulcini", init: "LP", role: "Contributor", online: false, email: "lena.pulcini@petralabx.com", dept: "Design Systems" },
  evan: { id: "evan", kind: "human", name: "Evan Brodsky", init: "EB", role: "Contributor", online: true, email: "evan.brodsky@petralabx.com", dept: "Platform" },
  noor: { id: "noor", kind: "human", name: "Noor Haddad", init: "NH", role: "Contributor", online: false, email: "noor.haddad@petralabx.com", dept: "Engineering" },
};

export const AGENTS: Record<string, Agent> = {
  vibes: { id: "vibes", kind: "agent", name: "Vibes", init: "VB", model: "Sonnet", team: "Dev", mode: "auto", online: true },
  atlas: { id: "atlas", kind: "agent", name: "Atlas", init: "AT", model: "Opus", team: "Research", mode: "approve", online: true },
  sentry: { id: "sentry", kind: "agent", name: "Sentry", init: "SY", model: "Sonnet", team: "QA", mode: "auto", online: true },
  scribe: { id: "scribe", kind: "agent", name: "Scribe", init: "SC", model: "Opus", team: "Ops", mode: "approve", online: true },
};

// Wider taskable directory (placeholder colleagues across both Petra domains).
export const DIRECTORY_EXTRA: Record<string, Human> = {
  priya: { id: "priya", kind: "human", name: "Priya Raman", init: "PR", role: "Data Scientist", dept: "Data", email: "priya.raman@petralabx.com", online: true },
  felix: { id: "felix", kind: "human", name: "Felix Gunnarsson", init: "FG", role: "Platform Engineer", dept: "Platform", email: "felix.gunnarsson@petralabx.com", online: false },
  dana: { id: "dana", kind: "human", name: "Dana Okafor", init: "DO", role: "Head of Operations", dept: "Operations", email: "dana.okafor@petrasoap.com", online: true },
  sam: { id: "sam", kind: "human", name: "Sam Whitfield", init: "SW", role: "Lead Formulator", dept: "Formulation", email: "sam.whitfield@petrasoap.com", online: true },
  ines: { id: "ines", kind: "human", name: "Inès Marchetti", init: "IM", role: "Supply Chain Mgr", dept: "Supply", email: "ines.marchetti@petrasoap.com", online: false },
  omar: { id: "omar", kind: "human", name: "Omar Haddad", init: "OH", role: "Brand & Marketing", dept: "Marketing", email: "omar.haddad@petrasoap.com", online: true },
  grace: { id: "grace", kind: "human", name: "Grace Liu", init: "GL", role: "Finance", dept: "Finance", email: "grace.liu@petrasoap.com", online: false },
  ruben: { id: "ruben", kind: "human", name: "Rubén Álvarez", init: "RA", role: "QA & Compliance", dept: "Compliance", email: "ruben.alvarez@petrasoap.com", online: true },
  // Placeholder identity (2026-06-11): bucket owner for the PLX Portal
  // go-live plan; full name/dept to be confirmed by the operator.
  vince: { id: "vince", kind: "human", name: "Vince", init: "V", role: "Owner", dept: "Petra Soap", email: "vince@petrasoap.com", online: true },
};

export const ACTORS: Record<string, Human | Agent> = {
  ...HUMANS,
  ...DIRECTORY_EXTRA,
  ...AGENTS,
};

export const MODE: Record<AgentMode, { label: string; short: string }> = {
  auto: { label: "Autonomous", short: "AUTO" },
  approve: { label: "Needs-approval", short: "APPROVE" },
};

export const PETRA_DOMAINS = ["petralabx.com", "petrasoap.com"];

export const REPOS: Record<string, Repo> = {
  "portal-web": { id: "portal-web", name: "plx-customer-portal", lang: "TypeScript · Next.js", openPRs: 4, openTasks: 9, def: "main" },
  "portal-api": { id: "portal-api", name: "plx-portal-api", lang: "TypeScript · Node", openPRs: 2, openTasks: 6, def: "main" },
  "mrp-core": { id: "mrp-core", name: "plx-mrp-core", lang: "Go", openPRs: 1, openTasks: 5, def: "main" },
  "design-sys": { id: "design-sys", name: "plx-design-system", lang: "CSS · TS", openPRs: 2, openTasks: 3, def: "main" },
  infra: { id: "infra", name: "plx-infra", lang: "Terraform", openPRs: 0, openTasks: 2, def: "main" },
};

export const BUCKETS: Bucket[] = [
  { id: "BKT-CPV2", name: "Customer Portal v2", owner: "maya", health: "risk", target: "Jul 18", started: "2026.04.02", desc: "Rebuild the brand-owner portal on the new design system.", repos: ["portal-web", "portal-api", "design-sys"], sync: { state: "synced", ts: "2026.06.09 · 08:14", sp: "Roadmap · row 12" }, prd: "PRD-CPV2" },
  { id: "BKT-MRP", name: "MRP Floor Sync", owner: "tariq", health: "track", target: "Aug 04", started: "2026.03.10", desc: "Real-time sync between the formulation floor and the MRP system of record.", repos: ["mrp-core", "portal-api"], sync: { state: "synced", ts: "2026.06.09 · 07:50", sp: "Roadmap · row 13" }, prd: "PRD-MRP" },
  { id: "BKT-DS", name: "Design System 2.0", owner: "lena", health: "track", target: "Jun 30", started: "2026.02.18", desc: "Token layer, components, and the PMark glyph system shared across surfaces.", repos: ["design-sys"], sync: { state: "pending", ts: "2026.06.09 · 09:02", sp: "Roadmap · row 14" }, prd: "PRD-DS" },
  { id: "BKT-AUTH", name: "Auth & SSO Hardening", owner: "evan", health: "off", target: "Jun 20", started: "2026.05.01", desc: "SAML/SSO, session hardening, and audit logging ahead of the security review.", repos: ["portal-api", "infra"], sync: { state: "conflict", ts: "2026.06.09 · 06:31", sp: "Roadmap · row 15" }, prd: "PRD-AUTH" },
  { id: "BKT-MOB", name: "Mobile Companion", owner: "maya", health: "track", target: "—", started: "2026.06.08", desc: "A read-mostly mobile companion for approvals and status — awaiting a PRD.", repos: [], sync: { state: "pending", ts: "—", sp: "Roadmap · row 16" }, prd: null, empty: true },
  // ─── PLX Portal go-live plan (seeded 2026-06-11) — one bucket per workstream.
  // All pending with "unprovisioned" refs until /sites/plx-mission-control is
  // provisioned and the engine points at it (no fabricated sync evidence).
  { id: "BKT-WMS", name: "WMS Integration", owner: "vince", health: "track", target: "Jun 15", started: "2026.06.11", desc: "Warehouse management system integration for the portal go-live.", repos: [], sync: { state: "pending", ts: "—", sp: "Roadmap · unprovisioned" }, prd: null },
  { id: "BKT-DAPI", name: "Decoupling API", owner: "vince", health: "track", target: "Jun 15", started: "2026.06.11", desc: "Decouple the portal from backend services — the Swagger-first contract is the deliverable.", repos: ["portal-api"], sync: { state: "pending", ts: "—", sp: "Roadmap · unprovisioned" }, prd: null },
  { id: "BKT-PROD", name: "Product Development", owner: "vince", health: "track", target: "Jun 29", started: "2026.06.11", desc: "Portal product development through the Jun 29 test gate; Account Management is stretch scope.", repos: [], sync: { state: "pending", ts: "—", sp: "Roadmap · unprovisioned" }, prd: null },
  { id: "BKT-FIN", name: "Finance", owner: "vince", health: "track", target: "Jul 20", started: "2026.06.11", desc: "Finance workstream — build Jun 29–Jul 13, test complete Jul 20.", repos: [], sync: { state: "pending", ts: "—", sp: "Roadmap · unprovisioned" }, prd: null },
  { id: "BKT-QMS", name: "QMS", owner: "vince", health: "track", target: "Jul 20", started: "2026.06.11", desc: "Quality management system — forms + DocuSign.", repos: [], sync: { state: "pending", ts: "—", sp: "Roadmap · unprovisioned" }, prd: null },
  { id: "BKT-SHOP", name: "Shopify → Business Central", owner: "vince", health: "track", target: "Aug 31", started: "2026.06.11", desc: "Shopify to Business Central migration — owned by Greg and Stephen (directory entries pending).", repos: [], sync: { state: "pending", ts: "—", sp: "Roadmap · unprovisioned" }, prd: null },
  { id: "BKT-INFRA", name: "Backend Infra", owner: "vince", health: "track", target: "Oct 01", started: "2026.06.11", desc: "Cross-cutting platform/infra work supporting go-live.", repos: ["infra"], sync: { state: "pending", ts: "—", sp: "Roadmap · unprovisioned" }, prd: null },
  { id: "BKT-UAT", name: "UAT", owner: "vince", health: "track", target: "Oct 01", started: "2026.06.11", desc: "Owns parallel testing and the go-live milestones.", repos: [], sync: { state: "pending", ts: "—", sp: "Roadmap · unprovisioned" }, prd: null },
];

export const BUCKET_IDX: Record<string, Bucket> = Object.fromEntries(
  BUCKETS.map((b) => [b.id, b])
);

export const TASKS: Task[] = [
  {
    id: "TASK-214", title: "Inline deed signing on the workbench", bucket: "BKT-CPV2", stage: "qa", priority: "high",
    assignee: "vibes", coassignees: ["tariq"], reporter: "maya", reqs: ["REQ-2"], repos: ["portal-web", "portal-api"], estimate: "L",
    labels: ["frontend", "deeds", "agent-built"],
    prs: [
      { repo: "portal-web", num: 88, status: "open", title: "feat: inline deed signature pad + sealed-record flip" },
      { repo: "portal-api", num: 42, status: "open", title: "feat: /deeds/sign endpoint + sealed PDF render" },
    ],
    due: "Jun 16", sync: { state: "synced", ts: "2026.06.09 · 09:12", sp: "ToDos · item 214" },
    subtasks: [
      { id: "214.1", t: "Signature pad component", done: true, who: "vibes" },
      { id: "214.2", t: "Seal + timestamp record", done: true, who: "vibes" },
      { id: "214.3", t: "Sealed-PDF render service", done: true, who: "vibes" },
      { id: "214.4", t: "Mirror sealed deed to SharePoint", done: false, who: "scribe" },
    ],
    evidence: {
      summary: "Inline signature pad seals the deed record with initials + UTC timestamp and renders a sealed PDF.",
      items: [
        { key: "summary", label: "Summary — what I did", done: true },
        { key: "reqs", label: "PRD requirement satisfied — REQ-2", done: true },
        { key: "shots", label: "Before / after screenshots", done: true },
        { key: "qa", label: "E2E QA results", done: true },
        { key: "prs", label: "PR / diff links (2 repos)", done: true },
        { key: "rollback", label: "Rollback plan", done: false },
      ],
      shots: [
        { label: "Before · unsigned deed card", cap: "portal-web · /workbench/deed" },
        { label: "After · sealed record", cap: "portal-web · sealed state" },
      ],
      qa: {
        pass: 11, fail: 0, total: 11, suite: "e2e/deeds.spec.ts", ran: "2026.06.09 · 09:08",
        tests: [
          { name: "renders signature pad on unsigned deed", status: "pass" },
          { name: "captures initials + UTC timestamp on sign", status: "pass" },
          { name: "flips card to SEALED within 1s", status: "pass" },
          { name: "generates sealed PDF artifact", status: "pass" },
          { name: "mirrors sealed deed to SharePoint", status: "pass" },
        ],
      },
      rollback: null,
    },
    activity: [{ age: "now", who: "vibes", what: "E2E suite passed — 11/11 on e2e/deeds.spec.ts", kind: "qa" }],
  },
  {
    id: "TASK-219", title: "Daily digest batching + opt-out", bucket: "BKT-CPV2", stage: "progress", priority: "medium",
    assignee: "vibes", coassignees: [], reporter: "maya", reqs: ["REQ-4"], repos: ["portal-api"], estimate: "M",
    labels: ["backend", "email", "agent-built"], prs: [],
    due: "Jun 24", sync: { state: "pending", ts: "2026.06.09 · 09:01", sp: "ToDos · item 219" }, subtasks: [],
    evidence: {
      summary: "Started the 24h event-collection window. Digest template and opt-out path still in progress.",
      items: [
        { key: "summary", label: "Summary — what I did", done: true },
        { key: "reqs", label: "PRD requirement satisfied — REQ-4", done: true },
        { key: "shots", label: "Before / after screenshots", done: false },
        { key: "qa", label: "E2E QA results", done: false },
        { key: "prs", label: "PR / diff links", done: false },
        { key: "rollback", label: "Rollback plan", done: false },
      ],
      shots: [],
      qa: {
        pass: 3, fail: 2, total: 5, suite: "e2e/digest.spec.ts", ran: "2026.06.09 · 08:40",
        tests: [
          { name: "collects events into 24h window", status: "pass" },
          { name: "renders digest template", status: "fail" },
          { name: "honors opt-out", status: "fail" },
        ],
      },
      rollback: null,
    },
    activity: [{ age: "20m", who: "vibes", what: "digest template render failing — 2 E2E red", kind: "qa" }],
  },
  {
    id: "TASK-201", title: "Approve formula version from workbench", bucket: "BKT-CPV2", stage: "verified", priority: "high",
    assignee: "lena", coassignees: ["vibes"], reporter: "maya", reqs: ["REQ-1"], repos: ["portal-web", "portal-api"], estimate: "L",
    labels: ["frontend", "approvals"],
    prs: [
      { repo: "portal-web", num: 71, status: "merged", title: "feat: approve formula from workbench" },
      { repo: "portal-api", num: 35, status: "merged", title: "feat: signed approval record" },
    ],
    due: "Jun 06", sync: { state: "synced", ts: "2026.06.07 · 17:20", sp: "ToDos · item 201" }, subtasks: [],
    evidence: {
      summary: "Formula approval writes a signed, timestamped record and flips the card to APPROVED within 1s. Verified in production behind the flag.",
      items: [
        { key: "summary", label: "Summary — what I did", done: true },
        { key: "reqs", label: "PRD requirement satisfied — REQ-1", done: true },
        { key: "shots", label: "Before / after screenshots", done: true },
        { key: "qa", label: "E2E QA results", done: true },
        { key: "prs", label: "PR / diff links (2 repos)", done: true },
        { key: "rollback", label: "Rollback plan", done: true },
      ],
      shots: [{ label: "Approved formula card", cap: "portal-web · approved" }],
      qa: { pass: 8, fail: 0, total: 8, suite: "e2e/approve.spec.ts", ran: "2026.06.06 · 14:02", tests: [] },
      rollback: "Flag approve_inline off; approval records are append-only.",
    },
    merge: { sha: "a91f3c2", on: "2026.06.06" },
    activity: [{ age: "3d", who: "tariq", what: "verified in production — REQ-1 satisfied", kind: "move" }],
  },
  {
    id: "TASK-188", title: "Live phase + next-milestone on workbench cards", bucket: "BKT-CPV2", stage: "review", priority: "medium",
    assignee: "evan", coassignees: ["sentry"], reporter: "tariq", reqs: ["REQ-3"], repos: ["portal-web", "mrp-core"], estimate: "M",
    labels: ["frontend", "realtime"], prs: [{ repo: "portal-web", num: 84, status: "open", title: "feat: live phase pill + milestone" }],
    due: "Jun 14", sync: { state: "synced", ts: "2026.06.09 · 08:55", sp: "ToDos · item 188" }, subtasks: [],
    activity: [{ age: "5h", who: "evan", what: "requested review from Tariq", kind: "move" }],
  },
  {
    id: "TASK-176", title: "Surfactant supplier lead-time risk spike", bucket: "BKT-MRP", stage: "progress", priority: "urgent",
    assignee: "atlas", coassignees: ["maya"], reporter: "maya", reqs: [], repos: ["mrp-core"], estimate: "S",
    labels: ["research", "risk"], blocked: true, blockedReason: "Awaiting supplier confirmation — 11wk lead time", prs: [],
    due: "Jun 12", sync: { state: "synced", ts: "2026.06.09 · 07:40", sp: "ToDos · item 176" }, subtasks: [],
    activity: [{ age: "6h", who: "atlas", what: "compiled lead-time comparison across 3 suppliers", kind: "qa" }],
  },
  {
    id: "TASK-160", title: "BOM-lock event → MRP core", bucket: "BKT-MRP", stage: "merged", priority: "high",
    assignee: "tariq", coassignees: [], reporter: "tariq", reqs: [], repos: ["mrp-core", "portal-api"], estimate: "M",
    labels: ["backend"], prs: [{ repo: "mrp-core", num: 19, status: "merged", title: "feat: bom-lock event bus" }],
    due: "Jun 09", sync: { state: "synced", ts: "2026.06.08 · 18:10", sp: "ToDos · item 160" }, subtasks: [],
    activity: [{ age: "1d", who: "tariq", what: "merged PR #19", kind: "pr" }],
  },
  {
    id: "TASK-152", title: "PMark glyph component + favicon set", bucket: "BKT-DS", stage: "verified", priority: "low",
    assignee: "lena", coassignees: [], reporter: "lena", reqs: [], repos: ["design-sys"], estimate: "S",
    labels: ["design-system"], prs: [{ repo: "design-sys", num: 12, status: "merged", title: "feat: PMark + favicons" }],
    due: "May 30", sync: { state: "synced", ts: "2026.06.01 · 11:00", sp: "ToDos · item 152" }, subtasks: [],
    activity: [{ age: "1w", who: "lena", what: "verified", kind: "move" }],
  },
  {
    id: "TASK-149", title: "Tokenize spacing + radius scale", bucket: "BKT-DS", stage: "planned", priority: "medium",
    assignee: "scribe", coassignees: ["lena"], reporter: "lena", reqs: [], repos: ["design-sys"], estimate: "M",
    labels: ["design-system"], prs: [],
    due: "Jun 26", sync: { state: "pending", ts: "2026.06.09 · 09:02", sp: "ToDos · item 149" }, subtasks: [],
    activity: [{ age: "1d", who: "scribe", what: "drafted token map from existing CSS", kind: "comment" }],
  },
  {
    id: "TASK-140", title: "SAML assertion validation", bucket: "BKT-AUTH", stage: "progress", priority: "urgent",
    assignee: "evan", coassignees: ["atlas"], reporter: "evan", reqs: [], repos: ["portal-api", "infra"], estimate: "L",
    labels: ["backend", "security"], prs: [{ repo: "portal-api", num: 40, status: "open", title: "feat: SAML assertion validation" }],
    due: "Jun 18",
    sync: { state: "conflict", ts: "2026.06.09 · 06:31", sp: "ToDos · item 140", wsVal: "In Progress · due Jun 18", spVal: "Blocked · due Jun 20" },
    subtasks: [], activity: [{ age: "3h", who: "evan", what: "SharePoint shows a conflicting status", kind: "sync" }],
  },
  {
    id: "TASK-138", title: "Session rotation + audit log", bucket: "BKT-AUTH", stage: "specced", priority: "high",
    assignee: "scribe", coassignees: ["evan"], reporter: "evan", reqs: [], repos: ["portal-api"], estimate: "M",
    labels: ["security"], prs: [],
    due: "Jun 22", sync: { state: "synced", ts: "2026.06.09 · 08:00", sp: "ToDos · item 138" }, subtasks: [],
    activity: [{ age: "1d", who: "scribe", what: "drafted PRD section · acceptance criteria", kind: "comment" }],
  },
  {
    id: "TASK-133", title: "Workbench empty + first-run states", bucket: "BKT-CPV2", stage: "backlog", priority: "low",
    assignee: null, coassignees: [], reporter: "maya", reqs: [], repos: ["portal-web"], estimate: "S",
    labels: ["frontend"], prs: [],
    due: "—", sync: { state: "pending", ts: "—", sp: "ToDos · item 133" }, subtasks: [], activity: [],
  },
  {
    id: "TASK-129", title: "Rate-limit /deeds/sign", bucket: "BKT-CPV2", stage: "approved", priority: "medium",
    assignee: "atlas", coassignees: [], reporter: "tariq", reqs: ["REQ-2"], repos: ["portal-api"], estimate: "S",
    labels: ["backend", "security"], prs: [],
    due: "Jun 20", sync: { state: "synced", ts: "2026.06.09 · 08:20", sp: "ToDos · item 129" }, subtasks: [],
    activity: [{ age: "2h", who: "atlas", what: "researched rate-limit thresholds", kind: "comment" }],
  },
  {
    id: "TASK-204", title: "Sealed-deed PDF mirror to SharePoint", bucket: "BKT-CPV2", stage: "planned", priority: "high",
    assignee: "scribe", coassignees: ["vibes"], reporter: "maya", reqs: ["REQ-2"], repos: ["portal-api"], estimate: "M",
    labels: ["ops", "sync"], prs: [],
    due: "Jun 17", sync: { state: "synced", ts: "2026.06.09 · 08:48", sp: "ToDos · item 204" }, subtasks: [],
    activity: [{ age: "1h", who: "scribe", what: "mapped deed → SharePoint document library", kind: "sync" }],
  },
  // ─── PLX Portal go-live plan (seeded 2026-06-11): 10-week schedule. All
  // pending with "unprovisioned" refs until /sites/plx-mission-control lands.
  // Greg/Stephen (Shopify → BC owners) are not in the directory yet, so those
  // tasks stay unassigned.
  {
    id: "TASK-221", title: "WMS integration", bucket: "BKT-WMS", stage: "planned", priority: "medium",
    assignee: null, coassignees: [], reporter: "vince", reqs: [], repos: [], estimate: "M",
    labels: ["go-live"], prs: [],
    due: "Jun 15", sync: { state: "pending", ts: "—", sp: "ToDos · unprovisioned" }, subtasks: [],
    activity: [{ age: "now", who: "vince", what: "seeded from the PLX Portal go-live plan — week of Jun 15", kind: "move" }],
  },
  {
    id: "TASK-222", title: "Decoupling API — Swagger-first contract", bucket: "BKT-DAPI", stage: "planned", priority: "medium",
    assignee: null, coassignees: [], reporter: "vince", reqs: [], repos: ["portal-api"], estimate: "M",
    labels: ["go-live", "api"], prs: [],
    due: "Jun 15", sync: { state: "pending", ts: "—", sp: "ToDos · unprovisioned" }, subtasks: [],
    activity: [{ age: "now", who: "vince", what: "seeded from the PLX Portal go-live plan — the Swagger contract is the deliverable", kind: "move" }],
  },
  {
    id: "TASK-223", title: "Product development", bucket: "BKT-PROD", stage: "planned", priority: "medium",
    assignee: null, coassignees: [], reporter: "vince", reqs: [], repos: [], estimate: "M",
    labels: ["go-live"], prs: [],
    due: "Jun 15", sync: { state: "pending", ts: "—", sp: "ToDos · unprovisioned" }, subtasks: [],
    activity: [{ age: "now", who: "vince", what: "seeded from the PLX Portal go-live plan — week of Jun 15", kind: "move" }],
  },
  {
    id: "TASK-224", title: "Product development (cont.)", bucket: "BKT-PROD", stage: "planned", priority: "medium",
    assignee: null, coassignees: [], reporter: "vince", reqs: [], repos: [], estimate: "M",
    labels: ["go-live"], prs: [],
    due: "Jun 22", sync: { state: "pending", ts: "—", sp: "ToDos · unprovisioned" }, subtasks: [],
    activity: [{ age: "now", who: "vince", what: "seeded from the PLX Portal go-live plan — week of Jun 22", kind: "move" }],
  },
  {
    id: "TASK-225", title: "Stretch: Account Management", bucket: "BKT-PROD", stage: "backlog", priority: "low",
    description: "Stretch scope — only pulled if Product Development is ahead of schedule.",
    assignee: null, coassignees: [], reporter: "vince", reqs: [], repos: [], estimate: "M",
    labels: ["go-live", "stretch"], prs: [],
    due: "Jun 22", sync: { state: "pending", ts: "—", sp: "ToDos · unprovisioned" }, subtasks: [],
    activity: [{ age: "now", who: "vince", what: "seeded as stretch scope — pulled only if ahead", kind: "move" }],
  },
  {
    id: "TASK-226", title: "Build Finance", bucket: "BKT-FIN", stage: "planned", priority: "medium",
    assignee: null, coassignees: [], reporter: "vince", reqs: [], repos: [], estimate: "M",
    labels: ["go-live", "finance"], prs: [],
    due: "Jun 29", sync: { state: "pending", ts: "—", sp: "ToDos · unprovisioned" }, subtasks: [],
    activity: [{ age: "now", who: "vince", what: "seeded from the PLX Portal go-live plan — build starts week of Jun 29", kind: "move" }],
  },
  {
    id: "TASK-227", title: "Test product development", bucket: "BKT-PROD", stage: "qa", priority: "high",
    assignee: null, coassignees: [], reporter: "vince", reqs: [], repos: [], estimate: "M",
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
    assignee: null, coassignees: [], reporter: "vince", reqs: [], repos: [], estimate: "M",
    labels: ["go-live", "finance"], prs: [],
    due: "Jul 06", sync: { state: "pending", ts: "—", sp: "ToDos · unprovisioned" }, subtasks: [],
    activity: [{ age: "now", who: "vince", what: "seeded from the PLX Portal go-live plan — week of Jul 6", kind: "move" }],
  },
  {
    id: "TASK-229", title: "Build Finance (cont.)", bucket: "BKT-FIN", stage: "planned", priority: "medium",
    assignee: null, coassignees: [], reporter: "vince", reqs: [], repos: [], estimate: "M",
    labels: ["go-live", "finance"], prs: [],
    due: "Jul 13", sync: { state: "pending", ts: "—", sp: "ToDos · unprovisioned" }, subtasks: [],
    activity: [{ age: "now", who: "vince", what: "seeded from the PLX Portal go-live plan — week of Jul 13", kind: "move" }],
  },
  {
    id: "TASK-230", title: "Test Finance", bucket: "BKT-FIN", stage: "qa", priority: "high",
    assignee: null, coassignees: [], reporter: "vince", reqs: [], repos: [], estimate: "M",
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
    assignee: null, coassignees: [], reporter: "vince", reqs: [], repos: [], estimate: "M",
    labels: ["go-live", "qms"], prs: [],
    due: "Jul 20", sync: { state: "pending", ts: "—", sp: "ToDos · unprovisioned" }, subtasks: [],
    activity: [{ age: "now", who: "vince", what: "seeded from the PLX Portal go-live plan — week of Jul 20", kind: "move" }],
  },
  {
    id: "TASK-232", title: "Shopify → Business Central migration", bucket: "BKT-SHOP", stage: "planned", priority: "medium",
    description: "Owned by Greg and Stephen — unassigned until their directory entries exist.",
    assignee: null, coassignees: [], reporter: "vince", reqs: [], repos: [], estimate: "L",
    labels: ["go-live", "migration"], prs: [],
    due: "Aug 31", sync: { state: "pending", ts: "—", sp: "ToDos · unprovisioned" }, subtasks: [],
    activity: [{ age: "now", who: "vince", what: "seeded from the PLX Portal go-live plan — August, owners Greg & Stephen", kind: "move" }],
  },
  {
    id: "TASK-233", title: "Unstructured to-dos — needs breakdown", bucket: "BKT-SHOP", stage: "backlog", priority: "low",
    description: "Single placeholder for the August unstructured items; break down before the build window.",
    assignee: null, coassignees: [], reporter: "vince", reqs: [], repos: [], estimate: "M",
    labels: ["go-live", "needs-breakdown"], prs: [],
    due: "Aug 31", sync: { state: "pending", ts: "—", sp: "ToDos · unprovisioned" }, subtasks: [],
    activity: [{ age: "now", who: "vince", what: "seeded as a placeholder — needs breakdown", kind: "move" }],
  },
  {
    id: "TASK-234", title: "Parallel system testing — execution", bucket: "BKT-UAT", stage: "planned", priority: "high",
    assignee: null, coassignees: [], reporter: "vince", reqs: [], repos: [], estimate: "L",
    labels: ["go-live", "testing", "uat"], prs: [],
    due: "Sep 01", sync: { state: "pending", ts: "—", sp: "ToDos · unprovisioned" }, subtasks: [],
    activity: [{ age: "now", who: "vince", what: "seeded from the PLX Portal go-live plan — parallel testing from Sept 1", kind: "move" }],
  },
  {
    id: "TASK-235", title: "Define go-live infra checklist — environments, cutover, rollback", bucket: "BKT-INFRA", stage: "backlog", priority: "medium",
    assignee: null, coassignees: [], reporter: "vince", reqs: [], repos: ["infra"], estimate: "M",
    labels: ["go-live", "infra"], prs: [],
    due: "Oct 01", sync: { state: "pending", ts: "—", sp: "ToDos · unprovisioned" }, subtasks: [],
    activity: [{ age: "now", who: "vince", what: "seeded as the Backend Infra placeholder — concrete items to follow", kind: "move" }],
  },
];

export const TASK_IDX: Record<string, Task> = Object.fromEntries(
  TASKS.map((t) => [t.id, t])
);

export const INBOX: InboxNotification[] = [
  { id: "n1", kind: "approval", task: "TASK-214", actor: "vibes", text: "Vibes submitted TASK-214 for review — evidence complete", age: "now", unread: true },
  { id: "n2", kind: "conflict", task: "TASK-140", actor: "scribe", text: "SharePoint sync conflict on TASK-140 status", age: "3h", unread: true },
  { id: "n3", kind: "review", task: "TASK-188", actor: "evan", text: "Evan requested your review on PR #84", age: "5h", unread: true },
  { id: "n4", kind: "mention", task: "TASK-214", actor: "tariq", text: "Tariq mentioned you: confirm sealed PDF embeds UTC offset", age: "1h", unread: false },
  { id: "n5", kind: "assigned", task: "TASK-129", actor: "tariq", text: "Tariq assigned you TASK-129 — Rate-limit /deeds/sign", age: "2h", unread: false },
];

// ─── PRDs (Problem · Requirements · Acceptance · Non-goals · Rollback) ───────
export const PRDS: Record<string, Prd> = {
  "PRD-CPV2": {
    id: "PRD-CPV2", bucket: "BKT-CPV2", title: "Customer Portal v2",
    status: "approved", approvedBy: "maya", drafted: "scribe",
    problem: "Brand owners wait days to approve formulas and sign deeds because the portal round-trips through email and PDF. v2 makes every decision happen on the page, with a live project workbench.",
    reqs: [
      { id: "REQ-1", text: "Brand owners can approve a formula version from the workbench without leaving the page.", crit: "Approval writes a signed, timestamped record; the formula card flips to APPROVED within 1s." },
      { id: "REQ-2", text: "Deeds of formulation are signable inline, producing an auditable sealed record.", crit: "Signature captures initials + UTC timestamp; a sealed PDF is generated and mirrored to SharePoint." },
      { id: "REQ-3", text: "The workbench shows live project phase and next milestone for every active project.", crit: "Phase reflects MRP state within 5s; milestone due-date matches the Milestone Register." },
      { id: "REQ-4", text: "Customers receive a single daily digest instead of per-event email.", crit: "Digest batches all events in a 24h window; opt-out honored; zero per-event email sent." },
    ],
    nonGoals: ["No net-new payment flows in v2.", "No public (logged-out) project pages.", "Mobile is deferred to the Mobile Companion initiative."],
    rollback: "Feature-flag portal_v2 off restores v1 routes; data writes are additive (no destructive migrations), so revert is a flag flip plus cache purge.",
  },
};

// ─── Cycles + Milestones (timeline overlays; day cols in a 30-day June grid) ─
export const CYCLES: Cycle[] = [
  { id: "C-23", name: "Cycle 23", from: 1, to: 14 },
  { id: "C-24", name: "Cycle 24", from: 15, to: 28 },
];

export const MILESTONES: Milestone[] = [
  { id: "M-1", bucket: "BKT-CPV2", name: "Deeds signable inline", col: 8, state: "now", sp: "Milestone Register · 1" },
  { id: "M-2", bucket: "BKT-CPV2", name: "v2 beta to 5 customers", col: 22, state: "upcoming", sp: "Milestone Register · 2" },
  { id: "M-3", bucket: "BKT-MRP", name: "Floor sync live", col: 18, state: "upcoming", sp: "Milestone Register · 3" },
  { id: "M-4", bucket: "BKT-DS", name: "DS 2.0 cut", col: 12, state: "now", sp: "Milestone Register · 4" },
  { id: "M-5", bucket: "BKT-AUTH", name: "Security review", col: 10, state: "risk", sp: "Milestone Register · 5" },
  // PLX Portal go-live plan (2026-06-11). col is days from Jun 1 — these fall
  // beyond the 30-day June timeline grid, so the timeline pins them at the
  // grid's right edge (pctOfDay clamps); milestone lists show them in full.
  { id: "M-6", bucket: "BKT-UAT", name: "Parallel System Testing", col: 93, state: "upcoming", sp: "Milestone Register · unprovisioned" },
  { id: "M-7", bucket: "BKT-UAT", name: "Production Go-Live", col: 123, state: "upcoming", sp: "Milestone Register · unprovisioned" },
];

// ─── Risks (roll up to buckets, mirror to Risk Register) ─────────────────────
export const RISKS: Risk[] = [
  { id: "RISK-7", bucket: "BKT-MRP", title: "Surfactant supplier 11-week lead time", like: "High", impact: "High", owner: "maya", status: "open", mit: "Qualify a second supplier; hold safety stock.", sync: { state: "synced", ts: "2026.06.09 · 07:42", sp: "Risk Register · 7" } },
  { id: "RISK-4", bucket: "BKT-AUTH", title: "SSO provider IdP metadata drift", like: "Medium", impact: "High", owner: "evan", status: "open", mit: "Pin IdP metadata; alert on cert rotation.", sync: { state: "error", ts: "2026.06.09 · 06:31", sp: "Risk Register · 4", reason: "SharePoint column 'Likelihood' rejected value" } },
  { id: "RISK-2", bucket: "BKT-CPV2", title: "Sealed PDF UTC offset ambiguity", like: "Low", impact: "Medium", owner: "tariq", status: "mitigating", mit: "Embed explicit UTC offset; add E2E assertion.", sync: { state: "synced", ts: "2026.06.09 · 09:10", sp: "Risk Register · 2" } },
  { id: "RISK-1", bucket: "BKT-CPV2", title: "Digest opt-out not honored on legacy accounts", like: "Medium", impact: "Medium", owner: "maya", status: "open", mit: "Backfill opt-out flags before kill-switch.", sync: { state: "synced", ts: "2026.06.09 · 09:01", sp: "Risk Register · 1" } },
  // PLX Portal go-live plan (2026-06-11).
  { id: "RISK-8", bucket: "BKT-PROD", title: "Account Management slips out of scope if Product Development runs long", like: "Medium", impact: "Medium", owner: "vince", status: "open", mit: "Stretch scope is only pulled if ahead; review at the Jun 29 test gate.", sync: { state: "pending", ts: "—", sp: "Risk Register · unprovisioned" } },
  { id: "RISK-9", bucket: "BKT-SHOP", title: "Shopify → BC migration owned outside the core team, landing directly before parallel testing", like: "Medium", impact: "High", owner: "vince", status: "open", mit: "Confirm Greg/Stephen ownership and a mid-August checkpoint before Sept 1 parallel testing.", sync: { state: "pending", ts: "—", sp: "Risk Register · unprovisioned" } },
  { id: "RISK-10", bucket: "BKT-UAT", title: "SharePoint provisioning not complete before the plan needs to sync", like: "Medium", impact: "High", owner: "vince", status: "open", mit: "Track site provisioning; keep sync sweeps off until /sites/plx-mission-control is live and the engine points at it.", sync: { state: "pending", ts: "—", sp: "Risk Register · unprovisioned" } },
];

// ─── Agent activity feed ─────────────────────────────────────────────────────
export const AGENT_FEED: FeedEvent[] = [
  { age: "now", actor: "vibes", task: "TASK-214", kind: "run", text: "running E2E QA on", chip: "11/11 passed", live: true, shots: ["before · unsigned deed", "after · sealed record"] },
  { age: "2m", actor: "sentry", task: "TASK-188", kind: "run", text: "executing regression suite on", chip: "running · 6/9", live: true },
  { age: "8m", actor: "tariq", task: "TASK-214", kind: "comment", text: "left a note on", chip: "confirm UTC offset", human: true },
  { age: "14m", actor: "vibes", task: "TASK-214", kind: "pr", text: "opened PR #42 + #88 across 2 repos for", chip: "2 PRs open" },
  { age: "26m", actor: "atlas", task: "TASK-176", kind: "block", text: "flagged a blocker on", chip: "supplier lead time" },
  { age: "40m", actor: "scribe", task: "TASK-138", kind: "comment", text: "drafted PRD acceptance criteria for", chip: "PRD draft" },
  { age: "1h", actor: "tariq", task: "TASK-188", kind: "review", text: "requested changes on PR #84 for", chip: "changes requested", human: true },
  { age: "2h", actor: "vibes", task: "TASK-219", kind: "run", text: "QA red — digest template failing on", chip: "2 failed", warn: true },
  { age: "3h", actor: "scribe", task: "TASK-204", kind: "sync", text: "mapped deed → SharePoint library for", chip: "sync mapped" },
  { age: "4h", actor: "maya", task: "TASK-201", kind: "approve", text: "approved + verified", chip: "REQ-1 satisfied", human: true },
];

// ─── Traceability matrix (REQ → Task → PR → Evidence → Test → Merge) ─────────
export const TRACE: Trace = {
  bucket: "BKT-CPV2",
  rows: [
    { req: "REQ-1", tasks: ["TASK-201"], prs: ["portal-web #71", "portal-api #35"], evidence: "complete", test: "8/8", merge: "a91f3c2", status: "satisfied" },
    { req: "REQ-2", tasks: ["TASK-214", "TASK-129", "TASK-204"], prs: ["portal-web #88", "portal-api #42"], evidence: "complete", test: "11/11", merge: "—", status: "in-review" },
    { req: "REQ-3", tasks: ["TASK-188"], prs: ["portal-web #84"], evidence: "partial", test: "in review", merge: "—", status: "in-progress" },
    { req: "REQ-4", tasks: ["TASK-219"], prs: [], evidence: "incomplete", test: "3/5", merge: "—", status: "gap" },
  ],
};

// ─── Project Documents library (flat list with parent pointers) ──────────────
export const FILES: FileEntry[] = [
  { id: "fo-cpv2", name: "Customer Portal v2", kind: "folder", parent: null, bucket: "BKT-CPV2" },
  { id: "fo-cpv2-prd", name: "PRD", kind: "folder", parent: "fo-cpv2", bucket: "BKT-CPV2" },
  { id: "fo-cpv2-ev", name: "Evidence", kind: "folder", parent: "fo-cpv2", bucket: "BKT-CPV2" },
  { id: "fo-cpv2-deeds", name: "Deeds", kind: "folder", parent: "fo-cpv2", bucket: "BKT-CPV2" },
  { id: "fo-cpv2-rep", name: "Reports", kind: "folder", parent: "fo-cpv2", bucket: "BKT-CPV2" },
  { id: "fi-prd-cpv2", name: "PRD-CPV2 — Customer Portal v2.docx", kind: "doc", parent: "fo-cpv2-prd", bucket: "BKT-CPV2", docType: "PRD", modified: "2026.06.08 · 14:20", modifiedBy: "scribe", size: "48 KB", sync: { state: "synced", ts: "2026.06.08 · 14:21", sp: "Project Documents" } },
  { id: "fi-deed-214", name: "Sealed deed — TASK-214.pdf", kind: "pdf", parent: "fo-cpv2-deeds", bucket: "BKT-CPV2", docType: "Deed", modified: "2026.06.09 · 09:08", modifiedBy: "vibes", size: "212 KB", sync: { state: "pending", ts: "2026.06.09 · 09:09", sp: "Project Documents" } },
  { id: "fi-ev-214", name: "TASK-214 — E2E evidence bundle.zip", kind: "zip", parent: "fo-cpv2-ev", bucket: "BKT-CPV2", docType: "Evidence", modified: "2026.06.09 · 09:08", modifiedBy: "vibes", size: "1.4 MB", sync: { state: "synced", ts: "2026.06.09 · 09:09", sp: "Project Documents" } },
  { id: "fi-shots-214", name: "Before-after — sealed record.png", kind: "img", parent: "fo-cpv2-ev", bucket: "BKT-CPV2", docType: "Evidence", modified: "2026.06.09 · 09:04", modifiedBy: "vibes", size: "640 KB", sync: { state: "synced", ts: "2026.06.09 · 09:05", sp: "Project Documents" } },
  { id: "fi-rep-cpv2", name: "Portal v2 — weekly status.xlsx", kind: "sheet", parent: "fo-cpv2-rep", bucket: "BKT-CPV2", docType: "Report", modified: "2026.06.09 · 08:00", modifiedBy: "maya", size: "33 KB", sync: { state: "synced", ts: "2026.06.09 · 08:01", sp: "Project Documents" } },
  { id: "fo-mrp", name: "MRP Floor Sync", kind: "folder", parent: null, bucket: "BKT-MRP" },
  { id: "fo-mrp-prd", name: "PRD", kind: "folder", parent: "fo-mrp", bucket: "BKT-MRP" },
  { id: "fo-mrp-rep", name: "Reports", kind: "folder", parent: "fo-mrp", bucket: "BKT-MRP" },
  { id: "fi-prd-mrp", name: "PRD-MRP — Floor Sync.docx", kind: "doc", parent: "fo-mrp-prd", bucket: "BKT-MRP", docType: "PRD", modified: "2026.06.05 · 11:10", modifiedBy: "scribe", size: "41 KB", sync: { state: "synced", ts: "2026.06.05 · 11:11", sp: "Project Documents" } },
  { id: "fi-rep-mrp", name: "Supplier lead-time comparison.xlsx", kind: "sheet", parent: "fo-mrp-rep", bucket: "BKT-MRP", docType: "Report", modified: "2026.06.09 · 07:40", modifiedBy: "atlas", size: "28 KB", sync: { state: "synced", ts: "2026.06.09 · 07:41", sp: "Project Documents" } },
  { id: "fo-auth", name: "Auth & SSO Hardening", kind: "folder", parent: null, bucket: "BKT-AUTH" },
  { id: "fo-auth-rep", name: "Reports", kind: "folder", parent: "fo-auth", bucket: "BKT-AUTH" },
  { id: "fi-runbook-auth", name: "Shadow cutover runbook.pdf", kind: "pdf", parent: "fo-auth-rep", bucket: "BKT-AUTH", docType: "Report", modified: "2026.06.08 · 16:30", modifiedBy: "evan", size: "180 KB", sync: { state: "synced", ts: "2026.06.08 · 16:31", sp: "Project Documents" } },
  { id: "fo-shared", name: "Shared", kind: "folder", parent: null },
  { id: "fi-brand", name: "PLX brand & glyph kit.pdf", kind: "pdf", parent: "fo-shared", docType: "Spec", modified: "2026.06.01 · 11:00", modifiedBy: "lena", size: "2.1 MB", sync: { state: "synced", ts: "2026.06.01 · 11:01", sp: "Project Documents" } },
  { id: "fi-trace", name: "Traceability export — PRD-CPV2.xlsx", kind: "sheet", parent: "fo-shared", docType: "Export", modified: "2026.06.09 · 09:14", modifiedBy: "maya", size: "52 KB", sync: { state: "synced", ts: "2026.06.09 · 09:15", sp: "Project Documents" } },
];

// ─── Canonical SharePoint schema (system of record) ──────────────────────────
export const SP_SITE: SpSite = {
  name: "PLX Mission Control",
  host: "petrasoap.sharepoint.com",
  path: "/sites/plx-mission-control",
  tz: "UTC",
  connected: true,
};
export const SP_LAST_SWEEP = "2026.06.09 · 09:12";
export const SP_CADENCE = "every 5 min + on change (webhook)";

export const SP_LISTS: SpListDef[] = [
  {
    key: "todos", title: "ToDos", kind: "list", entity: "Task", icon: "▦",
    maps: "Tasks", itemCount: 14, direction: "two-way",
    lastSync: "2026.06.09 · 09:12", counts: { synced: 12, pending: 1, conflict: 1, error: 0 },
    columns: [
      { name: "Title", type: "Single line of text", mc: "title", dir: "two-way", required: true },
      { name: "Task ID", type: "Single line of text", mc: "id", dir: "pull", required: true, note: "indexed · unique key" },
      { name: "Status", type: "Choice", mc: "stage", dir: "two-way", note: "Backlog→Verified (9)" },
      { name: "Assigned To", type: "Person", mc: "assignee", dir: "two-way" },
      { name: "Reporter", type: "Person", mc: "reporter", dir: "push" },
      { name: "Priority", type: "Choice", mc: "priority", dir: "two-way", note: "Urgent/High/Medium/Low" },
      { name: "Due Date", type: "Date and time", mc: "due", dir: "two-way" },
      { name: "Initiative", type: "Lookup → Roadmap", mc: "bucket", dir: "two-way" },
      { name: "PRD Requirements", type: "Multi line of text", mc: "reqs", dir: "push" },
      { name: "Estimate", type: "Choice", mc: "estimate", dir: "push", note: "S/M/L" },
      { name: "Repos", type: "Multi line of text", mc: "repos", dir: "push" },
      { name: "Evidence Complete", type: "Yes/No", mc: "evidence", dir: "push" },
      { name: "Description", type: "Multi line of text", mc: "description", dir: "two-way" },
    ],
  },
  {
    key: "roadmap", title: "Roadmap", kind: "list", entity: "Initiative", icon: "◷",
    maps: "Buckets / Initiatives + Gantt", itemCount: 5, direction: "two-way",
    lastSync: "2026.06.09 · 08:14", counts: { synced: 5, pending: 0, conflict: 0, error: 0 },
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
    maps: "Milestones", itemCount: 5, direction: "two-way",
    lastSync: "2026.06.09 · 08:55", counts: { synced: 5, pending: 0, conflict: 0, error: 0 },
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
    maps: "Risks", itemCount: 4, direction: "two-way",
    lastSync: "2026.06.09 · 09:10", counts: { synced: 3, pending: 0, conflict: 1, error: 1 },
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
    maps: "Files / folders", itemCount: 12, direction: "two-way",
    lastSync: "2026.06.09 · 08:48", counts: { synced: 11, pending: 1, conflict: 0, error: 0 },
    folders: "/{Initiative}/PRD · /Evidence · /Deeds · /Reports  +  /Shared",
    columns: [
      { name: "Name", type: "File", mc: "name", dir: "two-way", required: true },
      { name: "Initiative", type: "Lookup → Roadmap", mc: "bucket", dir: "push", note: "folder metadata" },
      { name: "Document Type", type: "Choice", mc: "docType", dir: "two-way", note: "PRD/Evidence/Deed/Report/Spec/Export" },
      { name: "Modified", type: "Date and time", mc: "modified", dir: "two-way" },
      { name: "Modified By", type: "Person", mc: "modifiedBy", dir: "pull" },
    ],
  },
];

// Conflict review queue (manual resolution — a human picks the winner).
export const SP_CONFLICTS: SpConflict[] = [
  { id: "cf-140", list: "todos", entity: "Task", entityId: "TASK-140", field: "Status", mcVal: "In Progress · due Jun 18", spVal: "Blocked · due Jun 20", detected: "06:31", by: "dana", note: "Edited in SharePoint while MC also changed it." },
  { id: "cf-risk1", list: "risks", entity: "Risk", entityId: "RISK-1", field: "Likelihood", mcVal: "Medium", spVal: "High", detected: "08:40", by: "ruben", note: "Compliance raised likelihood in the Risk Register." },
];

// A push error that needs a value fix (not a two-sided conflict).
export const SP_ERRORS: SpError[] = [
  { id: "er-risk4", list: "risks", entity: "Risk", entityId: "RISK-4", field: "Likelihood", value: "Medium", reason: "SharePoint Choice column rejects \u201cMedium\u201d — expects High / Med / Low." },
];

// Per-list sync counts — derived from the SharePoint schema so the topbar
// pill, sidebar badge, and Sync console all read one source.
export const SYNC_REGISTERS: SyncRegister[] = SP_LISTS.map((l) => ({
  key: l.key,
  title: l.title,
  kind: l.kind,
  maps: l.maps,
  counts: l.counts,
}));
