// Docker-backed routing schema contracts. Spawns the disposable harness
// script; never targets staging/production URLs.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const harness = path.join(root, "scripts", "test-routing-postgres.mjs");

function runHarness(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [harness, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 180_000,
  });
}

function routingContainers(): string {
  return spawnSync(
    "docker",
    [
      "ps",
      "-a",
      "--filter",
      "name=plx-mc-routing-pg-",
      "--format",
      "{{.Names}}",
    ],
    { cwd: root, encoding: "utf8" }
  ).stdout.trim();
}

describe("routing postgres harness", () => {
  it("applies additive migrations through 018 with schema/idempotency/sequence checks", () => {
    const result = runHarness(["--through", "018", "--schema", "--idempotency", "--sequence"]);
    if (result.status !== 0) {
      // Surface harness output for RED diagnosis without swallowing it.
      console.error(result.stdout);
      console.error(result.stderr);
    }
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/migrations complete|applied through 018/i);
    expect(result.stdout).toMatch(/empty database allocated TASK-1/i);
    expect(result.stdout + result.stderr).toMatch(/cleanup|removed container/i);
    expect(routingContainers()).toBe("");
  }, 180_000);

  it("allocates distinct sequence values in overlapping independent transactions", () => {
    const result = runHarness(["--through", "018", "--concurrency"]);
    if (result.status !== 0) {
      console.error(result.stdout);
      console.error(result.stderr);
    }
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/overlapping transaction concurrency assertions passed/i);
    expect(routingContainers()).toBe("");
  }, 180_000);

  it("atomically recovers missing candidates and serializes same-head replay", () => {
    const result = runHarness(["--through", "018", "--revision-atomicity"]);
    if (result.status !== 0) {
      console.error(result.stdout);
      console.error(result.stderr);
    }
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/revision atomicity assertions passed/i);
    expect(routingContainers()).toBe("");
  }, 180_000);

  it("refuses configured staging/production database URLs", () => {
    const result = runHarness(["--through", "018"], {
      PLX_MC_DATABASE_URL:
        "postgres://plx_mc_app:x@plx-postgres-staging.example:5432/plx_mc?sslmode=require",
      ROUTING_TEST_FORCE_ENV_URL: "1",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(/refus|staging|production|forbidden/i);
  });
});
