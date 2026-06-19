// Server-side state surface for the API routes: a full snapshot for store
// hydration, plus MC-side mutations (create/patch task). Mutations only mark
// the mirror pending/dirty — the engine's sweep is the single outbound code
// path (spec §6 "pending until the first successful write, then synced").

import { ApiError } from "@/lib/api/route";
import { ACTORS, REPO_ORG, SP_LISTS } from "@/lib/mc-data/data";
import { assignmentViolation, isAgentId, stageAdvanceViolation } from "@/lib/mc-data/policy";
import { disallowedRepos, isApprover, repoFromRequest, repoIdFromName } from "@/lib/mc-data/repos";
import type {
  AuditRow,
  FileEntry,
  Repo,
  RepoRequest,
  Risk,
  SpConflict,
  SpError,
  Task,
} from "@/lib/mc-data/types";
import { ensureSeeded } from "./engine";
import { validateRepoInOrg } from "./github";
import type { EntityData } from "./mapping";
import * as registry from "./registry";
import * as repo from "./repo";

export interface StateSnapshot {
  tasks: Task[];
  risks: Risk[];
  files: FileEntry[];
  conflicts: SpConflict[];
  errors: SpError[];
  audit: AuditRow[];
  counts: Record<string, repo.ListCounts>;
  lastSweep: string;
  // EN-005 / WS-5: the persisted repo registry (= allow-list) and request queue.
  // The client adopts these on hydrate so it reads the SAME allow-list the server
  // enforces in createTask (kills the static-REPOS drift).
  repos: Record<string, Repo>;
  repoRequests: RepoRequest[];
}

export async function snapshot(): Promise<StateSnapshot> {
  await ensureSeeded();
  await registry.ensureRegistrySeeded();
  const [tasks, risks, files, conflicts, errors, audit, counts, repos, repoRequests] = await Promise.all([
    repo.getEntities("task"),
    repo.getEntities("risk"),
    repo.getEntities("file"),
    repo.openConflicts(),
    repo.openErrors(),
    repo.auditRows(),
    repo.countsByList(),
    registry.getRegistry(),
    registry.getRequests(),
  ]);
  return {
    tasks: tasks.map((r) => r.data as unknown as Task),
    risks: risks.map((r) => r.data as unknown as Risk),
    files: files.map((r) => r.data as unknown as FileEntry),
    conflicts,
    errors,
    audit,
    counts,
    // Lists not yet mirrored (roadmap, milestones) keep their fixture counts;
    // mirrored lists report live counts. The store merges via SP_LISTS keys.
    lastSweep: audit.find((a) => a.body.startsWith("Sweep completed"))?.ts ?? SP_LISTS[0].lastSync,
    repos,
    repoRequests,
  };
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  bucket: string;
  stage?: Task["stage"];
  priority?: Task["priority"];
  assignee?: string | null;
  coassignees?: string[];
  reporter: string;
  accountableOwner?: string | null;
  humanOnly?: boolean;
  reqs?: string[];
  repos?: string[];
  estimate?: Task["estimate"];
  labels?: string[];
  due?: string;
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  await ensureSeeded();
  await registry.ensureRegistrySeeded();
  // Allow-list enforcement (EN-002/005): a task may only attach registry repos.
  // The allow-list is the PERSISTED runtime registry — the same one the client
  // uses (allRepos()) — NOT the static REPOS fixture, so a repo approved at
  // runtime is accepted here too (EN-005 obs. #7: kills the server/client drift).
  const offlist = disallowedRepos(input.repos ?? [], await registry.getRegistry());
  if (offlist.length > 0) {
    throw new ApiError(
      "repo_not_allowed",
      `These repos are not in the registry: ${offlist.join(", ")}. Request and get them approved first.`,
      422
    );
  }
  const rows = await repo.getEntities("task");
  const max = Math.max(0, ...rows.map((r) => parseInt((/(\d+)/.exec(r.id) ?? [])[1] ?? "0", 10)));
  const id = `TASK-${max + 1}`;
  // A human-only task can never carry an agent executor (EN-003 policy).
  const assignee =
    input.humanOnly && isAgentId(input.assignee ?? null) ? null : (input.assignee ?? null);
  const task: Task = {
    id,
    title: input.title.trim(),
    description: (input.description ?? "").trim(),
    bucket: input.bucket,
    stage: input.stage ?? "backlog",
    priority: input.priority ?? "medium",
    assignee,
    coassignees: input.coassignees ?? [],
    reporter: input.reporter,
    accountableOwner: input.accountableOwner ?? null,
    humanOnly: input.humanOnly,
    reqs: input.reqs ?? [],
    repos: input.repos ?? [],
    estimate: input.estimate ?? "M",
    labels: input.labels ?? [],
    prs: [],
    due: input.due || "—",
    sync: { state: "pending", ts: repo.stamp(), sp: `ToDos · item ${max + 1}` },
    subtasks: [],
    activity: [
      { age: "now", who: input.reporter, kind: "move", what: "created the task" },
    ],
    userCreated: true,
  };
  await repo.insertEntity("task", id, task as unknown as EntityData, "pending", []);
  await repo.appendAudit(input.reporter, `Created ${id} — pending first push to ToDos.`, "pending");
  return task;
}

