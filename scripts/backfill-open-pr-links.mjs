#!/usr/bin/env node
// TASK-3743 backfill: link PRs that are still open to their tasks, from the
// logged pr.opened / pr.synchronized events. Before TASK-3743 the compliance
// projection wrote task.prs only on merge, so open PRs never showed on a task.
// Dry run by default; --apply writes. Idempotent: a PR already on the task (any
// status; the merged entry wins) is skipped, and the UPDATE re-checks it, so a
// second --apply changes 0 rows. Touches only entity_type = 'task' rows by id,
// and only data.prs (DB-only, never pushed to SharePoint).
//
// A PR is a candidate when its newest pr.* event is pr.opened, pr.synchronized
// or pr.ready_for_review.
// It links to the tasks those events name since the last close or merge, and
// only once GitHub confirms the PR is still open (the loadPrState check, made
// with the gh CLI, dry run included); a closed or unreadable PR is skipped. The
// report prints each candidate's newest event date. The log carries no draft
// flag, so a draft links as "open"; the live projection corrects it later.
//
// Non-production only. The target is verified, not labelled: --approved-db
// database@host must match the URL host and the server's current_database(), and
// can never be the TOOLS.md runtime database (scripts/lib/db-identity.mjs). A
// production run is a separate, explicitly approved step. The check runs before
// the dry-run read too, so nothing is read from an unverified database.
//
// Env:   PLX_MC_DATABASE_URL
// Usage: node scripts/backfill-open-pr-links.mjs --env uat|staging --approved-db database@host [--apply]
// Exit:  0 — ok, 1 — failure or refused.

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { DbIdentityError, assertApprovedNonProdDb, checkUrlAgainstApproved, parseApprovedDb } from "./lib/db-identity.mjs";

const PR_KINDS = ["pr.opened", "pr.synchronized", "pr.ready_for_review", "pr.merged", "pr.closed"];
const OPEN_KINDS = new Set(["pr.opened", "pr.synchronized", "pr.ready_for_review"]);

const prsOf = (data) => (Array.isArray(data?.prs) ? data.prs : []);
const samePr = (p, repo, num) => String(p?.repo).toLowerCase() === repo.toLowerCase() && Number(p?.num) === num;
const prKey = (repo, num) => `${String(repo).toLowerCase()}#${num}`;
const isoDay = (ts) => {
  const ms = ts instanceof Date ? ts.getTime() : Date.parse(String(ts));
  return Number.isNaN(ms) ? "unknown" : new Date(ms).toISOString().slice(0, 10);
};

/**
 * Live PR state, the check loadPrState (src/lib/compliance/github-pr.ts) makes:
 * true when GitHub says open, false when closed, null when it cannot be read.
 * That module is TypeScript behind the app's token resolver, so this script asks
 * the gh CLI (the operator's own login), like scripts/compliance-pr-verify.mjs.
 */
export function ghPrIsOpen(slug, num) {
  const r = spawnSync("gh", ["api", `repos/${slug}/pulls/${num}`, "--jq", ".state"], { encoding: "utf8" });
  const state = r.status === 0 ? String(r.stdout).trim() : "";
  return state === "open" ? true : state === "closed" ? false : null;
}

/** Open PRs from the event log, in first-seen order: [{repo, num, title, taskIds, lastEventAt}]. */
function openPrs(events) {
  const byPr = new Map();
  for (const ev of [...events].sort((a, b) => Number(a.seq) - Number(b.seq))) {
    const num = Number(ev.pr);
    if (!ev.repo || !Number.isInteger(num) || num <= 0) continue;
    const key = prKey(ev.repo, num);
    const pr = byPr.get(key) ?? { repo: ev.repo, num, title: "", taskIds: new Set(), open: false };
    byPr.set(key, pr);
    pr.lastEventAt = isoDay(ev.ts);
    if (!OPEN_KINDS.has(ev.kind)) {
      pr.open = false;
      pr.taskIds = new Set(); // a reopen names its tasks again
      continue;
    }
    pr.open = true;
    pr.repo = ev.repo;
    if (typeof ev.payload?.title === "string") pr.title = ev.payload.title;
    if (ev.task_id) pr.taskIds.add(ev.task_id);
    const listed = ev.payload?.taskIds;
    if (Array.isArray(listed)) for (const id of listed) if (typeof id === "string" && id) pr.taskIds.add(id);
  }
  return [...byPr.values()]
    .filter((pr) => pr.open)
    .map(({ repo, num, title, taskIds, lastEventAt }) => ({ repo, num, title, taskIds: [...taskIds], lastEventAt }));
}

/**
 * Pure planning. `tasks`: [{id, data}]; `events`: pr.* rows [{seq, ts, kind, repo, pr, task_id, payload}].
 * Returns { links: [{taskId, repo, num, status, title, lastEventAt}], skipped: [{taskId, repo, num, reason, lastEventAt}], unrouted }.
 * @param {Map<string, boolean | null> | null} [live] GitHub state per PR (open / closed / unknown);
 *   null plans from the event log alone, and runBackfill always passes it.
 */
