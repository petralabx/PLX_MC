// Session / MCP actor derivation for routing + Task mutations.
// Never trust caller-supplied actor fields for authorization.

import { ApiError } from "@/lib/api/route";
import { auth } from "@/lib/auth";
import {
  authorizeStaged,
  recordUnresolvedActorDenial,
  resolveStagedHumanActor,
} from "@/lib/permissions/enforcement";
import type {
  Capability,
  PermissionActor,
  PermissionContext,
  PermissionResource,
} from "@/lib/permissions";
import type { McpIdentity } from "@/lib/mcp/auth";

export interface AuthorizedActor {
  actor: PermissionActor;
  /** Entra oid for humans; service principal id for services. */
  actorId: string;
  actorKind: "human" | "service";
  /** Display / audit label (email or service id) — never used as grant input. */
  auditLabel: string;
}

/** Session-authenticated human actor for Task / routing mutations. */
export async function requireSessionActor(
  capability: Capability,
  resource?: PermissionResource,
  context?: PermissionContext
): Promise<AuthorizedActor> {
  let session: { user?: { oid?: string | null; email?: string | null } } | null;
  try {
    session = (await auth()) as {
      user?: { oid?: string | null; email?: string | null };
    } | null;
  } catch {
    throw new ApiError(
      "forbidden",
      "Authenticated session with Entra oid required.",
      403
    );
  }
  const oid = session?.user?.oid?.trim();
  if (!oid) {
    throw new ApiError(
      "forbidden",
      "Authenticated session with Entra oid required.",
      403
    );
  }

  const auditLabel = session?.user?.email?.trim().toLowerCase() || oid;
  const staged = await resolveStagedHumanActor(oid);
  if (!staged.appliedActor) {
    recordUnresolvedActorDenial({
      site: "routing.session",
      capability,
      actorKind: "human",
      actorId: oid,
      resource,
      auditLabel,
    });
    throw new ApiError("forbidden", "No MC identity for session oid.", 403);
  }

  const decision = authorizeStaged({
    site: "routing.session",
    capability,
    resource,
    context,
    auditLabel,
    appliedActor: staged.appliedActor,
    shadowActor: staged.shadowActor,
    shadowMissing: staged.shadowMissing,
  });
  if (!decision.allowed) {
    throw new ApiError(
      "forbidden",
      `${capability} denied (${decision.reasonCode}).`,
      403
    );
  }

  return {
    actor: staged.appliedActor,
    actorId: oid,
    actorKind: "human",
    auditLabel,
  };
}

/** Durable MCP service principal — operator email is audit context only. */
export function requireMcpActor(
  identity: McpIdentity,
  capability: Capability,
  resource?: PermissionResource,
  context?: PermissionContext
): AuthorizedActor {
  const decision = authorizeStaged({
    site: "routing.mcp",
    capability,
    resource,
    context,
    auditLabel: identity.operatorEmail,
    appliedActor: identity.actor,
  });
  if (!decision.allowed) {
    throw new ApiError(
      "forbidden",
      `${capability} denied (${decision.reasonCode}).`,
      403
    );
  }
  return {
    actor: identity.actor,
    actorId: identity.actor.id,
    actorKind: "service",
    auditLabel: identity.operatorEmail,
  };
}

export function requireAuthorizedActor(
  authorized: AuthorizedActor,
  capability: Capability,
  resource?: PermissionResource,
  context?: PermissionContext
): void {
  const decision = authorizeStaged({
    site: "routing.recheck",
    capability,
    resource,
    context,
    auditLabel: authorized.auditLabel,
    appliedActor: authorized.actor,
  });
  if (!decision.allowed) {
    throw new ApiError(
      "forbidden",
      `${capability} denied (${decision.reasonCode}).`,
      403
    );
  }
}
