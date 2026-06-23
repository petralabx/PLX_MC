#!/usr/bin/env node
// EN-007 capture hook (P3). At an agent run's start, resolve the work to MC
// task(s) — check out the given task(s), or AUTO-CREATE one when none is supplied
// — and emit one PR-body stamp line per task ("MC-Checkout: <id>") that the gate
// reads, so the PR resolves to an agent + its task(s) without trusting git
// metadata (decision 9). Supports MULTIPLE tasks per run (one logical theme, N
// related tasks → N stamps; the gate verifies every one).
//
// DEFAULT-OFF: does nothing unless COMPLIANCE_CAPTURE=1. Operator-local tooling —
// never auto-enabled (governance: integrations that can act ship disabled).
//
// Env:
//   COMPLIANCE_CAPTURE=1   enable (else no-op)
//   MC_BASE_URL            PLX MC base URL (required when enabled)
//   MC_ACCOUNTABLE         accountable human (required)
//   MC_REPO                repo the work targets (required)
//   MC_TASK_ID             one or more task ids, comma/space separated. If empty,
//                          a task is auto-created (needs MC_TASK_TITLE + MC_BUCKET).
//   MC_TASK_TITLE          title for an auto-created task (when MC_TASK_ID is empty)
//   MC_BUCKET              bucket id for an auto-created task
//   MC_REPORTER            reporter for an auto-created task (default: MC_ACCOUNTABLE)
//   MC_RUNTIME             runtime label (default: cursor)
//   MC_BASIC_AUTH          optional "user:pass" for the staging access gate
//
// checkout + tasks are session-gated (src/middleware.ts) — they do not
// self-authenticate. Against a gated instance set MC_BASIC_AUTH (break-glass);
// local/open dev needs none.

/**
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   fetch?: typeof globalThis.fetch,
 *   log?: (msg: string) => void,
 * }} [opts]
 */
export async function capture({ env = process.env, fetch = globalThis.fetch, log = console.log } = {}) {
  if (env.COMPLIANCE_CAPTURE !== "1") {
    log("[compliance-capture] disabled (set COMPLIANCE_CAPTURE=1 to enable)");
    return { enabled: false, created: [], stamps: [], taskIds: [] };
  }

  const base = env.MC_BASE_URL;
  const accountableHuman = env.MC_ACCOUNTABLE;
  const repo = env.MC_REPO;
  const runtime = env.MC_RUNTIME || "cursor";
  if (!base) throw new Error("MC_BASE_URL not set");
  if (!accountableHuman) throw new Error("MC_ACCOUNTABLE not set");
  if (!repo) throw new Error("MC_REPO not set");

  const url = (p) => `${base.replace(/\/$/, "")}${p}`;
  const headers = { "content-type": "application/json" };
  if (env.MC_BASIC_AUTH) {
    headers.authorization = `Basic ${Buffer.from(env.MC_BASIC_AUTH).toString("base64")}`;
  }

  // Resolve the task id list: explicit MC_TASK_ID(s), else auto-create one.
  let taskIds = (env.MC_TASK_ID || "").split(/[\s,]+/).filter(Boolean);
  const created = [];
  if (taskIds.length === 0) {
    const title = env.MC_TASK_TITLE;
    const bucket = env.MC_BUCKET;
    if (!title) throw new Error("no MC_TASK_ID and no MC_TASK_TITLE to auto-create a task");
    if (!bucket) throw new Error("auto-create needs MC_BUCKET");
    const res = await fetch(url("/api/tasks"), {
      method: "POST",
      headers,
      body: JSON.stringify({
        title,
        bucket,
        reporter: env.MC_REPORTER || accountableHuman,
        accountableOwner: accountableHuman,
      }),
    });
    if (!res.ok) throw new Error(`task create failed: HTTP ${res.status}`);
    const json = await res.json();
    const id = json?.data?.id;
    if (!id) throw new Error("no task id in create response");
    log(`[compliance-capture] auto-created ${id} (${title})`);
    taskIds = [id];
    created.push(id);
  }

  // Check out each task and emit its stamp. The caller appends these lines to the
  // PR body; the gate + webhook read every one (multi-task verify).
  const stamps = [];
  for (const taskId of taskIds) {
    const res = await fetch(url("/api/compliance/checkout"), {
      method: "POST",
      headers,
      body: JSON.stringify({ taskId, runtime, accountableHuman, repo }),
    });
    if (!res.ok) throw new Error(`checkout failed for ${taskId}: HTTP ${res.status}`);
    const json = await res.json();
    const checkoutId = json?.data?.checkoutId;
    if (!checkoutId) throw new Error(`no checkoutId for ${taskId}`);
    log(`[compliance-capture] checked out ${taskId} → ${checkoutId}`);
    log(`MC-Checkout: ${checkoutId}`);
    stamps.push(checkoutId);
  }

  return { enabled: true, created, stamps, taskIds };
}

// Run when invoked as a CLI (the hook), not when imported by a test.
if (import.meta.url === `file://${process.argv[1]}`) {
  capture().catch((e) => {
    console.error(`[compliance-capture] ${e.message}`);
    process.exit(1);
  });
}
