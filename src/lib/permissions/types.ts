// Stable capability + actor types for the permissions kernel.
// Intentionally small — not a generic IAM / policy DSL.

export const POLICY_VERSION = "permissions.v2" as const;

export type AccessRole = "owner" | "admin" | "member";

export type ActorStatus = "active" | "revoked";

export const CAPABILITIES = [
  "task.read",
  "task.create",
  "task.link",
  // Steward-only: mc_link_merged_pr attaches an already-merged PR to a task.
  "task.link_merged_pr",
  "task.reopen",
  "task.cancel",
  "task.checkout",
  "task.progress",
  "task.complete",
  // TASK-3407: set a task's assignee or accountable owner through mc_update_task, with a reason.
  "task.assign",
  // TASK-3697: mirror a portal ticket onto its UAT ticket task through mc_update_task:
  // verify (merged to verified), cancel, and the uat:hold / uat-attempt:<n> labels.
  "task.uat_sync",
  "routing.suggest",
  "routing.resolve",
  "routing.propose",
  "routing.maintain",
  "bucket.create",
  "bucket.update",
  "project.create",
  "project.update",
  "repo.approve",
  "routing.policy.write",
  "permissions.manage",
  "sync.mutate",
  "sync.service.write",
  "approval.request",
  "approval.decide",
  // TASK-3567: a bot asks one named person a question; only that person answers.
  "question.ask",
  "question.answer",
  "telemetry.report",
  // Read agent.report events through GET /api/cursor/agent-reports (fleet P8b).
  "agent_report.read",
  // Save vendor budgets and manual cost snapshots (AI Spend, TASK-2928).
  "vendor_spend.write",
  // TASK-3011: session writes that had only the middleware gate.
  // Post / edit / delete one's own comment in a bucket thread.
  "bucket.comment",
  // File a repo request and probe its GitHub-org validation (deciding is repo.approve).
  "repo.request",
  // Submit a skill for review (reviewing is repo.approve).
  "skill.submit",
  // Build a skills install / sync-check plan from the company catalog.
  "skill.install",
  // Replay the compliance reconciliation queue by hand (the cron run is CRON_SECRET-gated).
  "compliance.reconcile",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export type PermissionActor =
  | {
      kind: "human";
      id: string;
      role: AccessRole;
      status: ActorStatus;
    }
  | {
      kind: "service";
      id: string;
      status: ActorStatus;
    };

export type PermissionResource =
  | {
      type: "task";
      id: string;
      stage?: string;
      repos?: string[];
    }
  | {
      type: "bucket";
      id: string;
    }
  | {
      type: "project";
      id: string;
    }
  | {
      type: "repo";
      id: string;
    }
  | {
      type: "routing";
      id?: string;
    }
  | {
      type: "sync";
      id?: string;
    };

export interface PermissionContext {
  repositoryId?: string;
  accountableOwnerId?: string;
  actorIsAccountableOwner?: boolean;
  targetEnv?: "staging" | "production";
  /** Restricted-project membership tokens for the resource under check. */
  projectVisibility?: "shared" | "restricted";
  projectMembers?: string[];
  principalTokens?: string[];
}

export type DenyReasonCode =
  | "unknown_actor"
  | "unknown_capability"
  | "actor_revoked"
  | "capability_not_granted"
  | "repository_mismatch"
  | "context_denied";

export type ReasonCode = "allowed" | DenyReasonCode;

export interface AuthorizeDecision {
  allowed: boolean;
  reasonCode: ReasonCode;
  policyVersion: typeof POLICY_VERSION;
}

export interface AuthorizeInput {
  actor: PermissionActor | null | undefined;
  capability: Capability | string;
  resource?: PermissionResource;
  context?: PermissionContext;
}

/** Injectable identity SQL seam (tests pass fakes; production uses db.query). */
export type IdentityQuery = (
  text: string,
  params?: unknown[]
) => Promise<Record<string, unknown>[]>;

/**
 * Durable MCP cursor API service principal. Historically the shared API key
 * authenticated this single principal; per-agent keys (TASK-619) resolve to
 * one of MCP_AGENT_SERVICE_PRINCIPAL_IDS, with this id as the legacy shared-key
 * fallback while that key is being retired.
 */
export const MCP_SERVICE_PRINCIPAL_ID = "sp_mcp_cursor" as const;

/**
 * Portal MCP principal (agent fleet P8). The portal's COS delegate tool uses
 * its key. Its grant is least privilege (decision CG-07b): create and search
 * tasks only. It is the only MCP principal that may set an `agent:` assignee.
 * TASK-3697 adds task.uat_sync: it mirrors a portal ticket onto that ticket's
 * UAT ticket task, and edits no other task.
 */
export const PORTAL_MCP_SERVICE_PRINCIPAL_ID = "sp_mcp_portal" as const;

/**
 * Reviewed registry of per-agent MCP service principals (one credential per
 * agent runtime). Keys configured outside this list never authenticate.
 */
export const MCP_AGENT_SERVICE_PRINCIPAL_IDS = [
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
  // TASK-4015 (Vince 2026-10-27 4:22 and 4:30 AM ET): one principal per team
  // bot, per coding-1 lane, and an interim key for the team Cursor connectors,
  // so the shared sp_mcp_cursor key can be retired. Keys are minted separately.
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
  // TASK-4015: Vince's personal principal (his Claude and Cursor). Same
  // grant as sp_mcp_claude_code (the default MCP_AGENT_CAPABILITIES bundle).
  "sp_mcp_vince",
  // TASK-4015: one principal per MC human without one (migration 056).
  // Member-scoped: MEMBER_CAPABILITIES only (grants.ts PERSON_MCP).
  "sp_mcp_person_greg",
  "sp_mcp_person_luis",
  "sp_mcp_person_oleg",
  "sp_mcp_person_ricardo",
  "sp_mcp_person_rishi",
  "sp_mcp_person_stephen",
  "sp_mcp_person_tanush",
] as const;

/**
 * Ledger steward principal. With sp_mcp_cos, one of two MCP principals holding
 * task.link_merged_pr (mc_link_merged_pr); otherwise it carries the normal agent bundle.
 */
export const LEDGER_MCP_SERVICE_PRINCIPAL_ID = "sp_mcp_ledger" as const;

/**
 * Chief of Staff steward principal. With sp_mcp_ledger, one of two MCP
 * principals holding task.link_merged_pr. task.cancel is also held by
 * sp_mcp_cursor (with task.reopen). Its key goes only to the Chief of Staff runtime.
 */
export const COS_MCP_SERVICE_PRINCIPAL_ID = "sp_mcp_cos" as const;

/**
 * PLX Agent Workbench principal (tswaterloo/OntologyProject). Read-only and
 * least privilege like sp_mcp_portal: task.read only, and the MCP tool
 * allowlist limits it to its read tools.
 */
export const WORKBENCH_MCP_SERVICE_PRINCIPAL_ID = "sp_mcp_workbench" as const;

/**
 * PLX Infra principal. Read-only like sp_mcp_workbench: task.read only, and
 * the MCP tool allowlist limits it to the same read tools.
 */
export const INFRA_MCP_SERVICE_PRINCIPAL_ID = "sp_mcp_infra" as const;

/**
 * PLX CIP Auto-Undraft principal (agentic-swarm cip-auto-undraft workflow).
 * Read-only: task.read only, and the MCP tool allowlist limits it to four read tools.
 */
export const CIP_AUTO_UNDRAFT_MCP_SERVICE_PRINCIPAL_ID = "sp_mcp_cip_auto_undraft" as const;

/**
 * PLX Workbench intake principal. Least privilege like sp_mcp_portal: create
 * and search tasks only. It may not set an `agent:` assignee.
 */
export const WORKBENCH_INTAKE_MCP_SERVICE_PRINCIPAL_ID = "sp_mcp_workbench_intake" as const;

export type McpAgentServicePrincipalId =
  (typeof MCP_AGENT_SERVICE_PRINCIPAL_IDS)[number];

/** Durable inbound sync writer used by later phases. */
export const SYNC_INBOUND_SERVICE_PRINCIPAL_ID = "sp_sync_inbound" as const;

/** Durable routing maintenance principal used by later phases. */
export const ROUTING_MAINTENANCE_SERVICE_PRINCIPAL_ID = "sp_routing_maintenance" as const;

/** Durable GitHub Actions OIDC principal for metadata-only routing.propose. */
export const GITHUB_ACTIONS_ROUTING_SERVICE_PRINCIPAL_ID =
  "sp_github_actions_routing" as const;

/** Durable compliance projection principal for PR→Task progress/merge. */
export const COMPLIANCE_PROJECTION_SERVICE_PRINCIPAL_ID =
  "sp_compliance_projection" as const;

export interface McUserRecord {
  id: string;
  entraOid: string;
  email: string;
  displayName?: string;
  accessRole: AccessRole;
  status: ActorStatus;
}

export interface GithubIdentityRecord {
  githubUserId: number;
  mcUserId: string;
  githubLogin: string;
  verifiedAt: string;
  revokedAt: string | null;
}

export interface ServicePrincipalRecord {
  id: string;
  name: string;
  status: ActorStatus;
}
