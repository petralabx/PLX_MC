// Stable capability + actor types for the permissions kernel.
// Intentionally small — not a generic IAM / policy DSL.

export const POLICY_VERSION = "permissions.v1" as const;

export type AccessRole = "owner" | "admin" | "member";

export type ActorStatus = "active" | "revoked";

export const CAPABILITIES = [
  "task.read",
  "task.create",
  "task.link",
  "task.reopen",
  "task.checkout",
  "task.progress",
  "task.complete",
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

/** Durable MCP cursor API service principal (shared API key authenticates this). */
export const MCP_SERVICE_PRINCIPAL_ID = "sp_mcp_cursor" as const;

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
