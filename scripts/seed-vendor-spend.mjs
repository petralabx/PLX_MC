#!/usr/bin/env node
// Vendor-spend bootstrap — trigger a YTD API backfill for the automated
// vendors (AWS / Anthropic / Cursor) through the deployed app's CRON_SECRET
// refresh endpoint (GET /api/cron/vendor-spend-refresh?period=), so all adapter
// logic stays in the one domain module (src/lib/vendor-spend) instead of being
// re-implemented here. The session-gated POST /api/vendor-spend/refresh needs
// a signed-in admin, which a script does not have (TASK-3011).
//
// Env:  PLX_MC_BASE_URL   app origin (default http://localhost:3000)
//       CRON_SECRET       the app's cron bearer secret (required unless --dry-run)
// Usage: node scripts/seed-vendor-spend.mjs [--dry-run] [--period mtd|weekly|quarterly|ytd]
// Exit codes: 0 — refresh ran (degraded vendors reported, not fatal),
//             1 — endpoint unreachable or returned an error envelope.

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const periodIdx = args.indexOf("--period");
const period = periodIdx >= 0 ? args[periodIdx + 1] : "ytd";
const VALID_PERIODS = ["mtd", "weekly", "quarterly", "ytd"];

async function main() {
  if (!VALID_PERIODS.includes(period)) {
    console.error(`invalid --period "${period}" (expected ${VALID_PERIODS.join("|")})`);
    return 1;
  }

  const base = (process.env.PLX_MC_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const url = `${base}/api/cron/vendor-spend-refresh?period=${period}`;

  if (dryRun) {
    console.log(`dry-run: would GET ${url} with the CRON_SECRET bearer`);
    console.log("dry-run: automated vendors are pulled via their adapters; vendors with");
    console.log("dry-run: missing admin keys are logged as degraded (visible, never fabricated).");
    return 0;
  }

  if (!process.env.CRON_SECRET) {
    console.error("CRON_SECRET is not set — the refresh endpoint needs the app's cron bearer secret.");
    return 1;
  }

  let resp;
  try {
    resp = await fetch(url, {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
  } catch (err) {
    console.error(`refresh endpoint unreachable (${url}): ${err.message}`);
    console.error("start the app (npm run dev) or set PLX_MC_BASE_URL.");
    return 1;
  }

  const body = await resp.json().catch(() => null);
  if (!resp.ok || !body?.data) {
    console.error(`refresh failed: HTTP ${resp.status} — ${JSON.stringify(body?.error ?? body)}`);
    return 1;
  }

  for (const outcome of body.data.outcomes ?? []) {
    const detail = outcome.message ? ` — ${outcome.message}` : ` — ${outcome.snapshotCount} snapshot(s)`;
    console.log(`${outcome.status.padEnd(8)} ${outcome.vendorId}${detail}`);
  }
  console.log("seed complete. Degraded vendors need their admin keys added to AWS Secrets Manager (prod/ec2-secrets).");
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`seed failed: ${err.message}`);
    process.exit(1);
  }
);
