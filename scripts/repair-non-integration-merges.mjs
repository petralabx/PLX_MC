#!/usr/bin/env node
// TASK-3797 one-off repair: before TASK-3797 the compliance projection promoted a
// task to Merged on any PR merge, even one into a feature branch. This finds the
// tasks still at Merged whose merged PRs all went into a branch other than their
// repo's integration branch (config/tracked-repos-registry.json), and moves each
// back to In Progress. The 2026-10-23 UFL review found TASK-3700 (portal #2883
// into task/TASK-3696) and TASK-3706 (PLX_MC #406 into #405's branch).
//
// A task is a candidate when its stage is merged, a task.promoted event names it,
// and every PR it merged (its merged task.prs rows plus the PRs of those events)
// has a known base that is not the integration branch. One PR into the
// integration branch, or one base it cannot read, leaves the task alone and the
// report says why. Bases come from the PR row (TASK-3797 rows) or from GitHub
// through the gh CLI (the operator's own login), dry run included.
//
// --apply sets stage = progress, records each merged row's base, drops the
// DB-only merge field, appends an activity line, and re-queues the row for
// SharePoint (stage is a pushed field). completed_at is NOT cleared (task 2528
// write-once rule). The UPDATE re-checks stage = merged, so a second --apply
// changes 0 rows, and a task it moved once is never moved again. Each write
// re-reads the row under its lock. Dry run by default; each change is printed.
//
// Non-production only. The target is verified, not labelled: --approved-db
// database@host must match the URL host and the server's current_database(), and
// can never be the TOOLS.md runtime database (scripts/lib/db-identity.mjs). A
// production run is a separate, explicitly approved step. The check runs before
// the dry-run read too, so nothing is read from an unverified database.
//
// Env:   PLX_MC_DATABASE_URL
// Usage: node scripts/repair-non-integration-merges.mjs --env uat|staging --approved-db database@host [--apply]
// Exit:  0 — ok, 1 — failure or refused.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { DbIdentityError, assertApprovedNonProdDb, checkUrlAgainstApproved, parseApprovedDb } from "./lib/db-identity.mjs";

const ACTOR = "compliance-projection";
const REPAIR_MARK = "Repair (TASK-3797):";
const prsOf = (data) => (Array.isArray(data?.prs) ? data.prs : []);
const prKey = (repo, num) => `${String(repo).toLowerCase()}#${num}`;

/**
 * Registry repos by lowercased bare name: { slug, integrationBranch }. Events and
 * task.prs rows carry the bare name; a name two owners share maps to null.
 * Mirrors integrationBranchFor (src/lib/compliance/tracked-repos.ts).
 */
export function loadRegistry(raw = JSON.parse(readFileSync(new URL("../config/tracked-repos-registry.json", import.meta.url), "utf8"))) {
  const byName = new Map();
  for (const entry of raw.repos ?? []) {
    if (typeof entry.repo !== "string") continue;
    const slug = entry.repo.trim();
    const name = slug.slice(slug.lastIndexOf("/") + 1).toLowerCase();
    const integrationBranch = typeof entry.integration_branch === "string" && entry.integration_branch.trim() ? entry.integration_branch.trim() : "main";
    byName.set(name, byName.has(name) ? null : { slug, integrationBranch });
  }
  return byName;
}

/** The PR's base branch from GitHub, or null when it cannot be read. */
export function ghPrBase(slug, num) {
  const r = spawnSync("gh", ["api", `repos/${slug}/pulls/${num}`, "--jq", ".base.ref"], { encoding: "utf8" });
  const base = r.status === 0 ? String(r.stdout).trim() : "";
  return base || null;
}

/** Every PR the task merged: its merged rows, then the PRs its task.promoted events name. */
function mergedPrs(task, promotedEvents) {
  const out = new Map();
  for (const p of prsOf(task.data)) {
    if (p?.status === "merged" && p.repo && Number.isInteger(Number(p.num))) out.set(prKey(p.repo, Number(p.num)), { repo: p.repo, num: Number(p.num), base: p.base ?? null });
  }
  for (const ev of promotedEvents) {
    const num = Number(ev.pr);
    if (!ev.repo || !Number.isInteger(num) || num <= 0) continue;
    const key = prKey(ev.repo, num);
    if (!out.has(key)) out.set(key, { repo: ev.repo, num, base: null });
  }
  return [...out.values()];
}

