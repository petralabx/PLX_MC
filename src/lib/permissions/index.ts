// Permissions module barrel — authorize + typed grants/identities.

export {
  POLICY_VERSION,
  MCP_SERVICE_PRINCIPAL_ID,
  SYNC_INBOUND_SERVICE_PRINCIPAL_ID,
  ROUTING_MAINTENANCE_SERVICE_PRINCIPAL_ID,
  GITHUB_ACTIONS_ROUTING_SERVICE_PRINCIPAL_ID,
  COMPLIANCE_PROJECTION_SERVICE_PRINCIPAL_ID,
  CAPABILITIES,
} from "./types";
import type {
  AccessRole,
  ActorStatus,
  AuthorizeDecision,
  AuthorizeInput,
  Capability,
  DenyReasonCode,
  GithubIdentityRecord,
  McUserRecord,
  PermissionActor,
  PermissionContext,
  PermissionResource,
  ReasonCode,
  ServicePrincipalRecord,
  IdentityQuery,
} from "./types";

export type {
  AccessRole,
  ActorStatus,
  AuthorizeDecision,
  AuthorizeInput,
  Capability,
  DenyReasonCode,
  GithubIdentityRecord,
  McUserRecord,
  PermissionActor,
  PermissionContext,
  PermissionResource,
  ReasonCode,
  ServicePrincipalRecord,
  IdentityQuery,
};

export { authorize, isCapability } from "./authorize";
export {
  capabilitiesForRole,
  capabilitiesForServicePrincipal,
  isKnownServicePrincipal,
} from "./grants";
export {
  buildGithubIdentityRecord,
  buildMcUserRecord,
  buildServicePrincipalRecord,
  isGithubIdentityActive,
  isMcUserActive,
  isServicePrincipalActive,
} from "./identities";
// Persistence finders live in ./repository (server-only / Node). Do not
// re-export them from this barrel — client code imports authorize/grants here
// and must not pull `pg` into the browser bundle.

/** Map directory/job-title strings onto access roles for compatibility callers. */
export function directoryRoleToAccessRole(role: string | undefined | null): AccessRole | null {
  if (!role) return null;
  const normalized = role.trim().toLowerCase();
  if (normalized === "owner") return "owner";
  if (normalized === "admin") return "admin";
  if (normalized === "member" || normalized === "contributor") return "member";
  // Unknown job titles still admit as member for task create/link once
  // enforcement is on; governance capabilities remain role-gated.
  return "member";
}
