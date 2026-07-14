// Versioned human role bundles and durable service-principal capability sets.

import type { AccessRole, Capability } from "./types";
import {
  COMPLIANCE_PROJECTION_SERVICE_PRINCIPAL_ID,
  GITHUB_ACTIONS_ROUTING_SERVICE_PRINCIPAL_ID,
  MCP_SERVICE_PRINCIPAL_ID,
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

const SERVICE_GRANTS: Record<string, readonly Capability[]> = {
  [MCP_SERVICE_PRINCIPAL_ID]: [
    "task.read",
    "task.checkout",
    "task.progress",
    "task.complete",
    "routing.suggest",
    "routing.propose",
  ],
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
