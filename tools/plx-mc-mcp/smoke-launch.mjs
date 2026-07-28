#!/usr/bin/env node
/**
 * Protocol-level smoke test for the PLX-MC MCP server.
 *
 * Starts the real wrapper (launch.mjs, the same entry Cursor spawns), completes
 * an MCP initialize handshake with the SDK client, and asserts the tools that
 * only appear if module loading succeeded end to end.
 *
 * This exists because startup was previously only exercised by hand in an
 * interactive shell. Two defects reached the operator that way: the PowerShell
 * launcher assumed $HOME, and Node 24 rejected an internal require() mixed with
 * the entrypoint's top-level await. Both broke discovery before any tool was
 * exposed, so every tool call failed while the code looked fine.
 *
 * Usage:
 *   node tools/plx-mc-mcp/smoke-launch.mjs              # hermetic: no network, no credentials
 *   node tools/plx-mc-mcp/smoke-launch.mjs --auth       # also calls mc_self_check with a real key
 *   node tools/plx-mc-mcp/smoke-launch.mjs --target portal
 *
 * Not wired into preflight: it needs `npm ci` inside tools/plx-mc-mcp, which CI
 * does not install for the Next.js suite. Run it after touching the launcher,
 * the entrypoint, or any module they import.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const launcher = path.join(here, "launch.mjs");

const argv = process.argv.slice(2);
const withAuth = argv.includes("--auth");
const targetIndex = argv.indexOf("--target");
const target = targetIndex === -1 ? "hub" : argv[targetIndex + 1];
const repo = target === "portal" ? "petralabx/plx-customer-portal" : "petralabx/PLX_MC";

// Tools whose registration proves the module graph loaded. They live in
// routing-mutation-tools.ts, which routing-suggest-tools.ts pulls in — the
// import that Node 24 rejected when it was a require().
const REQUIRED_TOOLS = ["mc_create_routed_task", "mc_confirm_existing", "mc_attach_checkout", "mc_self_check"];

const TIMEOUT_MS = 60_000;

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

const env = { ...process.env, MC_REPO: repo, PLX_MC_MCP_ENABLED: "1" };

// Without a key the launcher reaches for AWS Secrets Manager, which makes the
// run slow offline and useless in CI. A placeholder keeps the handshake and the
// tool listing entirely local; --auth opts into the credentialed path.
if (!withAuth && !env.MC_MCP_API_KEY) {
  env.MC_MCP_API_KEY = "smoke-placeholder-not-a-real-key";
}

const client = new Client({ name: "plx-mc-smoke", version: "1.0.0" }, { capabilities: {} });
// "inherit", not "pipe": when the server dies during startup — the failure this
// test exists for — connect() rejects before a piped stderr can be read, and the
// reason is lost. Inheriting streams it straight to the operator.
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [launcher],
  env,
  stderr: "inherit",
});

const timer = setTimeout(() => {
  console.error(`FAIL: no successful handshake within ${TIMEOUT_MS}ms`);
  process.exit(1);
}, TIMEOUT_MS);

try {
  await client.connect(transport);

  const server = client.getServerVersion();
  console.log(`initialized: ${server?.name ?? "unknown"} v${server?.version ?? "?"} (target=${target}, repo=${repo})`);

  const { tools } = await client.listTools();
  const names = new Set(tools.map((t) => t.name));
  console.log(`tools listed: ${tools.length}`);

  const missing = REQUIRED_TOOLS.filter((name) => !names.has(name));
  if (missing.length) {
    fail(`server started but did not register: ${missing.join(", ")}`);
  } else {
    console.log(`registered as expected: ${REQUIRED_TOOLS.join(", ")}`);
  }

  if (withAuth) {
    const result = await client.callTool({ name: "mc_self_check", arguments: {} });
    const text = result.content?.map((c) => c.text ?? "").join("") ?? "";
    if (result.isError) {
      fail(`mc_self_check returned an error: ${text.slice(0, 400)}`);
    } else {
      console.log(`mc_self_check ok: ${text.slice(0, 200)}`);
    }
  } else {
    console.log("mc_self_check skipped (no --auth; handshake and registration were still asserted)");
  }
} catch (error) {
  fail(`${error?.message ?? String(error)} — see the server output above`);
} finally {
  clearTimeout(timer);
  await client.close().catch(() => {});
}

console.log(process.exitCode ? "smoke FAILED" : "smoke passed");
