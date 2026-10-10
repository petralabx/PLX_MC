// Live "In flight" view for the Dashboard (TASK-2592): which agent holds which
// task right now (the open checkouts), each task's latest activity, and the
// newest meaningful events for the activity strip. Computed on demand from
// mc_dispatch and mc_events (no new store, no migration). computeInFlight is
// pure; loadInFlight wraps the repos and filters by project access the way
// /api/events and mc_list_checkouts do. Only compact projections leave the
// server: no checkout ids at all, and event payloads reduced to one line of text.

import { STAGES, type StageKey } from "@/lib/mc-data";
import { canAccessTask, indexById, type ProjectAclPrincipal } from "@/lib/permissions/project-acl";
import { loadProjectAclMaps } from "@/lib/permissions/project-acl-guard";
import { getTaskSummaries, latestTaskWriteAt } from "@/lib/sync/repo";
import { filterEventsByProjectAcl } from "./events-acl";
import {
  eventsByKinds,
  latestEventsForTasks,
  listDispatches,
  type DispatchListRow,
  type EventRow,
} from "./repo";

export const IN_FLIGHT_EVENT_KINDS = [
  "checkout",
  "checkout.released",
  "task.progress",
  "task.completed",
  "task.promoted",
  "pr.opened",
  "pr.synchronized",
  "pr.merged",
  "pr.closed",
  "gate.passed",
  "gate.blocked",
] as const;

const HOUR_MS = 3_600_000;
/** No activity for this long → the task is flagged quiet. */
export const QUIET_AFTER_MS = 2 * HOUR_MS;
/** The task's last open checkout ends within this window → flagged. */
export const EXPIRING_WITHIN_MS = HOUR_MS;
/** The activity strip: newest first, at most this many, from the last day. */
export const RECENT_EVENT_LIMIT = 30;
const RECENT_WINDOW_MS = 24 * HOUR_MS;
// mc_list_checkouts' ceiling; open checkouts are far fewer in practice.
const OPEN_CHECKOUT_LIMIT = 200;
const NOTE_MAX = 140;

export interface InFlightCheckout {
  /** Display name of the runtime ("Claude Code", "Cursor", …). */
  agent: string;
  runtime: string;
  actorKind: string;
  accountableHuman: string;
  repo: string;
  issuedAt: string;
  expiresAt: string;
}

export interface LiveEvent {
  seq: string;
  ts: string;
  kind: string;
  /** Display name of who acted: an agent, a person's email, or "Mission Control". */
  by: string;
  taskId: string | null;
  repo: string | null;
  pr: string | null;
  /** One plain line, e.g. "PR #312 opened". */
  text: string;
}

export interface InFlightTask {
  taskId: string;
  /** null when Mission Control does not hold the task. */
  title: string | null;
  stage: StageKey | null;
  bucketId: string | null;
  /** Open checkouts on the task, newest first. */
  checkouts: InFlightCheckout[];
  /** When the oldest open checkout was issued. */
  since: string;
  /** When the last open checkout expires. */
  expiresAt: string;
  /** The newest event since checkout; the newest checkout itself when none is newer. */
  lastActivity: LiveEvent;
  multiple: boolean;
  quiet: boolean;
  expiringSoon: boolean;
}

export interface InFlightReport {
  generatedAt: string;
  /** Tasks with an open checkout the viewer can see, most recently active first. */
  tasks: InFlightTask[];
  /** Newest first. */
  events: LiveEvent[];
  /** When any task was last written; the client reloads its snapshot when this moves. */
  tasksUpdatedAt: string | null;
}

export interface TaskSummary {
  id: string;
  title: string;
  stage: StageKey;
  bucket: string;
}

const AGENT_LABEL: Record<string, string> = {
  "claude-code": "Claude Code",
  claude: "Claude Code",
  cursor: "Cursor",
  codex: "Codex",
  chatgpt: "ChatGPT",
  grok: "Grok",
  swarm: "Swarm",
};
// Mission Control's own writers (stage projection, go-live announcements).
const SYSTEM_ACTORS = new Set(["compliance-projection", "mc-go-live"]);

