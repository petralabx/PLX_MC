#!/usr/bin/env node
// TASK-2528 backfill: fill entities.completed_at for tasks that are (or were)
// terminal. Dry run by default; --apply writes. Idempotent: only rows where
// completed_at IS NULL are candidates and the UPDATE re-checks it, so a second
// --apply changes 0 rows. Touches only entity_type = 'task'. Never guesses —
// anything it cannot date from evidence is listed as unresolved with a reason.
//
// Resolution order (per task):
//   PR-linked (task.prs non-empty or a pr.merged event names the task):
//     1. earliest pr.merged event for the task  -> source pr_merge:event
//     2. else task.merge.on                     -> source pr_merge:merge.on
//     else unresolved (a stage-event date is NOT used for PR-linked tasks:
//     late promotion / bulk promotion is exactly what this backfill corrects).
//   No PR:
//     3. earliest event that CHANGED the stage into a terminal stage
//        (replayed per task in seq order; events repeating the current
//        stage — re-syncs — are ignored)    -> source stage_event
//
// UAT and staging only. A production run is a separate, explicitly approved
// step. Before ANY read or write (dry run included) the DB identity is
// verified (scripts/lib/db-identity.mjs): --approved-db <database>@<host> must
// match both the URL host/database and the live current_database(); the
// runtime database (plx_mc on plx-postgres-staging*, TOOLS.md) is always
// refused. The --env label is a report label only and authorizes nothing.
//
// Env:   PLX_MC_DATABASE_URL
// Usage: node scripts/backfill-task-completed-at.mjs --env uat|staging \
//          --approved-db <database>@<host> [--apply]
// Exit:  0 — ok, 1 — failure or refused.

import { pathToFileURL } from "node:url";
import { DbIdentityError, assertApprovedNonProdDb, checkUrlAgainstApproved, parseApprovedDb } from "./lib/db-identity.mjs";

// Keep in step with TERMINAL_STAGES in src/lib/mc-data/policy.ts.
export const TERMINAL_STAGES = ["merged", "verified"];
const EVENT_KINDS = ["pr.merged", "task.promoted", "task.progress"];

