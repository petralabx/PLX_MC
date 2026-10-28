#!/usr/bin/env node
// TASK-4017 backfill: tasks that mc_complete_task completed with no linked PR
// but whose stage stayed below done (e.g. TASK-3229, TASK-3228, TASK-3226).
// Moves them to "merged" — the done stage the forward fix in actionComplete
// now applies. NEVER sets "verified". Not a schema migration.
//
// Dry run by default; --apply writes. Idempotent: the UPDATE re-checks the
// stage and the empty PR list, so a second --apply changes 0 rows.
//
// Candidate (per task):
//   - stage is one of PROMOTABLE_STAGES, and task.prs is empty or missing;
//   - its LATEST task.completed event has outcome "completed" (or none) and
//     no prUrl (a blocked/failed latest hand-in, or one naming a PR, is skipped).
//
// UAT and staging only, with the same DB identity guard as the other backfills
// (scripts/lib/db-identity.mjs): --approved-db <database>@<host> must match the
// URL and the live current_database(); the runtime database is refused. A
// production run is a separate, explicitly approved step.
//
// Env:   PLX_MC_DATABASE_URL
// Usage: node scripts/backfill-prless-completed-stage.mjs --env uat|staging \
//          --approved-db <database>@<host> [--apply]
// Exit:  0 — ok, 1 — failure or refused.

import { pathToFileURL } from "node:url";
import { DbIdentityError, assertApprovedNonProdDb, checkUrlAgainstApproved, parseApprovedDb } from "./lib/db-identity.mjs";

export const DONE_STAGE = "merged";
// Keep in step with PRLESS_PROMOTABLE_STAGES in src/lib/mcp/actions.ts.
export const PROMOTABLE_STAGES = ["backlog", "specced", "approved", "planned", "progress", "qa", "review"];

const hasPrs = (data) => Array.isArray(data?.prs) && data.prs.length > 0;

// Keep in step with isUatTicketTask in src/lib/tasks/uat-labels.ts.
// A ticket task's done stage only comes from a PR merge, so the backfill
// must not move one to merged. uat:blocked and uat:hold are state, not an id.
const UAT_STATE_LABELS = new Set(["uat:blocked", "uat:hold"]);
const UAT_TICKET_RE = /^uat:[^\s:]+$/;
const isUatTicketTask = (data) => {
  const labels = Array.isArray(data?.labels) ? data.labels : [];
  return labels.includes("kind:code") && labels.some((label) => UAT_TICKET_RE.test(label) && !UAT_STATE_LABELS.has(label));
};

/**
 * Pure planning. `tasks`: [{id, data}]. `events`: task.completed rows
 * [{seq, task_id, payload}] in any order. Returns { promote: [{id, from}], skipped: [{id, reason}] }.
 */
export function planPromotions(tasks, events) {
  const latest = new Map();
  for (const ev of [...events].sort((a, b) => Number(a.seq) - Number(b.seq))) {
    if (ev.task_id) latest.set(ev.task_id, ev);
  }
  const promote = [];
  const skipped = [];
  for (const task of tasks) {
    const data = task.data ?? {};
    const ev = latest.get(task.id);
    if (!ev) continue;
    if (!PROMOTABLE_STAGES.includes(data.stage)) continue; // already done/cancelled/etc.
    if (hasPrs(data)) {
      skipped.push({ id: task.id, reason: "has PR rows; left to the merged-PR projection" });
      continue;
    }
    if (isUatTicketTask(data)) {
      skipped.push({ id: task.id, reason: "UAT ticket task; done stage only comes from a PR merge" });
      continue;
    }
    const outcome = ev.payload?.outcome ?? "completed";
    if (outcome !== "completed") {
      skipped.push({ id: task.id, reason: `latest completion outcome is ${outcome}` });
      continue;
    }
    if (typeof ev.payload?.prUrl === "string" && ev.payload.prUrl.trim()) {
      skipped.push({ id: task.id, reason: "latest completion names a prUrl" });
      continue;
    }
    promote.push({ id: task.id, from: data.stage });
  }
  return { promote, skipped };
}

/** `db` is anything with query(sql, params) -> {rows, rowCount}. */
export async function runBackfill(db, { apply = false } = {}) {
  const tasks = (
    await db.query(
      `SELECT id, data FROM entities WHERE entity_type = 'task' AND data->>'stage' = ANY($1::text[]) ORDER BY id`,
      [PROMOTABLE_STAGES]
    )
  ).rows;
  const events = (
    await db.query(`SELECT seq, task_id, payload FROM mc_events WHERE kind = 'task.completed' ORDER BY seq`)
  ).rows;
  const plan = planPromotions(tasks, events);

  let updated = 0;
  if (apply) {
    await db.query("BEGIN");
    try {
      for (const p of plan.promote) {
        const res = await db.query(
          // Queue Stage for the outbound sweep, as updateEntity does.
          `UPDATE entities
              SET data = jsonb_set(data, '{stage}', to_jsonb($2::text)),
                  sync_state = CASE WHEN sync_state = 'synced' THEN 'pending' ELSE sync_state END,
                  dirty_fields = CASE WHEN dirty_fields @> '"stage"'::jsonb
                                      THEN dirty_fields
                                      ELSE dirty_fields || '"stage"'::jsonb END,
                  updated_at = now()
            WHERE entity_type = 'task' AND id = $1
              AND data->>'stage' = ANY($3::text[])
              AND COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(data->'prs') = 'array' THEN data->'prs' END), 0) = 0`,
          [p.id, DONE_STAGE, PROMOTABLE_STAGES]
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
  return [
    `PR-less completed stage backfill — env=${env} — ${report.apply ? "APPLY" : "DRY RUN"}`,
    `to promote -> ${DONE_STAGE}: ${report.promote.length}`,
    ...report.promote.map((p) => `  ${p.id}: ${p.from} -> ${DONE_STAGE}`),
    `skipped: ${report.skipped.length}`,
    ...report.skipped.map((s) => `  ${s.id}: ${s.reason}`),
    report.apply ? `rows updated: ${report.updated}` : "no rows written (pass --apply to write)",
  ].join("\n");
}

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
  return new Client({ host, port, database, user, password, ssl: resolveDbSsl() });
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
