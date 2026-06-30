#!/usr/bin/env node
/**
 * PLX-MC MCP launcher.
 *
 * Cross-environment wrapper for Cursor Desktop + Cloud Agents:
 * - Cloud: uses MC_MCP_API_KEY from the agent secrets/env panel.
 * - Local operator boxes: if the key is not in env, fetches PLX_MC_MCP_API_KEY
 *   from AWS Secrets Manager (prod/ec2-secrets) without printing it.
 * - Forces the operator/accountable email to cos@petrasoap.com per current
 *   operator setup policy.
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

function clean(value) {
  const s = String(value ?? "").trim();
  if (!s || /^\$\{[^}]+\}$/.test(s)) return "";
  return s;
}

function setDefault(name, value) {
  if (!clean(process.env[name])) process.env[name] = value;
}

function loadKeyFromAws() {
  const secretId = clean(process.env.CURSOR_MCP_AWS_SECRET_IDS)?.split(",")[0]?.trim() || "prod/ec2-secrets";
  const region = clean(process.env.AWS_REGION) || "us-east-1";
  try {
    const raw = execFileSync(
      "aws",
      [
        "secretsmanager",
        "get-secret-value",
        "--secret-id",
        secretId,
        "--region",
        region,
        "--query",
        "SecretString",
        "--output",
        "text",
        "--no-cli-pager",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    const parsed = JSON.parse(raw);
    return clean(parsed.MC_MCP_API_KEY) || clean(parsed.PLX_MC_MCP_API_KEY);
  } catch (error) {
    const detail = clean(error?.stderr) || clean(error?.message) || "unknown error";
    console.error(`[plx-mc-mcp] unable to load MCP key from AWS Secrets Manager (${secretId}, ${region}): ${detail}`);
    return "";
  }
}

setDefault("MC_BASE_URL", "https://mc.plxcustomer.io");
setDefault("MC_REPO", "taylorvalton/PLX_MC");
setDefault("MC_RUNTIME", "cursor");
setDefault("PLX_MC_MCP_ENABLED", "0");
setDefault("SWARM_API_URL", "http://127.0.0.1:8900");
setDefault("SWARM_DISPATCH_ENABLED", "0");

// Current operator identity policy: all agent/tool email identity uses COS.
process.env.MC_OPERATOR_EMAIL = "cos@petrasoap.com";
process.env.MC_ACCOUNTABLE = "cos@petrasoap.com";

let key = clean(process.env.MC_MCP_API_KEY) || clean(process.env.PLX_MC_MCP_API_KEY);
if (!key) key = loadKeyFromAws();
if (key) process.env.MC_MCP_API_KEY = key;

const tsxCli = path.join(here, "node_modules", "tsx", "dist", "cli.mjs");
const entry = path.join(here, "index.ts");
if (!fs.existsSync(tsxCli)) {
  console.error(`[plx-mc-mcp] missing ${tsxCli}; run: cd ${here} && npm ci`);
  process.exit(1);
}

const child = spawn(process.execPath, [tsxCli, entry], {
  cwd: repoRoot,
  env: process.env,
  stdio: "inherit",
  windowsHide: true,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error(`[plx-mc-mcp] failed to start MCP server: ${error.message}`);
  process.exit(1);
});
