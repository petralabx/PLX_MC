#!/usr/bin/env node
// Submit the frontier-phase operational follow-ups (PR #160) as MC tasks via
// the sanctioned mc_create_task door (POST /api/cursor/tasks). Idempotent:
// each definition is looked up by exact title in its bucket first and skipped
// when it already exists, so re-runs never duplicate. Buckets carry the
// project attachment in MC (BKT-FRONTIER-* → the frontier project).
//
// Usage (any box with the MCP credential loaded):
//   PLX_MC_MCP_API_KEY=... node scripts/create-frontier-followup-tasks.mjs \
//     [--dry-run] [--operator you@petrasoap.com]
//
// Env: PLX_MC_MCP_API_KEY (required unless --dry-run), MC_BASE_URL
// (default https://mc.plxcustomer.io), MC_OPERATOR_EMAIL.
// Exit codes: 0 = all created/skipped, 1 = any failure, 2 = not configured.

const BASE_URL = (process.env.MC_BASE_URL ?? "https://mc.plxcustomer.io").replace(/\/$/, "");

export const FOLLOWUP_TASKS = [
  {
    bucket: "BKT-FRONTIER-P1-IDENTITY",
    title: "Seed mc_users and enable permissions log-only mode in production",
    priority: "high",
    description:
      "Stage 1 of docs/runbooks/permissions-enforcement-rollout.md: apply migrations 022/023 (npm run migrate), seed mc_users for every allowlisted operator (entra_oid, email, access_role), then set PLX_MC_PERMISSIONS_ENFORCEMENT_MODE=log-only on Vercel. Done-when: permissions_decision_log accumulates enforcement_mode='log-only' rows for a week with zero reported behavior change.",
  },
  {
    bucket: "BKT-FRONTIER-P1-IDENTITY",
    title: "Advance permissions enforcement log-only -> review -> enforce",
    priority: "high",
    description:
      "Stages 2-3 of the rollout runbook: clear all shadow_allowed=false rows for legitimate traffic, flip to review (service principals fail closed), soak a week, then enforce. Done-when: PLX_MC_PERMISSIONS_ENFORCEMENT_MODE=enforce in production and denials are only genuinely unauthorized attempts.",
  },
  {
    bucket: "BKT-FRONTIER-P1-IDENTITY",
    title: "Mint per-agent MCP keys and retire the shared sp_mcp_cursor key",
    priority: "high",
    description:
      "Generate distinct keys for sp_mcp_claude_code / sp_mcp_codex / sp_mcp_swarm, store as PLX_MC_MCP_AGENT_KEYS (JSON map) in Secrets Manager + Vercel, update each runtime's credential, then set PLX_MC_MCP_SHARED_KEY_ENABLED=0. Done-when: every agent runtime authenticates as its own principal and the legacy shared key is rejected (401).",
  },
  {
    bucket: "BKT-FRONTIER-P1-IDENTITY",
    title: "Grant Sites.Selected and retire Sites.ReadWrite.All on the Graph app",
    priority: "high",
    description:
      "Follow docs/runbooks/graph-least-privilege.md: add Sites.Selected + per-site write grant on /sites/plx-mission-control, verify sweep + subscription create/renew on staging with both roles, remove Sites.ReadWrite.All, re-consent, then move it to forbiddenRoles in config/graph-app-permissions.json. Done-when: node scripts/audit-graph-app-permissions.mjs exits 0 with no transitional warnings (retire-by 2026-08-21).",
  },
  {
    bucket: "BKT-FRONTIER-P2-RELIABILITY",
    title: "Apply migration 024 and verify the outbound push retry ledger in production",
    priority: "high",
    description:
      "Run npm run migrate against production (022-024 additive/idempotent), confirm outbound_push_retries exists, and watch one sweep cycle. Done-when: schema_migrations lists 022/023/024 and a forced transient failure defers (audit row 'Push deferred ... retrying with backoff') instead of aborting the sweep.",
  },
  {
    bucket: "BKT-FRONTIER-P2-RELIABILITY",
    title: "Configure PLX_MC_CRON_SECRET repo secret to arm the sweep-redundancy workflow",
    priority: "medium",
    description:
      "Add the GitHub Actions repo secret PLX_MC_CRON_SECRET (same value as Vercel CRON_SECRET). Done-when: a sweep-redundancy workflow run reports HTTP 200 from GET /api/cron/sweep, giving the sweep a second scheduler independent of Vercel Cron.",
  },
  {
    bucket: "BKT-FRONTIER-P2-RELIABILITY",
    title: "Set PLX_MC_ALERT_WEBHOOK_URL for missed-tick alerting",
    priority: "medium",
    description:
      "Point the missed-tick watchdog at an operator channel webhook (Slack-compatible {text} POST). Done-when: pausing the sweep >15 min in staging produces exactly one deduped sync.missed_tick mc_events row per hour plus one webhook message.",
  },
  {
    bucket: "BKT-FRONTIER-P3-FRESHNESS",
    title: "P11 go-live: enable webhook env and flip live Graph subscriptions",
    priority: "medium",
    description:
      "Set PLX_MC_GRAPH_WEBHOOK_ENABLED=1, PLX_MC_GRAPH_WEBHOOK_CLIENT_STATE, PLX_MC_GRAPH_NOTIFICATION_URL=https://mc.plxcustomer.io/api/sync/webhook, then PLX_MC_GRAPH_SUBSCRIPTIONS_LIVE=1 once the mirror-is-boring gate is met (runtime-checked). Done-when: sync-subscriptions cron reports live=true, sub_local_* placeholders replaced by real Graph subscriptions, and a SharePoint edit reaches the UI in <60s via the inline drain.",
  },
  {
    bucket: "BKT-FRONTIER-P3-FRESHNESS",
    title: "Enable the Project Documents mirror after staging verification",
    priority: "medium",
    description:
      "Verify the Project Documents drive delta against the staging site (PLX_MC_SHAREPOINT_SITE_PATH override), then set PLX_MC_DOCUMENTS_SYNC_ENABLED=1 in production. Done-when: file entities mirror library items on the sweep and deletions appear as audit rows only (mirror never deletes).",
  },
  {
    bucket: "BKT-FRONTIER-P5-EVAL-LOOP",
    title: "Wire agent runtimes to report session telemetry at close",
    priority: "medium",
    description:
      "Add an mc_report_session_telemetry call (POST /api/cursor/session-telemetry: sessionId, tokensIn/Out, costCents, checkoutId) to each runtime's session-close hook (Cursor sessionEnd hook, Claude Code/Codex wrappers). Done-when: GET /api/agent-metrics shows telemetry sessions accumulating per runtime and mc_suggest_work envelopes carry non-null outcomes.",
  },
];

