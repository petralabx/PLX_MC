// Versioned human role bundles and durable service-principal capability sets.

import type { AccessRole, Capability } from "./types";
import {
  CIP_AUTO_UNDRAFT_MCP_SERVICE_PRINCIPAL_ID,
  COMPLIANCE_PROJECTION_SERVICE_PRINCIPAL_ID,
  COS_MCP_SERVICE_PRINCIPAL_ID,
  GITHUB_ACTIONS_ROUTING_SERVICE_PRINCIPAL_ID,
  INFRA_MCP_SERVICE_PRINCIPAL_ID,
  LEDGER_MCP_SERVICE_PRINCIPAL_ID,
  MCP_AGENT_SERVICE_PRINCIPAL_IDS,
  MCP_SERVICE_PRINCIPAL_ID,
  PORTAL_MCP_SERVICE_PRINCIPAL_ID,
  ROUTING_MAINTENANCE_SERVICE_PRINCIPAL_ID,
  SYNC_INBOUND_SERVICE_PRINCIPAL_ID,
  WORKBENCH_MCP_SERVICE_PRINCIPAL_ID,
} from "./types";

const MEMBER_CAPABILITIES: readonly Capability[] = [
  "task.read",
  "task.create",
  "task.link",
  "task.checkout",
  "task.progress",
  "task.complete",
  "routing.suggest",
  "routing.resolve",
  "bucket.comment",
  "repo.request",
  "skill.submit",
  "skill.install",
];

const ADMIN_CAPABILITIES: readonly Capability[] = [
  ...MEMBER_CAPABILITIES,
  "task.reopen",
  "task.cancel",
  "task.assign",
  "bucket.create",
  "bucket.update",
  "project.create",
  "project.update",
  "repo.approve",
  "routing.policy.write",
  "sync.mutate",
  "approval.decide",
  "vendor_spend.write",
  "compliance.reconcile",
];

const OWNER_CAPABILITIES: readonly Capability[] = [
  ...ADMIN_CAPABILITIES,
  "permissions.manage",
];

const ROLE_GRANTS: Record<AccessRole, readonly Capability[]> = {
  member: MEMBER_CAPABILITIES,
  admin: ADMIN_CAPABILITIES,
  owner: OWNER_CAPABILITIES,
};

// Every per-agent MCP principal except sp_mcp_portal, sp_mcp_workbench, sp_mcp_infra and sp_mcp_cip_auto_undraft carries the same reviewed task/planning/routing
// + bucket.update + project.update (steward edits, mc_update_project) +
// sync.resolve (via sync.mutate) bundle; per-agent identity isolates
// credentials and audit, not capabilities. Console sweep/retry stay
// Entra-gated.
// task.cancel / task.reopen are deliberately absent from this shared bundle: any
// agent holding them could cancel any task. They are granted per principal in
// SERVICE_GRANTS (task.cancel: sp_mcp_cursor, sp_mcp_cos, and sp_mcp_ledger;
// task.reopen: sp_mcp_cursor and sp_mcp_ledger, TASK-2580 / TASK-3374) and to
// the human admin/owner roles.
const MCP_AGENT_CAPABILITIES: readonly Capability[] = [
  "task.read",
  "task.create",
  "task.checkout",
  "task.progress",
  "task.complete",
  "task.link",
  "bucket.create",
  "bucket.update",
  "project.create",
  "project.update",
  "routing.suggest",
  "routing.propose",
  "routing.resolve",
  "approval.request",
  "telemetry.report",
  "sync.mutate",
];

// sp_mcp_cursor is the principal Ledger's Task calls authenticate as (no
// sp_mcp_ledger key, and no events under that principal). Vince approved
// task.cancel on 2026-10-16 (TASK-3089) and task.reopen on 2026-10-19
// (TASK-3374). Not task.link_merged_pr.
const CURSOR_MCP_CAPABILITIES: readonly Capability[] = [
  ...MCP_AGENT_CAPABILITIES,
  "task.cancel",
  "task.reopen",
];

// sp_mcp_ledger is the steward principal: the agent bundle plus
// task.link_merged_pr (mc_link_merged_pr), task.cancel (Ledger dedup; Vince
// 2026-10-15 16:37 ET), and task.reopen (TASK-2580). sp_mcp_cos holds cancel
// and link_merged_pr but not reopen. sp_mcp_cursor holds task.cancel and
// task.reopen.
const LEDGER_MCP_CAPABILITIES: readonly Capability[] = [
  ...MCP_AGENT_CAPABILITIES,
  "task.cancel",
  "task.reopen",
  "task.link_merged_pr",
  // TASK-3407 (Vince, approval gate 2026-10-20): stewards re-assign tasks and
  // their accountable owner with an audited reason; other agents cannot.
  "task.assign",
];

