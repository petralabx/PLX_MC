#!/usr/bin/env node
/**
 * Cut SharePoint sync refs from staging → production (or any new site).
 *
 * After provisioning a new Graph site and pointing
 * PLX_MC_SHAREPOINT_SITE_PATH at it, staging list-item IDs and delta cursors
 * are invalid. This script clears them so the next sweep re-creates mirrors
 * on the configured site (TaskID / Risk keys remain the join keys).
 *
 * Usage:
 *   node scripts/cutover-sharepoint-site.mjs              # dry-run
 *   node scripts/cutover-sharepoint-site.mjs --apply      # mutate
 *
 * Requires PLX_MC_DATABASE_URL. Never deletes SharePoint items (engine
 * never deletes SP items — TOOLS.md). Staging sandbox stays as-is.
 */
import { Client } from "pg";
import { resolveDbSsl } from "./lib/db-ssl.mjs";

const APPLY = process.argv.includes("--apply");

async function main() {
  const url = process.env.PLX_MC_DATABASE_URL;
  if (!url) {
    console.error("ERROR: PLX_MC_DATABASE_URL missing — run the secrets loader first");
    process.exit(1);
  }

  const client = new Client({
    connectionString: url,
    ssl: resolveDbSsl(),
  });
  await client.connect();

  const before = {};
  for (const table of ["entities", "buckets", "repos", "projects"]) {
    const r = await client.query(
      `SELECT count(*) FILTER (WHERE sp_item_id IS NOT NULL)::int AS with_sp,
              count(*)::int AS total
       FROM ${table}`
    );
    before[table] = r.rows[0];
  }
  const deltas = await client.query("SELECT list_key FROM delta_links ORDER BY list_key");
  before.delta_keys = deltas.rows.map((r) => r.list_key);

  console.log(`== cutover-sharepoint-site [${APPLY ? "APPLY" : "DRY-RUN"}] ==`);
  console.log("before:", JSON.stringify(before, null, 2));

  if (!APPLY) {
    console.log("\nDry-run only. Re-run with --apply to clear sp_item_id + delta_links.");
    await client.end();
    return;
  }

  await client.query("BEGIN");
  try {
    for (const table of ["entities", "buckets", "repos", "projects"]) {
      const r = await client.query(
        `UPDATE ${table}
         SET sp_item_id = NULL,
             sync_state = 'pending',
             updated_at = now()
         WHERE sp_item_id IS NOT NULL
         RETURNING id`
      );
      console.log(`  ${table}: cleared ${r.rowCount} sp_item_id row(s)`);
    }
    const d = await client.query(
      "DELETE FROM delta_links WHERE list_key IS NOT NULL RETURNING list_key"
    );
    console.log(`  delta_links: removed ${d.rowCount} cursor(s):`, d.rows.map((r) => r.list_key));
    await client.query(`INSERT INTO sync_audit_log (actor, body, state) VALUES ($1, $2, $3)`, [
      "cutover-sharepoint-site",
      "Cleared staging SharePoint item IDs + delta cursors for production site cutover (/sites/plx-mission-control).",
      "pending",
    ]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }

  console.log("\n== done [APPLY] — trigger a sync sweep next ==");
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
