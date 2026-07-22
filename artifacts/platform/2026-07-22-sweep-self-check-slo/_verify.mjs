#!/usr/bin/env node
/**
 * Verify TASK-498 measurement bundle: counts, window, sanitized fields, percentile recompute.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { summarizeLatencies } from "./percentiles.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadJson(name) {
  return JSON.parse(readFileSync(join(__dirname, name), "utf8"));
}

function assert(condition, message) {
  if (!condition) {
    console.error(`verify: FAIL ${message}`);
    process.exit(1);
  }
}

function assertSanitizedSample(sample, label) {
  const keys = Object.keys(sample).sort();
  assert(
    keys.join(",") === "durationMs,offsetMs,status,timestamp",
    `${label} sample has unexpected keys: ${keys.join(",")}`
  );
  assert(typeof sample.timestamp === "string", `${label} timestamp must be string`);
  assert(Number.isInteger(sample.status), `${label} status must be integer`);
  assert(Number.isInteger(sample.durationMs), `${label} durationMs must be integer`);
  assert(sample.durationMs >= 0, `${label} durationMs must be non-negative`);
}

function assertNoSecretPatterns(jsonText, label) {
  const forbidden = [
    /Bearer\s+\S+/i,
    /x-api-key/i,
    /CRON_SECRET/i,
    /MC_MCP_API_KEY/i,
    /authorization/i,
  ];
  for (const pattern of forbidden) {
    assert(!pattern.test(jsonText), `${label} contains forbidden pattern ${pattern}`);
  }
}

function recomputeAndMatch(stored, durations, label) {
  const recomputed = summarizeLatencies(durations);
  assert(recomputed.count === stored.count, `${label} count mismatch`);
  assert(recomputed.p50Ms === stored.p50Ms, `${label} p50 mismatch stored=${stored.p50Ms} recomputed=${recomputed.p50Ms}`);
  assert(recomputed.p95Ms === stored.p95Ms, `${label} p95 mismatch stored=${stored.p95Ms} recomputed=${recomputed.p95Ms}`);
  assert(recomputed.minMs === stored.minMs, `${label} min mismatch`);
  assert(recomputed.maxMs === stored.maxMs, `${label} max mismatch`);
}

function main() {
  const meta = loadJson("meta.json");
  const sweep = loadJson("sweep-samples.json");
  const selfCheck = loadJson("self-check-samples.json");
  const summary = loadJson("summary.json");
  const measureSource = readFileSync(join(__dirname, "measure.mjs"), "utf8");

  for (const file of ["meta.json", "sweep-samples.json", "self-check-samples.json", "summary.json"]) {
    assertNoSecretPatterns(readFileSync(join(__dirname, file), "utf8"), file);
  }
  assert(
    !/["']--token["']/.test(measureSource),
    "measure.mjs must inherit VERCEL_TOKEN; do not put --token on the command line"
  );

  assert(meta.sweep.count === 12, "meta sweep count must be 12");
  assert(meta.selfCheck.count === 30, "meta selfCheck count must be 30");
  assert(meta.windowMs >= 55 * 60 * 1000, "window must be >= 55 minutes");
  assert(
    meta.sweepTransport === "direct-bearer" ||
      meta.sweepTransport === "vercel-crons-run" ||
      meta.sweepTransport === "vercel-trigger-self-check-completion",
    "meta sweepTransport must be documented"
  );
  if (meta.sweepTransport === "vercel-trigger-self-check-completion") {
    assert(
      sweep.statusMeaning ===
        "HTTP response status from the self-check observation that first showed inbound freshness advance; not the sweep route response",
      "proxy sweep status must not be represented as the sweep route HTTP status"
    );
  }
  assert(
    selfCheck.statusMeaning === "HTTP response status from direct GET /api/cursor/self-check",
    "self-check status meaning"
  );

  assert(sweep.samples.length === 12, "sweep sample count");
  assert(selfCheck.samples.length === 30, "self-check sample count");

  for (const s of sweep.samples) assertSanitizedSample(s, "sweep");
  for (const s of selfCheck.samples) assertSanitizedSample(s, "self-check");

  for (const s of [...sweep.samples, ...selfCheck.samples]) {
    assert(s.status >= 200 && s.status < 300, `non-2xx sample status=${s.status}`);
  }

  const sweepOffsets = sweep.samples.map((s) => s.offsetMs).sort((a, b) => a - b);
  for (let i = 1; i < sweepOffsets.length; i += 1) {
    const gap = sweepOffsets[i] - sweepOffsets[i - 1];
    assert(gap >= 5 * 60 * 1000 - 1000, `sweep spacing too tight at index ${i}: ${gap}ms`);
  }

  assert(summary.window.targetMs >= 55 * 60 * 1000, "summary window target");
  assert(summary.window.actualMs >= 55 * 60 * 1000 - 5000, "summary actual window");

  recomputeAndMatch(
    summary.sweep,
    sweep.samples.map((s) => s.durationMs),
    "sweep"
  );
  recomputeAndMatch(
    summary.selfCheck,
    selfCheck.samples.map((s) => s.durationMs),
    "self-check"
  );

  console.log("verify: PASS counts window sanitization percentile recompute");
}

main();
