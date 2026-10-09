#!/usr/bin/env node
// Exercise the documented tool-only install outside the web app's dependency tree.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const isolated = mkdtempSync(join(tmpdir(), "plx-mc-stdio-"));
const tool = join(isolated, "tools/plx-mc-mcp");
cpSync(join(repo, "tools/plx-mc-mcp"), tool, {
  recursive: true,
  filter: (source) => !source.split(/[\\/]/).includes("node_modules"),
});
// Include the original schema location so the pre-fix entry graph fails on
// dependency resolution, rather than on a deliberately omitted source file.
const schema = "src/lib/mcp/task-search-schema.ts";
mkdirSync(dirname(join(isolated, schema)), { recursive: true });
cpSync(join(repo, schema), join(isolated, schema));
const env = { PATH: process.env.PATH, PLX_MC_MCP_ENABLED: "0" };
console.log(`Isolated layout: ${isolated} (no root node_modules)`);
const install = spawnSync("npm", ["ci", "--prefix", tool, "--cache", join(tmpdir(), "plx-mc-stdio-npm-cache"), "--ignore-scripts", "--no-audit", "--no-fund"], {
  env, encoding: "utf8", timeout: 120_000,
});
process.stdout.write(install.stdout || "");
process.stderr.write(install.stderr || "");
assert.equal(install.status, 0, `Tool-only install failed: ${install.error || ""}`);
const messages = [
  { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "standalone-check", version: "1" } } },
  { jsonrpc: "2.0", method: "notifications/initialized" },
  { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
];
const startup = spawnSync(process.execPath, [join(tool, "node_modules/tsx/dist/cli.mjs"), "index.ts"], {
  cwd: tool, env, encoding: "utf8", timeout: 30_000,
  input: messages.map((message) => JSON.stringify(message)).join("\n") + "\n",
});
process.stderr.write(startup.stderr || "");
assert.equal(startup.status, 0, `Stdio startup failed: ${startup.error || ""}`);
const replies = startup.stdout.trim().split("\n").map((line) => JSON.parse(line));
assert(replies.find((reply) => reply.id === 1)?.result?.serverInfo, "MCP initialize response missing");
const tools = replies.find((reply) => reply.id === 2)?.result?.tools;
const search = tools?.find((item) => item.name === "mc_search_tasks");
assert(search, "mc_search_tasks registration missing");
for (const field of ["cursor", "limit", "label", "searchComments", "in", "fields"]) {
  assert(search.inputSchema.properties[field], `Search field ${field} missing`);
}
for (const name of ["mc_list_projects", "mc_update_project"]) {
  assert(tools.some((item) => item.name === name), `${name} registration missing`);
}
console.log(`PASS: tool-only npm ci; stdio initialized; ${tools.length} tools registered; mc_search_tasks controls: cursor, limit, label, searchComments, in, fields; mc_list_projects and mc_update_project registered`);
