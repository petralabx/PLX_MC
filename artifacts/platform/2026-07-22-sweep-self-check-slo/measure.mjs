#!/usr/bin/env node
/**
 * Sequential production latency sampler for TASK-498 (measurement-only).
 *
 * - Concurrency 1; exits on first failed observation (auth denial is a hard stop).
 * - Never logs auth material, request/response bodies, or env values.
 * - Writes sanitized samples: timestamp, observer status, durationMs only.
 *
 * Sweep duration:
 *   1) direct GET /api/cron/sweep when bearer auth succeeds, else
 *   2) authorized `vercel crons run /api/cron/sweep` plus self-check freshness
 *      completion polling (external bearer returned 401 from workstation).
 *
 * Env (required):
 *   MC_MCP_API_KEY, MC_OPERATOR_EMAIL, VERCEL_TOKEN
 * Optional: CRON_SECRET, MC_BASE_URL, MC_REPO, MC_RUNTIME, MC_WORKER_ID, VERCEL_SCOPE
 */

import { exec } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { summarizeLatencies } from "./percentiles.mjs";

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");

const BASE_URL = (process.env.MC_BASE_URL ?? "https://mc.plxcustomer.io").replace(/\/$/, "");
const REPO = process.env.MC_REPO ?? "petralabx/PLX_MC";
const RUNTIME = process.env.MC_RUNTIME ?? "slo-baseline-measure";
const WORKER_ID = process.env.MC_WORKER_ID ?? "task-498";
const VERCEL_SCOPE = process.env.VERCEL_SCOPE ?? "petralabx";

const SWEEP_COUNT = 12;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const SELF_CHECK_COUNT = 30;
const WINDOW_MS = 55 * 60 * 1000;
const SWEEP_COMPLETION_TIMEOUT_MS = 120 * 1000;
const SWEEP_COMPLETION_POLL_MS = 2000;