/**
 * Pure planning. `tasks`: [{id, data}] at stage merged; `events`: task.promoted
 * rows [{seq, task_id, repo, pr}]; `bases`: Map prKey -> base | null (GitHub).
 * Returns { repairs: [{taskId, prs: [{repo, num, base, integrationBranch}]}], kept: [{taskId, reason}] }.
 */
export function planRepairs(tasks, events, registry, bases = new Map()) {
  const byTask = new Map();
  for (const ev of [...events].sort((a, b) => Number(a.seq) - Number(b.seq))) {
    if (!ev.task_id) continue;
    if (!byTask.has(ev.task_id)) byTask.set(ev.task_id, []);
    byTask.get(ev.task_id).push(ev);
  }
  const repairs = [];
  const kept = [];
  for (const task of [...tasks].sort((a, b) => String(a.id).localeCompare(String(b.id), "en", { numeric: true }))) {
    if (task.data?.stage !== "merged" || !byTask.has(task.id)) continue;
    // A task this script moved once and a person moved back to Merged stays.
    if ((Array.isArray(task.data?.activity) ? task.data.activity : []).some((a) => String(a?.what ?? "").startsWith(REPAIR_MARK))) {
      kept.push({ taskId: task.id, reason: "already repaired once" });
      continue;
    }
    const prs = mergedPrs(task, byTask.get(task.id)).map((p) => {
      const reg = registry.get(String(p.repo).toLowerCase());
      return { ...p, base: p.base ?? bases.get(prKey(p.repo, p.num)) ?? null, integrationBranch: reg ? reg.integrationBranch : "main" };
    });
    const landed = prs.find((p) => p.base === p.integrationBranch);
    const unknown = prs.find((p) => p.base === null);
    if (prs.length === 0) kept.push({ taskId: task.id, reason: "no merged PR found" });
    else if (landed) kept.push({ taskId: task.id, reason: `${landed.repo}#${landed.num} reached ${landed.integrationBranch}` });
    else if (unknown) kept.push({ taskId: task.id, reason: `base of ${unknown.repo}#${unknown.num} unknown` });
    else repairs.push({ taskId: task.id, prs });
  }
  return { repairs, kept };
}

function repairedPrs(data, repair) {
  return prsOf(data).map((p) => {
    const hit = repair.prs.find((r) => prKey(r.repo, r.num) === prKey(p.repo, Number(p.num)));
    return hit && p.status === "merged" ? { ...p, base: hit.base } : p;
  });
}

function activityLine(repair) {
  const into = repair.prs.map((p) => `#${p.num} into ${p.base}`).join(", ");
  return {
    age: "now",
    who: ACTOR,
    what: `${REPAIR_MARK} PR ${into}, not the integration branch — moved back to In Progress`,
    kind: "move",
  };
}

// The write re-reads the row under its lock and builds prs from that read, so a
// PR event that landed since the plan is kept.
const LOCK_SQL = `SELECT id, data FROM entities WHERE entity_type = 'task' AND id = $1 FOR UPDATE`;

// Re-checks stage = merged, so a task someone moved since the read is left alone.
const REPAIR_SQL = `UPDATE entities
    SET data = (data - 'merge') || jsonb_build_object(
          'stage', 'progress',
          'prs', $2::jsonb,
          'activity', (CASE WHEN jsonb_typeof(data->'activity') = 'array' THEN data->'activity' ELSE '[]'::jsonb END) || $3::jsonb),
        sync_state = 'pending',
        dirty_fields = (SELECT COALESCE(jsonb_agg(DISTINCT f), '[]'::jsonb)
                          FROM jsonb_array_elements_text(dirty_fields || '["stage"]'::jsonb) AS f),
        updated_at = now()
  WHERE entity_type = 'task' AND id = $1 AND data->>'stage' = 'merged'`;

