#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

const port = Number(process.env.PLX_MC_E2E_PORT ?? 3931);
const host = process.env.PLX_MC_E2E_HOST ?? "localhost";
const baseUrl = `http://${host}:${port}`;
const root = process.cwd();

const server = spawn(
  process.execPath,
  [path.join(root, "node_modules", "next", "dist", "bin", "next"), "dev"],
  {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      PLX_MC_SYNC_ENABLED: "",
      PLX_MC_AUTH_CLIENT_ID: "",
      PLX_MC_AUTH_CLIENT_SECRET: "",
      PLX_MC_STAGING_PASSWORD: "",
      PLX_MC_DATABASE_URL: "",
      PLX_MC_ROUTING_INBOX_ENABLED: "1",
      NEXT_PUBLIC_PLX_MC_ROUTING_INBOX_ENABLED: "1",
    },
    stdio: "inherit",
  }
);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const exited = (child) =>
  new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));

async function waitForServer() {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Next dev server exited before readiness (code ${server.exitCode})`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await delay(250);
  }
  throw new Error(`Next dev server did not become ready within 180s (${baseUrl})`);
}

async function stopServer() {
  if (server.exitCode !== null) return;
  server.kill();
  await Promise.race([exited(server), delay(5_000)]);
  if (server.exitCode !== null) return;

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    server.kill("SIGKILL");
  }
}

let tests;
let interrupted = false;
const interrupt = () => {
  if (interrupted) return;
  interrupted = true;
  tests?.kill();
  void stopServer();
};
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);

let exitCode = 1;
try {
  await waitForServer();
  tests = spawn(
    process.execPath,
    [
      path.join(root, "node_modules", "@playwright", "test", "cli.js"),
      "test",
      ...process.argv.slice(2),
    ],
    {
      cwd: root,
      env: { ...process.env, PLX_MC_E2E_EXTERNAL_SERVER: "1" },
      stdio: "inherit",
    }
  );
  const result = await exited(tests);
  exitCode = result.code ?? 1;
} catch (error) {
  console.error(`[playwright-runner] ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await stopServer();
}

process.exitCode = exitCode;