export interface PatchTaskInput {
  assignee?: string | null; // already wired — copy-only fix in PR-0
  title?: string;
  stage?: Task["stage"];
  priority?: Task["priority"];
  due?: string;
  description?: string;
  bucket?: string; // NEW — DB-only (see §4)
  labels?: string[]; // NEW — DB-only
  coassignees?: string[]; // NEW — DB-only
  subtasks?: Task["subtasks"]; // NEW — DB-only (Subtask[], enriched in WS-3)
  comments?: Task["comments"]; // EN-001 / WS-3 — DB-only, app-only (never pushed)
  accountableOwner?: string | null; // EN-003 — DB-only (person column, deferred mirror)
  humanOnly?: boolean; // EN-003 — DB-only assignment policy
  repos?: string[]; // EN-005 — DB-only, allow-list enforced; re-push deferred to EN-006
  agentRunApproved?: boolean; // EN-005 — DB-only operator approval of an approve-mode agent run
}

// Persistence tiers (Cycle 1):
//   SP  (pushed): title, stage, priority, due, description  ── below
//   DB  (jsonb-only, NOT pushed):
//       newly-added this cycle: bucket, labels, coassignees, subtasks
//       already-wired (copy-only fix, not a new allow-list entry): assignee
//       bucket/labels promote to SP in Cycle 2 once the Initiative lookup-id
//       resolution and a Labels SP column exist (see mapping.ts:6-8).
const PUSHED_FIELDS = ["title", "stage", "priority", "due", "description"];

export async function patchTask(id: string, patch: PatchTaskInput, actor: string): Promise<Task | null> {
  await ensureSeeded();
  const row = await repo.getEntity("task", id);
  if (!row) return null;

  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return row.data as unknown as Task;

  // Accountability policy (EN-003), enforced server-side in lockstep with the
  // client store: reject an agent executor on a human-only task, and reject a
  // stage advance that orphans the task past `planned` (or marks it done with
  // incomplete evidence). The effective task folds the incoming patch so a
  // patch that sets both owner and stage is evaluated against the new owner.
  const current = row.data as unknown as Task;
  const effective = { ...current, ...patch } as Task;
  if ("assignee" in patch) {
    const violation = assignmentViolation(effective, patch.assignee ?? null);
    if (violation) throw new ApiError("human_only_violation", violation, 409);
  }
  if ("stage" in patch && patch.stage) {
    const violation = stageAdvanceViolation(effective, patch.stage);
    if (violation) throw new ApiError("stage_blocked", violation, 409);
  }
  // Allow-list enforcement on edit (EN-005): a task's repos may only be set to
  // registry members — the SAME persisted allow-list createTask validates against.
  if (patch.repos) {
    await registry.ensureRegistrySeeded();
    const offlist = disallowedRepos(patch.repos, await registry.getRegistry());
    if (offlist.length > 0) {
      throw new ApiError(
        "repo_not_allowed",
        `These repos are not in the registry: ${offlist.join(", ")}. Request and get them approved first.`,
        422
      );
    }
  }

  const pushedDirty = entries.map(([k]) => k).filter((k) => PUSHED_FIELDS.includes(k));
  const dirty = Array.from(new Set([...row.dirty_fields, ...pushedDirty]));

  await repo.updateEntity("task", id, {
    patch: Object.fromEntries(entries),
    // Person columns (assignee) are not mirrored yet (directory increment) —
    // an assignee-only patch does not re-queue the entity for push.
    syncState: pushedDirty.length > 0 ? "pending" : undefined,
    dirtyFields: dirty,
  });

  if ("assignee" in patch) {
    await repo.appendAudit(
      actor,
      patch.assignee === null
        ? `Unassigned ${id} — Assigned To mirror deferred to the directory increment.`
        : `Reassigned ${id} — Assigned To mirror deferred to the directory increment.`,
      "pending"
    );
  }
  if (pushedDirty.length > 0) {
    await repo.appendAudit(actor, `Edited ${id} (${pushedDirty.join(", ")}) — pending push.`, "pending");
  }
  const updated = await repo.getEntity("task", id);
  return (updated?.data ?? null) as Task | null;
}