export function planLinks(tasks, events, live = null) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const links = [];
  const skipped = [];
  let unrouted = 0;
  for (const pr of openPrs(events)) {
    if (pr.taskIds.length === 0) unrouted += 1;
    const state = live ? live.get(prKey(pr.repo, pr.num)) : true;
    const { lastEventAt } = pr;
    for (const taskId of pr.taskIds) {
      const task = byId.get(taskId);
      const reason =
        !task ? "task not found"
        : task.data?.stage === "cancelled" ? "task cancelled"
        : prsOf(task.data).some((p) => samePr(p, pr.repo, pr.num)) ? "already linked"
        : state === false ? "closed on GitHub"
        : state !== true ? "live state unknown"
        : null;
      if (reason) skipped.push({ taskId, repo: pr.repo, num: pr.num, reason, lastEventAt });
      else links.push({ taskId, repo: pr.repo, num: pr.num, status: "open", title: pr.title, lastEventAt });
    }
  }
  return { links, skipped, unrouted };
}

// Appends one PR row, re-checking in SQL that the task is not cancelled and does
// not already carry that repo + number, so a concurrent link is never doubled.
const LINK_SQL = `UPDATE entities
    SET data = jsonb_set(
          data, '{prs}',
          (CASE WHEN jsonb_typeof(data->'prs') = 'array' THEN data->'prs' ELSE '[]'::jsonb END) || $2::jsonb),
        updated_at = now()
  WHERE entity_type = 'task' AND id = $1
    AND data->>'stage' IS DISTINCT FROM 'cancelled'
    AND NOT EXISTS (
      SELECT 1
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(data->'prs') = 'array' THEN data->'prs' ELSE '[]'::jsonb END) AS p
       WHERE lower(p->>'repo') = lower($3) AND p->>'num' = $4)`;

/** `db` is anything with query(sql, params) -> {rows, rowCount} (a pg Client in production). */
export async function runBackfill(db, { apply = false, prIsOpen = ghPrIsOpen } = {}) {
  const events = (
    await db.query(
      `SELECT seq, ts, kind, repo, pr, task_id, payload FROM mc_events WHERE kind = ANY($1::text[]) AND pr IS NOT NULL ORDER BY seq`,
      [PR_KINDS]
    )
  ).rows;
  const taskIds = [...new Set(openPrs(events).flatMap((pr) => pr.taskIds))];
  const tasks = taskIds.length
    ? (await db.query(`SELECT id, data FROM entities WHERE entity_type = 'task' AND id = ANY($1::text[])`, [taskIds])).rows
    : [];
  // The registry's owner/name is the GitHub slug. Events carry the bare name, so
  // a name two owners share stays unknown rather than guessing the owner.
  const slugs = new Map();
  for (const r of (await db.query(`SELECT name, owner FROM repos`)).rows) {
    const name = String(r.name).toLowerCase();
    slugs.set(name, slugs.has(name) ? null : `${r.owner}/${r.name}`);
  }
  // GitHub is asked only about PRs that still have a task to link.
  const live = new Map();
  for (const l of planLinks(tasks, events).links) {
    const key = prKey(l.repo, l.num);
    if (live.has(key)) continue;
    const slug = slugs.get(l.repo.toLowerCase());
    live.set(key, slug ? await prIsOpen(slug, l.num) : null);
  }
  const plan = planLinks(tasks, events, live);

  let updated = 0;
  if (apply && plan.links.length > 0) {
    await db.query("BEGIN");
    try {
      for (const l of plan.links) {
        const row = { repo: l.repo, num: l.num, status: l.status, title: l.title };
        const res = await db.query(LINK_SQL, [l.taskId, JSON.stringify([row]), l.repo, String(l.num)]);
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
export async function runGuarded(db, { url, approvedDb, apply = false, env = process.env }) {
  await assertApprovedNonProdDb(db, url, approvedDb, env);
  return runBackfill(db, { apply });
}

export function formatReport(report, env) {
  const lines = [
    `open PR links backfill — env=${env} — ${report.apply ? "APPLY" : "DRY RUN"}`,
    `to link: ${report.links.length}`,
    ...report.links.map((l) => `  ${l.taskId} <- ${l.repo}#${l.num} (${l.status}, last event ${l.lastEventAt}) ${l.title}`),
    `skipped: ${report.skipped.length}`,
    ...report.skipped.map((s) => `  ${s.taskId} <- ${s.repo}#${s.num}: ${s.reason} (last event ${s.lastEventAt})`),
    `open PRs with no task: ${report.unrouted}`,
  ];
  lines.push(report.apply ? `rows updated: ${report.updated}` : "no rows written (pass --apply to write)");
  return lines.join("\n");
}

async function main(argv) {
  const apply = argv.includes("--apply");
  const envIdx = argv.indexOf("--env");
  const env = envIdx >= 0 ? argv[envIdx + 1] : undefined;
  if (env !== "uat" && env !== "staging") {
    console.error("--env uat|staging is required (a production backfill is a separate approved run).");
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
      console.error(`backfill failed: ${err.message}`);
      process.exit(1);
    }
  );
}