function toIso(value) {
  const ms = Date.parse(value instanceof Date ? value.toISOString() : String(value));
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function taskIdsOf(event) {
  const ids = new Set();
  if (event.task_id) ids.add(event.task_id);
  const listed = event.payload?.taskIds;
  if (Array.isArray(listed)) for (const id of listed) if (typeof id === "string") ids.add(id);
  return ids;
}

/**
 * Pure resolution. `tasks`: [{id, data}] with completed_at IS NULL.
 * `events`: [{seq, ts, kind, task_id, payload}] in any order.
 * Returns { resolved: [{id, completedAt, source}], unresolved: [{id, reason}], counts }.
 */
export function resolveCompletions(tasks, events) {
  const ordered = [...events].sort((a, b) => Number(a.seq) - Number(b.seq));
  const prMerged = new Map(); // task id -> earliest pr.merged ISO
  const stageChange = new Map(); // task id -> earliest stage change into terminal
  const wasTerminal = new Set();
  const lastStage = new Map();

  for (const ev of ordered) {
    const ts = toIso(ev.ts);
    if (!ts) continue;
    if (ev.kind === "pr.merged") {
      for (const id of taskIdsOf(ev)) if (!prMerged.has(id)) prMerged.set(id, ts);
      continue;
    }
    const stage = ev.payload?.stage;
    if (typeof stage !== "string" || !ev.task_id) continue;
    const prev = lastStage.get(ev.task_id);
    lastStage.set(ev.task_id, stage);
    if (stage === prev) continue; // no stage change (re-sync / repeat)
    if (TERMINAL_STAGES.includes(stage) && !TERMINAL_STAGES.includes(prev)) {
      wasTerminal.add(ev.task_id);
      if (!stageChange.has(ev.task_id)) stageChange.set(ev.task_id, ts);
    }
  }

  const resolved = [];
  const unresolved = [];
  const counts = { "pr_merge:event": 0, "pr_merge:merge.on": 0, stage_event: 0 };

  for (const task of tasks) {
    const data = task.data ?? {};
    const terminalNow = TERMINAL_STAGES.includes(data.stage);
    if (!terminalNow && !wasTerminal.has(task.id) && !prMerged.has(task.id)) continue; // not a candidate
    const prLinked = (Array.isArray(data.prs) && data.prs.length > 0) || prMerged.has(task.id);

    if (prLinked) {
      if (prMerged.has(task.id)) {
        resolved.push({ id: task.id, completedAt: prMerged.get(task.id), source: "pr_merge:event" });
        counts["pr_merge:event"] += 1;
        continue;
      }
      const on = data.merge?.on ? toIso(data.merge.on) : null;
      if (on) {
        resolved.push({ id: task.id, completedAt: on, source: "pr_merge:merge.on" });
        counts["pr_merge:merge.on"] += 1;
        continue;
      }
      unresolved.push({ id: task.id, reason: "PR-linked but no pr.merged event and no merge.on" });
      continue;
    }

    if (stageChange.has(task.id)) {
      resolved.push({ id: task.id, completedAt: stageChange.get(task.id), source: "stage_event" });
      counts.stage_event += 1;
      continue;
    }
    unresolved.push({ id: task.id, reason: "no PR and no stage-change event into a terminal stage" });
  }
  return { resolved, unresolved, counts };
}

/** `db` is anything with query(sql, params) -> {rows, rowCount} (a pg Client in production). */
export async function runBackfill(db, { apply = false } = {}) {
  const tasks = (
    await db.query(
      `SELECT id, data FROM entities WHERE entity_type = 'task' AND completed_at IS NULL ORDER BY id`
    )
  ).rows;
  const events = (
    await db.query(
      `SELECT seq, ts, kind, task_id, payload FROM mc_events WHERE kind = ANY($1::text[]) ORDER BY seq`,
      [EVENT_KINDS]
    )
  ).rows;
  const plan = resolveCompletions(tasks, events);

  let updated = 0;
  if (apply) {
    await db.query("BEGIN");
    try {
      for (const r of plan.resolved) {
        const res = await db.query(
          `UPDATE entities SET completed_at = $2::timestamptz
            WHERE entity_type = 'task' AND id = $1 AND completed_at IS NULL`,
          [r.id, r.completedAt]
        );
        updated += res.rowCount ?? 0;
      }
      await db.query("COMMIT");
    } catch (err) {
      await db.query("ROLLBACK");
      throw err;
    }
  }
  return { ...plan, apply, updated };
}

export function formatReport(report, env) {
  const lines = [
    `completed_at backfill — env=${env} — ${report.apply ? "APPLY" : "DRY RUN"}`,
    `resolved: ${report.resolved.length}`,
    ...Object.entries(report.counts).map(([k, v]) => `  ${k}: ${v}`),
    `unresolved: ${report.unresolved.length}`,
    ...report.unresolved.map((u) => `  ${u.id}: ${u.reason}`),
  ];
  lines.push(report.apply ? `rows updated: ${report.updated}` : "no rows written (pass --apply to write)");
  return lines.join("\n");
}

/**
 * @param {string[]} argv
 * @param {{ env?: Record<string, string | undefined>, createClient?: (target: { host: string, port: number, database: string, user: string, password: string }) => any }} [opts] test seams
 */
export async function main(argv, { env: processEnv = process.env, createClient } = {}) {
  const apply = argv.includes("--apply");
  const envIdx = argv.indexOf("--env");
  const env = envIdx >= 0 ? argv[envIdx + 1] : undefined;
  if (env !== "uat" && env !== "staging") {
    console.error("--env uat|staging is required (production backfill is a separate approved run).");
    return 1;
  }
  const url = processEnv.PLX_MC_DATABASE_URL;
  if (!url) {
    console.error("PLX_MC_DATABASE_URL is not set.");
    return 1;
  }
  let client;
  try {
    const approved = parseApprovedDb(argv);
    // Refuse before connecting; the client is built from this exact validated
    // target (never the raw URL), so overrides in the URL cannot redirect it.
    const target = checkUrlAgainstApproved(url, approved, processEnv);
    client = createClient ? createClient(target) : await defaultClient(target);
    await client.connect();
    try {
      await assertApprovedNonProdDb(client, url, approved, processEnv); // before any read or write
      console.log(formatReport(await runBackfill(client, { apply }), env));
      return 0;
    } finally {
      await client.end();
    }
  } catch (err) {
    if (err instanceof DbIdentityError) {
      console.error(err.message);
      return 1;
    }
    throw err;
  }
}

async function defaultClient({ host, port, database, user, password }) {
  const { Client } = await import("pg");
  const { resolveDbSsl } = await import("./lib/db-ssl.mjs");
  return new Client({
    host,
    port,
    database,
    user,
    password,
    ssl: resolveDbSsl(),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`backfill failed: ${err.message}`);
      process.exit(1);
    }
  );
}
