// Versioned human role bundles and durable service-principal capability sets.

import type { AccessRole, Capability } from "./types";
import {
  COMPLIANCE_PROJECTION_SERVICE_PRINCIPAL_ID,
  GITHUB_ACTIONS_ROUTING_SERVICE_PRINCIPAL_ID,
  LEDGER_MCP_SERVICE_PRINCIPAL_ID,
  MCP_AGENT_SERVICE_PRINCIPAL_IDS,
  PORTAL_MCP_SERVICE_PRINCIPAL_ID,
  ROUTING_MAINTENANCE_SERVICE_PRINCIPAL_ID,
  SYNC_INBOUND_SERVICE_PRINCIPAL_ID,
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
];

const ADMIN_CAPABILITIES: readonly Capability[] = [
  ...MEMBER_CAPABILITIES,
  "task.reopen",
  "bucket.create",
  "bucket.update",
  "project.create",
  "project.update",
  "repo.approve",
  "routing.policy.write",
  "sync.mutate",
  "approval.decide",
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

// Every per-agent MCP principal except sp_mcp_portal carries the same reviewed task/planning/routing
// + bucket.update + project.update (steward edits, mc_update_project) +
// sync.resolve (via sync.mutate) bundle; per-agent identity isolates
// credentials and audit, not capabilities. Console sweep/retry stay
// Entra-gated.
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

// sp_mcp_ledger is the one steward principal: the agent bundle plus
// task.link_merged_pr (mc_link_merged_pr). No other principal holds it.
const LEDGER_MCP_CAPABILITIES: readonly Capability[] = [
  ...MCP_AGENT_CAPABILITIES,
  "task.link_merged_pr",
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

const SERVICE_GRANTS: Record<string, readonly Capability[]> = {
  ...Object.fromEntries(
    MCP_AGENT_SERVICE_PRINCIPAL_IDS.map((id) => [
      id,
      id === PORTAL_MCP_SERVICE_PRINCIPAL_ID
        ? PORTAL_MCP_CAPABILITIES
        : id === LEDGER_MCP_SERVICE_PRINCIPAL_ID
          ? LEDGER_MCP_CAPABILITIES
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
