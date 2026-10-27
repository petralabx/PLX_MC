const SUPPORTED_MCP_PRINCIPAL_IDS = new Set([
  "sp_mcp_cursor",
  "sp_mcp_claude_code",
  "sp_mcp_codex",
  "sp_mcp_chatgpt",
  "sp_mcp_grok",
  "sp_mcp_hermes",
  "sp_mcp_swarm",
  "sp_mcp_agent_runner",
  "sp_mcp_portal",
  "sp_mcp_ledger",
  "sp_mcp_cos",
  "sp_mcp_workbench",
  "sp_mcp_infra",
  "sp_mcp_cip_auto_undraft",
  "sp_mcp_workbench_intake",
  "sp_mcp_cursor_team",
  "sp_mcp_infra_bot",
  "sp_mcp_plx_cos",
  "sp_mcp_cip",
  "sp_mcp_steward",
  "sp_mcp_uat",
  "sp_mcp_harness",
  "sp_mcp_bc_golive",
  "sp_mcp_azure",
  "sp_mcp_aws_gh",
  "sp_mcp_books",
  "sp_mcp_mmm",
  "sp_mcp_haggle",
  "sp_mcp_recap",
  "sp_mcp_cursor_helper",
  "sp_mcp_taylo_infra",
  "sp_mcp_nightly_audit",
  "sp_mcp_lane_claude_cos",
  "sp_mcp_lane_claude_uat",
  "sp_mcp_lane_claude_vince",
  "sp_mcp_lane_codex_cos",
  "sp_mcp_lane_codex_uat",
  "sp_mcp_lane_codex_vince",
  "sp_mcp_lane_cursor_cos",
  "sp_mcp_lane_cursor_uat",
  "sp_mcp_lane_cursor_vince",
  "sp_mcp_vince",
  "sp_mcp_person_greg",
  "sp_mcp_person_luis",
  "sp_mcp_person_oleg",
  "sp_mcp_person_ricardo",
  "sp_mcp_person_rishi",
  "sp_mcp_person_stephen",
  "sp_mcp_person_tanush",
]);

const RUNTIME_PRINCIPAL_IDS = new Map([
  ["cursor", "sp_mcp_cursor"],
  ["cursor-cloud", "sp_mcp_cursor"],
  ["claude", "sp_mcp_claude_code"],
  ["claude-code", "sp_mcp_claude_code"],
  ["hermes", "sp_mcp_hermes"],
  ["codex", "sp_mcp_codex"],
  ["chatgpt", "sp_mcp_chatgpt"],
  ["grok", "sp_mcp_grok"],
  ["swarm", "sp_mcp_swarm"],
]);

export const MCP_CURSOR_PRINCIPAL_ID = "sp_mcp_cursor";
export const MCP_AGENT_KEYS_SECRET_ID = "plx/prod/mc/mcp-agent-keys/v1";
export const MCP_COMPATIBILITY_SECRET_ID = "prod/ec2-secrets";

export function cleanMcpValue(value) {
  const cleaned = String(value ?? "").trim();
  if (!cleaned || /^\$\{[^}]+\}$/.test(cleaned)) return "";
  return cleaned;
}

/** @param {Record<string, string | undefined>} env */
export function resolveMcpPrincipalId(env = process.env) {
  const explicit = cleanMcpValue(env.MC_MCP_PRINCIPAL_ID);
  const principalId =
    explicit ||
    RUNTIME_PRINCIPAL_IDS.get(cleanMcpValue(env.MC_RUNTIME).toLowerCase()) ||
    MCP_CURSOR_PRINCIPAL_ID;
  if (!SUPPORTED_MCP_PRINCIPAL_IDS.has(principalId)) {
    throw new Error("unsupported_mcp_principal_id");
  }
  return principalId;
}

/** @param {Record<string, string | undefined>} env */
export function resolveMcpClientKey(env, principalId) {
  const consumerKey = cleanMcpValue(env.MC_MCP_API_KEY);
  if (consumerKey) return consumerKey;
  if (principalId !== MCP_CURSOR_PRINCIPAL_ID) return "";
  return cleanMcpValue(env.PLX_MC_MCP_API_KEY);
}

export function selectMcpKeyFromSecret(secret, principalId) {
  if (!secret || typeof secret !== "object" || Array.isArray(secret)) return "";
  if (principalId === MCP_CURSOR_PRINCIPAL_ID) {
    return (
      cleanMcpValue(secret.MC_MCP_API_KEY) ||
      cleanMcpValue(secret.PLX_MC_MCP_API_KEY)
    );
  }
  return cleanMcpValue(secret[principalId]);
}
