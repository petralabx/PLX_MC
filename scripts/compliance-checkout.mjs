#!/usr/bin/env node
// EN-007 capture hook (P3). At an agent run's start, claim an MC task (checkout)
// and emit the PR-body stamp line the gate reads ("MC-Checkout: <id>"), so the
// PR resolves to an agent + task without trusting git metadata (decision 9).
//
// DEFAULT-OFF: does nothing unless COMPLIANCE_CAPTURE=1. Operator-local tooling —
// never auto-enabled (governance: integrations that can act ship disabled).
//
// Env: MC_BASE_URL, MC_TASK_ID, MC_ACCOUNTABLE, MC_REPO, [MC_RUNTIME].

function fail(msg) {
  console.error(`[compliance-capture] ${msg}`);
  process.exit(1);
}

if (process.env.COMPLIANCE_CAPTURE !== "1") {
  console.log("[compliance-capture] disabled (set COMPLIANCE_CAPTURE=1 to enable)");
  process.exit(0);
}

const base = process.env.MC_BASE_URL;
const taskId = process.env.MC_TASK_ID;
const accountableHuman = process.env.MC_ACCOUNTABLE;
const repo = process.env.MC_REPO;
const runtime = process.env.MC_RUNTIME || "cursor";

if (!base) fail("MC_BASE_URL not set");
if (!taskId) fail("MC_TASK_ID not set");
if (!accountableHuman) fail("MC_ACCOUNTABLE not set");
if (!repo) fail("MC_REPO not set");

const res = await fetch(`${base.replace(/\/$/, "")}/api/compliance/checkout`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ taskId, runtime, accountableHuman, repo }),
});

if (!res.ok) fail(`checkout failed: HTTP ${res.status}`);

const json = await res.json();
const checkoutId = json?.data?.checkoutId;
if (!checkoutId) fail("no checkoutId in response");

console.log(`[compliance-capture] checked out ${taskId} → ${checkoutId}`);
// The caller appends this line to the PR body; the gate + webhook read it.
console.log(`MC-Checkout: ${checkoutId}`);
