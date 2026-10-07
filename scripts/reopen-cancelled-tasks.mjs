#!/usr/bin/env node
// TASK-2529 rollback step 1: reopen every cancelled task BEFORE reverting the
// code PR, because the old stage set cannot represent 'cancelled'. For each task
// with stage 'cancelled' (or a stray cancellation value) it sets the stage back
// to the stage recorded in its latest task.cancelled event (default: backlog),
// sets entities.cancellation = NULL, and re-queues the row for SharePoint.
// completed_at is NOT cleared (task 2528 write-once rule). Dry run by default;
// --apply writes. Idempotent: a second --apply finds nothing to reopen. Touches
// only entity_type = 'task'. The `cancellation` column itself stays; it is owned
// and dropped only by the task 2528 down migration.
//
// UAT and staging only; a production run is a separate, explicitly approved step
// and the script refuses a production-looking URL.
//
// Env:   PLX_MC_DATABASE_URL
// Usage: node scripts/reopen-cancelled-tasks.mjs --env uat|staging [--apply]
// Exit:  0 — ok, 1 — failure or refused.

import { pathToFileURL } from "node:url";

// Keep in step with isClosedStage / TERMINAL_STAGES in src/lib/mc-data/policy.ts.
const TERMINAL_STAGES = ["merged", "verified", "cancelled"];
const DEFAULT_STAGE = "backlog";

/**
 * Pure planning. `tasks`: [{id, data, cancellation}]; `events`: task.cancelled
 * rows [{seq, task_id, payload}] in any order.
 * Returns [{id, from, to, source, clearOnly}] — clearOnly rows only null a stray cancellation.
 */
export function planReopen(tasks, events) {
  const previous = new Map(); // task id -> previousStage of the latest cancel
  for (const ev of [...events].sort((a, b) => Number(a.seq) - Number(b.seq))) {
    const stage = ev.payload?.previousStage;
    if (ev.task_id && typeof stage === "string") previous.set(ev.task_id, stage);
  }
  const plan = [];
  for (const task of tasks) {
    const stage = task.data?.stage;
    if (stage !== "cancelled") {
      if (task.cancellation != null) plan.push({ id: task.id, from: stage, to: stage, source: "stray_cancellation", clearOnly: true });
      continue;
    }
    const prev = previous.get(task.id);
    const usable = prev && !TERMINAL_STAGES.includes(prev);
    plan.push({
      id: task.id,
      from: "cancelled",
      to: usable ? prev : DEFAULT_STAGE,
      source: usable ? "cancel_event" : "default",
      clearOnly: false,
    });
  }
  return plan;
}

/** `db` is anything with query(sql, params) -> {rows, rowCount} (a pg Client in production). */
export async function runReopen(db, { apply = false } = {}) {
  const tasks = (
    await db.query(
      `SELECT id, data, cancellation FROM entities
        WHERE entity_type = 'task' AND (data->>'stage' = 'cancelled' OR cancellation IS NOT NULL)
        ORDER BY id`
    )
  ).rows;
  const events = (
    await db.query(
      `SELECT seq, task_id, payload FROM mc_events WHERE kind = 'task.cancelled' ORDER BY seq`
    )
  ).rows;
  const plan = planReopen(tasks, events);

  let updated = 0;
  if (apply) {
    await db.query("BEGIN");
    try {
      for (const p of plan) {
        const res = await db.query(
          p.clearOnly
            ? `UPDATE entities SET cancellation = NULL, updated_at = now()
                WHERE entity_type = 'task' AND id = $1 AND cancellation IS NOT NULL`
            : `UPDATE entities
                  SET data = jsonb_set(data, '{stage}', to_jsonb($2::text)),
                      cancellation = NULL,
                      sync_state = 'pending',
                      dirty_fields = (SELECT COALESCE(jsonb_agg(DISTINCT f), '[]'::jsonb)
                                        FROM jsonb_array_elements_text(dirty_fields || '["stage","cancellation"]'::jsonb) AS f),
                      updated_at = now()
                WHERE entity_type = 'task' AND id = $1 AND data->>'stage' = 'cancelled'`,
          p.clearOnly ? [p.id] : [p.id, p.to]
        );
        updated += res.rowCount ?? 0;
      }
      await db.query("COMMIT");
    } catch (err) {
      await db.query("ROLLBACK");
      throw err;
    }
  }
  return { plan, apply, updated };
}

export function formatReport(report, env) {
  const lines = [
    `reopen cancelled tasks — env=${env} — ${report.apply ? "APPLY" : "DRY RUN"}`,
    `to reopen: ${report.plan.length}`,
    ...report.plan.map((p) => `  ${p.id}: ${p.from} -> ${p.to} (${p.source})${p.clearOnly ? " [clear cancellation only]" : ""}`),
  ];
  lines.push(report.apply ? `rows updated: ${report.updated}` : "no rows written (pass --apply to write)");
  return lines.join("\n");
}

async function main(argv) {
  const apply = argv.includes("--apply");
  const envIdx = argv.indexOf("--env");
  const env = envIdx >= 0 ? argv[envIdx + 1] : undefined;
  if (env !== "uat" && env !== "staging") {
    console.error("--env uat|staging is required (a production reopen is a separate approved run).");
    return 1;
  }
  const url = process.env.PLX_MC_DATABASE_URL;
  if (!url) {
    console.error("PLX_MC_DATABASE_URL is not set.");
    return 1;
  }
  if (/prod/i.test(url)) {
    console.error("Refusing: database URL looks like production.");
    return 1;
  }
  const { Client } = await import("pg");
  const { resolveDbSsl } = await import("./lib/db-ssl.mjs");
  const client = new Client({
    connectionString: url.replace(/([?&])sslmode=[^&]+&?/, "$1").replace(/[?&]$/, ""),
    ssl: resolveDbSsl(),
  });
  await client.connect();
  try {
    console.log(formatReport(await runReopen(client, { apply }), env));
    return 0;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`reopen failed: ${err.message}`);
      process.exit(1);
    }
  );
}
