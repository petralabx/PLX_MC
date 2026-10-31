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
  WORKBENCH_INTAKE_MCP_SERVICE_PRINCIPAL_ID,
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
  // TASK-3567: the route also requires the session to be the question's addressee.
  "question.answer",
  // TASK-4059 (Vince, 2026-10-27): members propose projects as drafts and
  // accept their own. draft.accept also requires the session to be the author.
  "draft.create",
  "draft.review",
  "draft.accept",
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

// Every per-agent MCP principal except sp_mcp_portal, sp_mcp_workbench, sp_mcp_infra, sp_mcp_cip_auto_undraft and sp_mcp_workbench_intake carries the same reviewed task/planning/routing
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
  "question.ask",
  "telemetry.report",
  "sync.mutate",
  // TASK-4059: agents write and review drafts for their person. Never draft.accept.
  "draft.create",
  "draft.review",
];

// sp_mcp_cursor is the principal Ledger's Task calls authenticate as (no
// sp_mcp_ledger key, and no events under that principal). Vince approved
// task.cancel on 2026-10-16 (TASK-3089) and task.reopen on 2026-10-19
// (TASK-3374). Vince granted task.link_merged_pr on 2026-10-27 at 1:40 AM
// and 2:02 AM ET (TASK-3671): Ledger signs in through the shared Hub key.
const CURSOR_MCP_CAPABILITIES: readonly Capability[] = [
  ...MCP_AGENT_CAPABILITIES,
  "task.cancel",
  "task.reopen",
  "task.link_merged_pr",
];

// sp_mcp_ledger is the steward principal: the agent bundle plus
// task.link_merged_pr (mc_link_merged_pr), task.cancel (Ledger dedup; Vince
// 2026-10-15 16:37 ET), and task.reopen (TASK-2580). sp_mcp_cos holds cancel
// and link_merged_pr but not reopen. sp_mcp_cursor holds task.cancel,
// task.reopen and task.link_merged_pr.
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

// sp_mcp_portal (agent fleet P8): Vince widened it on 2026-10-31 at 9:42 AM ET
// (TASK-4313) to sp_mcp_cip's task rights: every task.* capability sp_mcp_cip
// holds, so it checks out, records progress, completes and links tasks like
// CIP. Not CIP's bucket, project, routing, approval, question, telemetry, sync
// or draft rights. It keeps its two portal-only grants: agent_report.read
// (fleet P8b, GET /api/cursor/agent-reports) and task.uat_sync (TASK-3697, the
// UAT ticket mirror through mc_update_task). TASK-4200 widens task.uat_sync
// with closeStale, which only adds uat:stale to a merged UAT ticket task; the
// capability list does not change (Vince's OK, 2026-10-30). Only the portal
// holds either grant. It no longer has a tool allowlist in
// src/lib/mcp/tool-allowlist.ts; each action's capability check limits it.
// Defined below CLOSE_OUT_MCP_CAPABILITIES (sp_mcp_cip's grant), which it filters.

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

// sp_mcp_workbench_intake (PLX Workbench intake; TASK-3523; Vince approved
// 2026-10-20 at 4:28 PM and 5:00 PM ET): least privilege like sp_mcp_portal.
// task.read and task.create in any bucket, and src/lib/mcp/tool-allowlist.ts
// limits it to mc_create_task and mc_search_tasks. No checkout, progress or
// complete. Tasks it creates wait for vince@ or cos@ approval before checkout
// or launch (CREATOR_APPROVAL_GATED_PRINCIPALS below, TASK-3530).
const WORKBENCH_INTAKE_MCP_CAPABILITIES: readonly Capability[] = ["task.read", "task.create"];