// ─── Repo registry: self-service request → approve (EN-005 / WS-5) ────────────
// Server-side, persisted counterpart of the client store flow (store.ts). The
// server is the source of truth: an approval inserts the registry row that
// createTask validates against, so a UI-approved repo is honored server-side. The
// request id is deterministic from the repo name so the client and server always
// address the same request (no id divergence across the optimistic mirror).

function requestId(name: string): string {
  return `RR-${repoIdFromName(name)}`;
}

export interface CreateRepoRequestInput {
  name: string;
  owner?: string;
  scope?: string;
  requestedBy: string;
}

export async function createRepoRequest(input: CreateRepoRequestInput): Promise<RepoRequest> {
  const name = input.name.trim();
  if (!name) throw new ApiError("invalid_request", "A repo name is required.", 422);
  const owner = (input.owner ?? "").trim() || REPO_ORG;
  const id = requestId(name);
  await registry.upsertRequest({ id, name, owner, scope: input.scope?.trim() || null, requestedBy: input.requestedBy });
  // Validate against the GitHub org so a reloaded client sees the verified flag
  // (the approve gate re-validates independently — the security boundary).
  const result = await validateRepoInOrg(owner, name);
  await registry.setRequestVerification(id, {
    verified: result.ok,
    visibility: result.visibility,
    def: result.def,
    lang: result.lang,
    note: result.ok ? `Validated against ${owner} on GitHub.` : (result.note ?? "Could not be validated against the org."),
  });
  const saved = await registry.getRequest(id);
  if (!saved) throw new ApiError("internal", "Request did not persist.", 500);
  return saved;
}

export interface RepoDecisionResult {
  repos: Record<string, Repo>;
  repoRequests: RepoRequest[];
}

// Approve a pending request — approver-gated (Owner/Admin), and re-validated
// against the GitHub org at this security boundary so an unverified or vanished
// repo can never reach the allow-list (the client's verified flag is never
// trusted). Adds the repo to the persisted registry.
export async function approveRepoRequest(id: string, actor: string): Promise<RepoDecisionResult> {
  if (!isApprover(ACTORS[actor])) {
    throw new ApiError("not_approver", "Only an Owner or Admin can approve a repo request.", 403);
  }
  const req = await registry.getRequest(id);
  if (!req) throw new ApiError("not_found", `Unknown repo request ${id}.`, 404);
  if (req.status !== "pending") throw new ApiError("already_decided", `Request ${id} is already ${req.status}.`, 409);

  const result = await validateRepoInOrg(req.owner, req.name);
  if (!result.ok) {
    await registry.setRequestVerification(id, { verified: false, note: result.note ?? "Could not be validated against the org." });
    throw new ApiError("repo_unverified", `${req.name} could not be verified against the GitHub org — it can't be approved.`, 422);
  }
  await registry.setRequestVerification(id, {
    verified: true,
    visibility: result.visibility,
    def: result.def,
    lang: result.lang,
    note: `Validated against ${req.owner} on GitHub.`,
  });
  const newRepo = repoFromRequest({ ...req, verified: true, visibility: result.visibility, def: result.def, lang: result.lang });
  await registry.insertRepo(newRepo);
  await registry.markRequestDecided(id, "approved", actor);
  await repo.appendAudit(actor, `Approved repo ${req.name} — added to the registry allow-list.`, "pending");
  const [repos, repoRequests] = await Promise.all([registry.getRegistry(), registry.getRequests()]);
  return { repos, repoRequests };
}

// Reject a pending request — approver-gated. Nothing joins the registry.
export async function rejectRepoRequest(id: string, actor: string): Promise<RepoDecisionResult> {
  if (!isApprover(ACTORS[actor])) {
    throw new ApiError("not_approver", "Only an Owner or Admin can reject a repo request.", 403);
  }
  const req = await registry.getRequest(id);
  if (!req) throw new ApiError("not_found", `Unknown repo request ${id}.`, 404);
  if (req.status !== "pending") throw new ApiError("already_decided", `Request ${id} is already ${req.status}.`, 409);
  await registry.markRequestDecided(id, "rejected", actor);
  await repo.appendAudit(actor, `Rejected repo request ${req.name}.`, "pending");
  const [repos, repoRequests] = await Promise.all([registry.getRegistry(), registry.getRequests()]);
  return { repos, repoRequests };
}