/** `db` is anything with query(sql, params) -> {rows, rowCount} (a pg Client in production). */
export async function runRepair(db, { apply = false, prBase = ghPrBase, registry = loadRegistry() } = {}) {
  const events = (
    await db.query(`SELECT seq, task_id, repo, pr FROM mc_events WHERE kind = 'task.promoted' AND task_id IS NOT NULL ORDER BY seq`)
  ).rows;
  const taskIds = [...new Set(events.map((e) => e.task_id))];
  const tasks = taskIds.length
    ? (await db.query(`SELECT id, data FROM entities WHERE entity_type = 'task' AND id = ANY($1::text[]) AND data->>'stage' = 'merged'`, [taskIds])).rows
    : [];
  // GitHub is asked only for the bases the rows do not carry.
  const bases = new Map();
  for (const r of planRepairs(tasks, events, registry).kept) {
    if (!r.reason.startsWith("base of ")) continue;
    const task = tasks.find((t) => t.id === r.taskId);
    for (const p of mergedPrs(task, events.filter((e) => e.task_id === r.taskId))) {
      const key = prKey(p.repo, p.num);
      if (p.base || bases.has(key)) continue;
      const reg = registry.get(String(p.repo).toLowerCase());
      bases.set(key, reg ? prBase(reg.slug, p.num) : null);
    }
  }
  const plan = planRepairs(tasks, events, registry, bases);

  let updated = 0;
  if (apply && plan.repairs.length > 0) {
    await db.query("BEGIN");
    try {
      for (const repair of plan.repairs) {
        const task = (await db.query(LOCK_SQL, [repair.taskId])).rows[0];
        if (!task || task.data?.stage !== "merged") continue;
        const res = await db.query(REPAIR_SQL, [
          repair.taskId,
          JSON.stringify(repairedPrs(task.data, repair)),
          JSON.stringify([activityLine(repair)]),
        ]);
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

/** Verifies the target identity first; nothing is read or written on a refusal. `approvedDb` is a parsed { database, host }. */
export async function runGuarded(db, { url, approvedDb, apply = false, env = process.env, prBase = ghPrBase }) {
  await assertApprovedNonProdDb(db, url, approvedDb, env);
  return runRepair(db, { apply, prBase });
}

export function formatReport(report, env) {
  const lines = [
    `repair non-integration merges — env=${env} — ${report.apply ? "APPLY" : "DRY RUN"}`,
    `to move back to In Progress: ${report.repairs.length}`,
    ...report.repairs.map(
      (r) => `  ${r.taskId}: merged -> progress (${r.prs.map((p) => `${p.repo}#${p.num} into ${p.base}, not ${p.integrationBranch}`).join("; ")})`
    ),
    `left at Merged: ${report.kept.length}`,
    ...report.kept.map((k) => `  ${k.taskId}: ${k.reason}`),
  ];
  lines.push(report.apply ? `rows updated: ${report.updated}` : "no rows written (pass --apply to write)");
  return lines.join("\n");
}

async function main(argv) {
  const apply = argv.includes("--apply");
  const envIdx = argv.indexOf("--env");
  const env = envIdx >= 0 ? argv[envIdx + 1] : undefined;
  if (env !== "uat" && env !== "staging") {
    console.error("--env uat|staging is required (a production repair is a separate approved run).");
    return 1;
  }
  const url = process.env.PLX_MC_DATABASE_URL;
  if (!url) {
    console.error("PLX_MC_DATABASE_URL is not set.");
    return 1;
  }
  try {
    const approvedDb = parseApprovedDb(argv);
    // Refuse before connecting; the client is built from this exact validated
    // target (never the raw URL), so overrides in the URL cannot redirect it.
    const { host, port, database, user, password } = checkUrlAgainstApproved(url, approvedDb);
    const { Client } = await import("pg");
    const { resolveDbSsl } = await import("./lib/db-ssl.mjs");
    const client = new Client({ host, port, database, user, password, ssl: resolveDbSsl() });
    await client.connect();
    try {
      console.log(formatReport(await runGuarded(client, { url, approvedDb, apply }), env));
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`repair failed: ${err.message}`);
      process.exit(1);
    }
  );
}