// TASK-4015 per-consumer principals (Vince 2026-10-27 4:22 and 4:30 AM ET).
// Each replaces a consumer of the shared sp_mcp_cursor key. Every one carries
// the agent bundle; these add exactly what that consumer does today:
// - sp_mcp_cursor_team (interim team Cursor connectors) and sp_mcp_steward keep
//   sp_mcp_cursor parity: task.cancel, task.reopen, task.link_merged_pr.
// - sp_mcp_cip, sp_mcp_aws_gh and sp_mcp_plx_cos close out merged PRs:
//   task.link_merged_pr.
// Every other TASK-4015 principal (sp_mcp_infra_bot, the other bots and the
// nine sp_mcp_lane_* principals) gets MCP_AGENT_CAPABILITIES only.
const CURSOR_PARITY_MCP_CAPABILITIES: readonly Capability[] = [
  ...MCP_AGENT_CAPABILITIES,
  "task.cancel",
  "task.reopen",
  "task.link_merged_pr",
];
const CLOSE_OUT_MCP_CAPABILITIES: readonly Capability[] = [
  ...MCP_AGENT_CAPABILITIES,
  "task.link_merged_pr",
];
const PORTAL_MCP_CAPABILITIES: readonly Capability[] = [
  ...CLOSE_OUT_MCP_CAPABILITIES.filter((capability) => capability.startsWith("task.")),
  "agent_report.read",
  "task.uat_sync",
];
// TASK-4015 (migration 057): personal principals for MC humans. Least
// privilege: exactly the human member role bundle, whatever the person's
// web role, so a personal key never carries admin/owner powers.
const PERSON_MCP_CAPABILITIES: readonly Capability[] = MEMBER_CAPABILITIES;
const PER_CONSUMER_MCP_GRANTS: Readonly<Record<string, readonly Capability[]>> = {
  sp_mcp_person_greg: PERSON_MCP_CAPABILITIES,
  sp_mcp_person_luis: PERSON_MCP_CAPABILITIES,
  sp_mcp_person_oleg: PERSON_MCP_CAPABILITIES,
  sp_mcp_person_ricardo: PERSON_MCP_CAPABILITIES,
  sp_mcp_person_rishi: PERSON_MCP_CAPABILITIES,
  sp_mcp_person_stephen: PERSON_MCP_CAPABILITIES,
  sp_mcp_person_tanush: PERSON_MCP_CAPABILITIES,
  sp_mcp_cursor_team: CURSOR_PARITY_MCP_CAPABILITIES,
  sp_mcp_steward: CURSOR_PARITY_MCP_CAPABILITIES,
  sp_mcp_cip: CLOSE_OUT_MCP_CAPABILITIES,
  sp_mcp_aws_gh: CLOSE_OUT_MCP_CAPABILITIES,
  sp_mcp_plx_cos: CLOSE_OUT_MCP_CAPABILITIES,
};

const SERVICE_GRANTS: Record<string, readonly Capability[]> = {
  ...Object.fromEntries(
    MCP_AGENT_SERVICE_PRINCIPAL_IDS.map((id) => [
      id,
      Object.prototype.hasOwnProperty.call(PER_CONSUMER_MCP_GRANTS, id)
        ? PER_CONSUMER_MCP_GRANTS[id]
        : id === PORTAL_MCP_SERVICE_PRINCIPAL_ID
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
                    : id === WORKBENCH_INTAKE_MCP_SERVICE_PRINCIPAL_ID
                      ? WORKBENCH_INTAKE_MCP_CAPABILITIES
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

// Creator-principal approval gate (TASK-3530; Vince approved 2026-10-20 5:09 PM
// ET). A task one of these principals creates starts with a pending creator
// approval: no checkout, launch or move into progress until a creator approver
// clears it through the creator-approval action. Reviewed code, like
// SERVICE_GRANTS: add a principal only with an approval on record.
const CREATOR_APPROVAL_GATED_PRINCIPALS: readonly string[] = [
  WORKBENCH_INTAKE_MCP_SERVICE_PRINCIPAL_ID,
];

// The only people who may clear a creator approval, by Entra object id (the
// session oid, never an email a caller can supply), with their audit label.
const CREATOR_APPROVERS: Readonly<Record<string, string>> = {
  "29e05178-0bd1-49b9-be6e-b01be1975f70": "vince@petrasoap.com",
  "a3d74eb5-f230-4335-a852-15fa2d7021b6": "cos@petrasoap.com",
};

export function isCreatorApprovalGated(servicePrincipalId: string | null | undefined): boolean {
  return !!servicePrincipalId && CREATOR_APPROVAL_GATED_PRINCIPALS.includes(servicePrincipalId);
}

export function isCreatorApprover(oid: string | null | undefined): boolean {
  return !!oid && Object.prototype.hasOwnProperty.call(CREATOR_APPROVERS, oid);
}

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