// sp_mcp_cos (Vince 2026-10-11 13:56 ET): Chief of Staff steward lane.
// The agent bundle plus exactly task.cancel and task.link_merged_pr.
const COS_MCP_CAPABILITIES: readonly Capability[] = [
  ...MCP_AGENT_CAPABILITIES,
  "task.cancel",
  "task.link_merged_pr",
  "task.assign",
];

// sp_mcp_portal (agent fleet P8) is least privilege (decision CG-07b): it
// creates tasks, an `agent:` assignee included, and searches them. No
// checkout, progress, complete, bucket, project, routing or approval action.
// task.read also admits read tools such as mc_get_context and mc_list_buckets,
// so src/lib/mcp/tool-allowlist.ts limits the portal to mc_create_task and
// mc_search_tasks over HTTP MCP and the cursor REST routes. Fleet P8b adds one
// read, agent_report.read, for GET /api/cursor/agent-reports. Only the portal
// holds it.
const PORTAL_MCP_CAPABILITIES: readonly Capability[] = [
  "task.read",
  "task.create",
  "agent_report.read",
];

// sp_mcp_workbench (PLX Agent Workbench, tswaterloo/OntologyProject): read-only,
// least privilege; owner Tanush 2026-10-13. task.read only, and
// src/lib/mcp/tool-allowlist.ts limits it to its six read tools.
const WORKBENCH_MCP_CAPABILITIES: readonly Capability[] = ["task.read"];

// sp_mcp_infra (PLX Infra; Vince 2026-10-15 09:10 ET): read-only, the same
// grant and tool allowlist as sp_mcp_workbench.
const INFRA_MCP_CAPABILITIES: readonly Capability[] = ["task.read"];

// sp_mcp_cip_auto_undraft (PLX CIP Auto-Undraft, agentic-swarm cip-auto-undraft;
// Vince 2026-10-18): read-only. task.read only, and src/lib/mcp/tool-allowlist.ts
// limits it to its four read tools.
const CIP_AUTO_UNDRAFT_MCP_CAPABILITIES: readonly Capability[] = ["task.read"];

const SERVICE_GRANTS: Record<string, readonly Capability[]> = {
  ...Object.fromEntries(
    MCP_AGENT_SERVICE_PRINCIPAL_IDS.map((id) => [
      id,
      id === PORTAL_MCP_SERVICE_PRINCIPAL_ID
        ? PORTAL_MCP_CAPABILITIES
        : id === LEDGER_MCP_SERVICE_PRINCIPAL_ID
          ? LEDGER_MCP_CAPABILITIES
          : id === COS_MCP_SERVICE_PRINCIPAL_ID
            ? COS_MCP_CAPABILITIES
            : id === MCP_SERVICE_PRINCIPAL_ID
              ? CURSOR_MCP_CAPABILITIES
              : id === WORKBENCH_MCP_SERVICE_PRINCIPAL_ID
                ? WORKBENCH_MCP_CAPABILITIES
                : id === INFRA_MCP_SERVICE_PRINCIPAL_ID
                  ? INFRA_MCP_CAPABILITIES
                  : id === CIP_AUTO_UNDRAFT_MCP_SERVICE_PRINCIPAL_ID
                    ? CIP_AUTO_UNDRAFT_MCP_CAPABILITIES
                    : MCP_AGENT_CAPABILITIES,
    ])
  ),
  [SYNC_INBOUND_SERVICE_PRINCIPAL_ID]: ["sync.service.write", "task.read"],
  [ROUTING_MAINTENANCE_SERVICE_PRINCIPAL_ID]: ["routing.maintain", "task.read"],
  [GITHUB_ACTIONS_ROUTING_SERVICE_PRINCIPAL_ID]: ["routing.propose", "task.read"],
  [COMPLIANCE_PROJECTION_SERVICE_PRINCIPAL_ID]: [
    "task.progress",
    "task.link",
    "task.read",
  ],
};

export function capabilitiesForRole(role: AccessRole): readonly Capability[] {
  return ROLE_GRANTS[role] ?? [];
}

export function capabilitiesForServicePrincipal(
  servicePrincipalId: string
): readonly Capability[] {
  return SERVICE_GRANTS[servicePrincipalId] ?? [];
}

export function isKnownServicePrincipal(servicePrincipalId: string): boolean {
  return Object.prototype.hasOwnProperty.call(SERVICE_GRANTS, servicePrincipalId);
}