function args() {
  const argv = process.argv.slice(2);
  return {
    dryRun: argv.includes("--dry-run"),
    operator:
      argv.includes("--operator")
        ? argv[argv.indexOf("--operator") + 1]
        : process.env.MC_OPERATOR_EMAIL ?? "vince@petrasoap.com",
  };
}

function headers(apiKey, operator) {
  return {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "x-mc-operator-email": operator,
    "x-mc-repo": "petralabx/PLX_MC",
    "x-mc-runtime": "claude-code",
    "x-mc-worker-id": "frontier-followups",
  };
}

async function existsByTitle(apiKey, operator, task) {
  const url = `${BASE_URL}/api/cursor/tasks?bucket=${encodeURIComponent(task.bucket)}&q=${encodeURIComponent(task.title)}`;
  const resp = await fetch(url, { headers: headers(apiKey, operator) });
  if (!resp.ok) return false; // fail open on search — create path still dedups by review
  const body = await resp.json();
  const tasks = body?.data?.tasks ?? body?.data ?? [];
  return (
    Array.isArray(tasks) &&
    tasks.some((t) => (t.title ?? "").trim().toLowerCase() === task.title.toLowerCase())
  );
}

async function createTask(apiKey, operator, task) {
  const resp = await fetch(`${BASE_URL}/api/cursor/tasks`, {
    method: "POST",
    headers: headers(apiKey, operator),
    body: JSON.stringify({
      title: task.title,
      description: task.description,
      bucket: task.bucket,
      stage: "backlog",
      priority: task.priority,
      accountableOwner: "cos@petrasoap.com",
    }),
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`${resp.status} ${body?.error?.code ?? ""} ${body?.error?.message ?? ""}`.trim());
  }
  return body?.data?.taskId ?? "(unknown id)";
}

async function main() {
  const { dryRun, operator } = args();
  if (dryRun) {
    for (const t of FOLLOWUP_TASKS) console.log(`[dry-run] ${t.bucket} · ${t.title}`);
    console.log(`[dry-run] ${FOLLOWUP_TASKS.length} follow-up tasks defined.`);
    return;
  }
  const apiKey = (process.env.PLX_MC_MCP_API_KEY ?? "").trim();
  if (!apiKey) {
    console.error("PLX_MC_MCP_API_KEY is not set — load the MCP credential first (see TOOLS.md).");
    process.exit(2);
  }
  let failed = 0;
  for (const task of FOLLOWUP_TASKS) {
    try {
      if (await existsByTitle(apiKey, operator, task)) {
        console.log(`skip (exists)  ${task.bucket} · ${task.title}`);
        continue;
      }
      const id = await createTask(apiKey, operator, task);
      console.log(`created ${id}  ${task.bucket} · ${task.title}`);
    } catch (err) {
      failed += 1;
      console.error(`FAILED  ${task.bucket} · ${task.title} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (failed > 0) process.exit(1);
  console.log("All follow-up tasks created or already present.");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  main();
}