function requireEnv(name) {
  const value = (process.env[name] ?? "").trim();
  if (!value) {
    console.error(`measure: missing required env ${name} (value not printed)`);
    process.exit(2);
  }
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function selfCheckHeaders(apiKey, operatorEmail) {
  return {
    "x-api-key": apiKey,
    "x-mc-operator-email": operatorEmail,
    "x-mc-repo": REPO,
    "x-mc-runtime": RUNTIME,
    "x-mc-worker-id": WORKER_ID,
  };
}

async function timedFetch(url, init) {
  const started = performance.now();
  let res;
  try {
    res = await fetch(url, init);
  } catch {
    const durationMs = Math.round(performance.now() - started);
    console.error(`measure: network error status=0 durationMs=${durationMs}`);
    process.exit(1);
  }
  const durationMs = Math.round(performance.now() - started);
  return { status: res.status, durationMs, response: res };
}

async function fetchSelfCheck(apiKey, operatorEmail) {
  const started = performance.now();
  let res;
  try {
    res = await fetch(`${BASE_URL}/api/cursor/self-check`, {
      method: "GET",
      headers: selfCheckHeaders(apiKey, operatorEmail),
    });
  } catch {
    return { status: 0, durationMs: Math.round(performance.now() - started), data: null };
  }
  const durationMs = Math.round(performance.now() - started);
  if (!res.ok) return { status: res.status, durationMs, data: null };
  let body;
  try {
    body = await res.json();
  } catch {
    return { status: res.status, durationMs, data: null };
  }
  return { status: res.status, durationMs, data: body?.data ?? null };
}

function inboundWatermark(data) {
  const registers = data?.freshness?.registers ?? [];
  let max = 0;
  for (const register of registers) {
    const ts = Date.parse(register.lastCompleteInboundAt ?? "");
    if (Number.isFinite(ts) && ts > max) max = ts;
  }
  return max;
}

async function triggerSweepCron() {
  const args = [
    "crons",
    "run",
    "/api/cron/sweep",
    "--scope",
    VERCEL_SCOPE,
  ];
  const cmd = `vercel ${args.map((part) => (/\s/.test(part) ? `"${part}"` : part)).join(" ")}`;
  const { stdout, stderr } = await execAsync(cmd, {
    encoding: "utf8",
    env: process.env,
    cwd: REPO_ROOT,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  const combined = `${stdout}\n${stderr}`;
  if (!/Cron job \/api\/cron\/sweep triggered/i.test(combined)) {
    throw new Error("vercel crons run did not confirm sweep trigger");
  }
}

async function probeSweepBearer(cronSecret) {
  const result = await timedFetch(`${BASE_URL}/api/cron/sweep`, {
    method: "GET",
    headers: { authorization: `Bearer ${cronSecret}` },
  });
  return result.status >= 200 && result.status < 300;
}

async function sampleSweepDirect(cronSecret) {
  const result = await timedFetch(`${BASE_URL}/api/cron/sweep`, {
    method: "GET",
    headers: { authorization: `Bearer ${cronSecret}` },
  });
  return { status: result.status, durationMs: result.durationMs };
}

async function sampleSweepViaVercelCompletion(apiKey, operatorEmail) {
  const baseline = await fetchSelfCheck(apiKey, operatorEmail);
  if (baseline.status < 200 || baseline.status >= 300) {
    return { status: baseline.status || 500, durationMs: baseline.durationMs };
  }
  const before = inboundWatermark(baseline.data);

  const triggerStart = Date.now();
  try {
    await triggerSweepCron();
  } catch {
    return {
      status: 500,
      durationMs: Date.now() - triggerStart,
    };
  }

  const deadline = triggerStart + SWEEP_COMPLETION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(SWEEP_COMPLETION_POLL_MS);
    const snap = await fetchSelfCheck(apiKey, operatorEmail);
    if (snap.status < 200 || snap.status >= 300) {
      return { status: snap.status || 500, durationMs: Date.now() - triggerStart };
    }
    if (inboundWatermark(snap.data) > before) {
      return { status: snap.status, durationMs: Date.now() - triggerStart };
    }
  }

  return { status: 504, durationMs: Date.now() - triggerStart };
}

async function resolveSweepTransport(cronSecret, apiKey, operatorEmail) {
  if (cronSecret && (await probeSweepBearer(cronSecret))) {
    return {
      mode: "direct-bearer",
      sample: () => sampleSweepDirect(cronSecret),
    };
  }

  console.log(
    "measure: direct sweep bearer unavailable; using vercel trigger + self-check completion"
  );
  const probe = await sampleSweepViaVercelCompletion(apiKey, operatorEmail);
  if (probe.status < 200 || probe.status >= 300) {
    console.error(`measure: hard stop — sweep probe failed status=${probe.status}`);
    process.exit(1);
  }

  return {
    mode: "vercel-trigger-self-check-completion",
    sample: () => sampleSweepViaVercelCompletion(apiKey, operatorEmail),
  };
}

async function sampleSelfCheck(apiKey, operatorEmail) {
  const snap = await fetchSelfCheck(apiKey, operatorEmail);
  return { status: snap.status, durationMs: snap.durationMs };
}

function recordSample(samples, endpoint, offsetMs, result) {
  const entry = {
    timestamp: new Date().toISOString(),
    offsetMs,
    status: result.status,
    durationMs: result.durationMs,
  };
  samples.push(entry);
  console.log(
    `measure: endpoint=${endpoint} offsetMs=${offsetMs} status=${result.status} durationMs=${result.durationMs}`
  );
  if (result.status < 200 || result.status >= 300) {
    console.error(`measure: hard stop on first non-2xx endpoint=${endpoint} status=${result.status}`);
    process.exit(1);
  }
  return entry;
}

function evenlySpacedOffsets(count, windowMs) {
  if (count <= 1) return [0];
  const step = windowMs / (count - 1);
  return Array.from({ length: count }, (_, i) => Math.round(i * step));
}

function buildSchedule() {
  const sweepOffsets = Array.from({ length: SWEEP_COUNT }, (_, i) => i * SWEEP_INTERVAL_MS);
  const selfCheckOffsets = evenlySpacedOffsets(SELF_CHECK_COUNT, WINDOW_MS);
  const events = [
    ...sweepOffsets.map((offsetMs) => ({ endpoint: "sweep", offsetMs })),
    ...selfCheckOffsets.map((offsetMs) => ({ endpoint: "self-check", offsetMs })),
  ];
  events.sort((a, b) => a.offsetMs - b.offsetMs || (a.endpoint === "sweep" ? -1 : 1));
  return events;
}

function writeJson(name, payload) {
  writeFileSync(join(__dirname, name), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function main() {
  const apiKey = requireEnv("MC_MCP_API_KEY");
  const operatorEmail = requireEnv("MC_OPERATOR_EMAIL");
  requireEnv("VERCEL_TOKEN");
  const cronSecret = (process.env.CRON_SECRET ?? "").trim();

  const sweepTransport = await resolveSweepTransport(cronSecret, apiKey, operatorEmail);

  const schedule = buildSchedule();
  const windowEndMs = Math.max((SWEEP_COUNT - 1) * SWEEP_INTERVAL_MS, WINDOW_MS);

  const meta = {
    baseUrl: BASE_URL,
    method: "sequential, concurrency 1, exit on first failed observation",
    sweepTransport: sweepTransport.mode,
    sweepDurationDefinition:
      sweepTransport.mode === "direct-bearer"
        ? "GET /api/cron/sweep wall time"
        : "vercel crons run trigger through self-check inbound freshness advance",
    windowMs: windowEndMs,
    windowMinutes: Math.round((windowEndMs / 60000) * 10) / 10,
    sweep: { count: SWEEP_COUNT, intervalMs: SWEEP_INTERVAL_MS },
    selfCheck: { count: SELF_CHECK_COUNT, distribution: "even across window" },
    scheduledEvents: schedule.length,
    startedAt: new Date().toISOString(),
  };

  console.log(
    `measure: starting windowMs=${meta.windowMs} sweepTransport=${meta.sweepTransport} events=${schedule.length}`
  );

  const sweepSamples = [];
  const selfCheckSamples = [];
  const windowStart = Date.now();

  for (const event of schedule) {
    const targetAt = windowStart + event.offsetMs;
    const waitMs = targetAt - Date.now();
    if (waitMs > 0) await sleep(waitMs);

    if (event.endpoint === "sweep") {
      recordSample(sweepSamples, "sweep", event.offsetMs, await sweepTransport.sample());
    } else {
      recordSample(
        selfCheckSamples,
        "self-check",
        event.offsetMs,
        await sampleSelfCheck(apiKey, operatorEmail)
      );
    }
  }

  const finishedAt = new Date().toISOString();
  meta.finishedAt = finishedAt;
  meta.actualWindowMs = Date.now() - windowStart;

  const sweepSummary = summarizeLatencies(sweepSamples.map((s) => s.durationMs));
  const selfCheckSummary = summarizeLatencies(selfCheckSamples.map((s) => s.durationMs));

  writeJson("meta.json", meta);
  writeJson("sweep-samples.json", {
    signal: "sweep-completion",
    statusMeaning:
      sweepTransport.mode === "direct-bearer"
        ? "HTTP response status from direct GET /api/cron/sweep"
        : "HTTP response status from the self-check observation that first showed inbound freshness advance; not the sweep route response",
    samples: sweepSamples,
  });
  writeJson("self-check-samples.json", {
    endpoint: "/api/cursor/self-check",
    statusMeaning: "HTTP response status from direct GET /api/cursor/self-check",
    samples: selfCheckSamples,
  });
  writeJson("summary.json", {
    window: {
      targetMs: windowEndMs,
      actualMs: meta.actualWindowMs,
      startedAt: meta.startedAt,
      finishedAt,
    },
    sweep: sweepSummary,
    selfCheck: selfCheckSummary,
    percentileMethod: "nearest-rank on ascending durations",
  });

  console.log(
    `measure: complete sweep p50=${sweepSummary.p50Ms} p95=${sweepSummary.p95Ms} self-check p50=${selfCheckSummary.p50Ms} p95=${selfCheckSummary.p95Ms}`
  );
}

main().catch((err) => {
  console.error(`measure: fatal ${err?.message ?? err}`);
  process.exit(1);
});