/** "claude-code" → "Claude Code"; an unknown runtime keeps its own name. */
export function agentLabel(runtime: string): string {
  return AGENT_LABEL[runtime.trim().toLowerCase()] ?? runtime;
}

/** Event actors: "runtime", "runtime:operator", "human:email" or a service id. */
export function actorLabel(actor: string): string {
  const [head, ...rest] = actor.split(":");
  const key = head.trim().toLowerCase();
  if (AGENT_LABEL[key]) return AGENT_LABEL[key];
  if (key === "human" && rest.length > 0) return rest.join(":");
  if (SYSTEM_ACTORS.has(key)) return "Mission Control";
  return head;
}

const STAGE_NAME = new Map<string, string>(STAGES.map((s) => [s.key, s.name]));

function stageName(value: unknown): string | null {
  return typeof value === "string" ? (STAGE_NAME.get(value) ?? value) : null;
}

function firstLine(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const line = value
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  if (!line) return null;
  return line.length > NOTE_MAX ? `${line.slice(0, NOTE_MAX - 1).trimEnd()}…` : line;
}

/** One plain line for an event; never echoes anything but notes, stage and PR number. */
export function describeEvent(event: Pick<EventRow, "kind" | "pr" | "payload">): string {
  const p = event.payload ?? {};
  const pr = event.pr ? `PR #${event.pr}` : "A PR";
  switch (event.kind) {
    case "checkout":
      return "Checked out";
    case "checkout.released":
      if (p.reason === "merged") return "Checkout released after the merge";
      if (p.reason === "closed") return "Checkout released after the PR closed";
      return "Checkout released";
    case "task.progress": {
      const note = firstLine(p.notes) ?? firstLine(p.note);
      const pct = typeof p.progressPct === "number" ? `${Math.round(p.progressPct)}%` : null;
      if (note) return pct ? `${pct} · ${note}` : note;
      if (pct) return `Progress ${pct}`;
      const stage = stageName(p.stage);
      return stage ? `Progress update (${stage})` : "Progress update";
    }
    case "task.completed":
      return "Work marked complete";
    case "task.promoted": {
      const stage = stageName(p.stage);
      return stage ? `Moved to ${stage}` : "Moved forward";
    }
    case "pr.opened":
      return `${pr} opened`;
    case "pr.synchronized":
      return `${pr} updated`;
    case "pr.merged":
      return `${pr} merged`;
    case "pr.closed":
      return `${pr} closed without merging`;
    case "gate.passed":
      return `Compliance check passed on ${pr}`;
    case "gate.blocked":
      return `Compliance check blocked ${pr}`;
    default:
      return event.kind;
  }
}

export function toLiveEvent(event: EventRow): LiveEvent {
  return {
    seq: event.seq,
    ts: event.ts,
    kind: event.kind,
    by: actorLabel(event.actor),
    taskId: event.taskId,
    repo: event.repo,
    pr: event.pr,
    text: describeEvent(event),
  };
}

function toCheckout(row: DispatchListRow): InFlightCheckout {
  return {
    agent: agentLabel(row.runtime),
    runtime: row.runtime,
    actorKind: row.actorKind,
    accountableHuman: row.accountableHuman,
    repo: row.repo,
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
  };
}

/** Pure fold: open checkouts + task summaries + events → the Dashboard's live view. */
export function computeInFlight(input: {
  checkouts: readonly DispatchListRow[];
  tasks: readonly TaskSummary[];
  /** The newest event per task since its checkouts (any order). */
  lastEvents: readonly EventRow[];
  recentEvents: readonly EventRow[];
  tasksUpdatedAt: string | null;
  now: Date;
}): InFlightReport {
  const nowMs = input.now.getTime();
  const taskById = new Map(input.tasks.map((t) => [t.id, t]));
  const lastByTask = new Map<string, EventRow>();
  for (const event of input.lastEvents) {
    const held = event.taskId ? lastByTask.get(event.taskId) : undefined;
    if (event.taskId && (!held || Number(event.seq) > Number(held.seq))) lastByTask.set(event.taskId, event);
  }
  const byTask = new Map<string, DispatchListRow[]>();
  for (const row of input.checkouts) {
    const group = byTask.get(row.taskId);
    if (group) group.push(row);
    else byTask.set(row.taskId, [row]);
  }

  const tasks: InFlightTask[] = [...byTask].map(([taskId, rows]) => {
    const ordered = [...rows].sort((a, b) => Date.parse(b.issuedAt) - Date.parse(a.issuedAt));
    const newest = ordered[0];
    const summary = taskById.get(taskId);
    const event = lastByTask.get(taskId);
    const lastActivity =
      event && Date.parse(event.ts) >= Date.parse(newest.issuedAt)
        ? toLiveEvent(event)
        : toLiveEvent({
            seq: "",
            ts: newest.issuedAt,
            kind: "checkout",
            actor: newest.runtime,
            repo: newest.repo,
            taskId,
            pr: null,
            payload: {},
          });
    const expiresMs = Math.max(...ordered.map((r) => Date.parse(r.expiresAt)));
    return {
      taskId,
      title: summary?.title ?? null,
      stage: summary?.stage ?? null,
      bucketId: summary?.bucket ?? null,
      checkouts: ordered.map(toCheckout),
      since: ordered[ordered.length - 1].issuedAt,
      expiresAt: new Date(expiresMs).toISOString(),
      lastActivity,
      multiple: ordered.length > 1,
      quiet: nowMs - Date.parse(lastActivity.ts) >= QUIET_AFTER_MS,
      expiringSoon: expiresMs - nowMs <= EXPIRING_WITHIN_MS,
    };
  });
  tasks.sort(
    (a, b) =>
      Date.parse(b.lastActivity.ts) - Date.parse(a.lastActivity.ts) ||
      a.taskId.localeCompare(b.taskId, undefined, { numeric: true })
  );

  const events = [...input.recentEvents]
    .sort((a, b) => Number(b.seq) - Number(a.seq))
    .slice(0, RECENT_EVENT_LIMIT)
    .map(toLiveEvent);

  return { generatedAt: input.now.toISOString(), tasks, events, tasksUpdatedAt: input.tasksUpdatedAt };
}

/** The live view for one viewer: everything in a project they can't access is left out. */
export async function loadInFlight(principal: ProjectAclPrincipal, now = new Date()): Promise<InFlightReport> {
  const kinds = [...IN_FLIGHT_EVENT_KINDS];
  const [open, recent, { projectsById, bucketsById }, tasksUpdatedAt] = await Promise.all([
    listDispatches({ active: true, limit: OPEN_CHECKOUT_LIMIT }),
    eventsByKinds(kinds, RECENT_EVENT_LIMIT, new Date(now.getTime() - RECENT_WINDOW_MS).toISOString()),
    loadProjectAclMaps(),
    latestTaskWriteAt(),
  ]);
  const openTaskIds = [...new Set(open.map((row) => row.taskId))];
  const oldestIssuedAt = open.reduce((min, row) => (row.issuedAt < min ? row.issuedAt : min), now.toISOString());
  const eventTaskIds = recent.flatMap((event) => (event.taskId ? [event.taskId] : []));
  const [last, summaries] = await Promise.all([
    latestEventsForTasks(openTaskIds, kinds, oldestIssuedAt),
    getTaskSummaries([...new Set([...openTaskIds, ...eventTaskIds])]),
  ]);
  const taskById = indexById(summaries);
  // A task Mission Control doesn't hold is not project-scoped (the
  // /api/events and mc_list_checkouts rule); every other task needs access.
  const visible = (taskId: string | null) => {
    const task = taskId ? taskById.get(taskId) : undefined;
    return !task || canAccessTask(task, bucketsById, projectsById, principal);
  };
  return computeInFlight({
    checkouts: open.filter((row) => visible(row.taskId)),
    tasks: summaries.filter((task) => visible(task.id)),
    lastEvents: last.filter((event) => visible(event.taskId)),
    recentEvents: await filterEventsByProjectAcl(recent, principal, { projectsById, bucketsById, taskById }),
    tasksUpdatedAt,
    now,
  });
}
