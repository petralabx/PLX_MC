// Staged enforcement rollout helpers (TASK-618) + decision recording wiring
// (TASK-620). One shared choke point resolves actors per the enforcement mode
// and records every applied decision, so call sites cannot drift:
//
//   off       — legacy actors, no DB, no recording.
//   log-only  — legacy outcomes; real identities hydrated best-effort and
//               recorded as shadow verdicts alongside the applied decision.
//   review    — service principals fail-closed on the durable registry;
//               humans keep legacy outcomes with shadow verdicts recorded.
//   enforce   — real identities everywhere; callers fail closed.
//
// Server-only: resolvers touch the identity repository. Do not export from
// the permissions barrel (client code imports authorize/grants there).

import {
  permissionsEnforcementMode,
  type PermissionsEnforcementMode,
} from "@/lib/auth/identity";
import { authorize } from "./authorize";
import { recordPermissionDecision } from "./decision-log";
import { findMcUserByEntraOid, findServicePrincipalById } from "./repository";
import {
  POLICY_VERSION,
  type AuthorizeDecision,
  type Capability,
  type IdentityQuery,
  type PermissionActor,
  type PermissionContext,
  type PermissionResource,
} from "./types";

export interface StagedHumanActor {
  /** Actor whose decision is applied; null = enforce mode with no identity row. */
  appliedActor: PermissionActor | null;
  /** Hydrated real identity while staged modes still apply legacy behavior. */
  shadowActor: PermissionActor | null;
  /** Hydration ran and found no identity row (staged modes only). */
  shadowMissing: boolean;
  mode: PermissionsEnforcementMode;
}

/**
 * Resolve a session human actor per the enforcement mode. In enforce mode
 * repository errors propagate (fail closed); in staged modes hydration is
 * best-effort and never blocks the legacy outcome.
 */
export async function resolveStagedHumanActor(
  oid: string,
  runQuery?: IdentityQuery
): Promise<StagedHumanActor> {
  const mode = permissionsEnforcementMode();
  const legacyActor: PermissionActor = {
    kind: "human",
    id: oid,
    role: "admin",
    status: "active",
  };

  if (mode === "off") {
    return { appliedActor: legacyActor, shadowActor: null, shadowMissing: false, mode };
  }

  if (mode === "enforce") {
    const user = await findMcUserByEntraOid(oid, runQuery);
    return {
      appliedActor: user
        ? { kind: "human", id: user.entraOid, role: user.accessRole, status: user.status }
        : null,
      shadowActor: null,
      shadowMissing: false,
      mode,
    };
  }

  // log-only / review: humans keep the legacy outcome; hydrate for the shadow
  // verdict, fail-open on any repository error.
  let shadowActor: PermissionActor | null = null;
  let shadowMissing = false;
  try {
    const user = await findMcUserByEntraOid(oid, runQuery);
    if (user) {
      shadowActor = {
        kind: "human",
        id: user.entraOid,
        role: user.accessRole,
        status: user.status,
      };
    } else {
      shadowMissing = true;
    }
  } catch (err) {
    console.error(
      "[permissions] staged human hydration failed (fail-open): %s",
      err instanceof Error ? err.message : String(err)
    );
  }
  return { appliedActor: legacyActor, shadowActor, shadowMissing, mode };
}

export interface StagedServiceActor {
  /** Actor whose decision is applied; null = fail-closed mode with no row. */
  actor: PermissionActor | null;
  /** Principal row definitively missing in a fail-closed mode. */
  missing: boolean;
  /** Real-status actor when it differs from the applied actor (log-only). */
  shadowActor: PermissionActor | null;
  /** Lookup ran and found no principal row (log-only). */
  shadowMissing: boolean;
  mode: PermissionsEnforcementMode;
}

/**
 * Resolve a durable service principal per the enforcement mode. Service
 * principals fail closed from "review" onward; in log-only the registry is
 * consulted best-effort for the shadow verdict only.
 */
export async function resolveStagedServicePrincipal(
  id: string,
  runQuery?: IdentityQuery
): Promise<StagedServiceActor> {
  const mode = permissionsEnforcementMode();
  const assumedActive: PermissionActor = { kind: "service", id, status: "active" };

  if (mode === "off") {
    return {
      actor: assumedActive,
      missing: false,
      shadowActor: null,
      shadowMissing: false,
      mode,
    };
  }

  if (mode === "log-only") {
    let shadowActor: PermissionActor | null = null;
    let shadowMissing = false;
    try {
      const principal = await findServicePrincipalById(id, runQuery);
      if (principal) {
        if (principal.status !== "active") {
          shadowActor = { kind: "service", id: principal.id, status: principal.status };
        }
      } else {
        shadowMissing = true;
      }
    } catch (err) {
      console.error(
        "[permissions] staged principal lookup failed (fail-open): %s",
        err instanceof Error ? err.message : String(err)
      );
    }
    return { actor: assumedActive, missing: false, shadowActor, shadowMissing, mode };
  }

  // review / enforce: fail closed on the durable registry.
  const principal = await findServicePrincipalById(id, runQuery);
  if (!principal) {
    return { actor: null, missing: true, shadowActor: null, shadowMissing: false, mode };
  }
  return {
    actor: { kind: "service", id: principal.id, status: principal.status },
    missing: false,
    shadowActor: null,
    shadowMissing: false,
    mode,
  };
}

/**
 * Record a fail-closed denial where no actor could be resolved (missing
 * identity row / principal row), so even pre-authorize rejections land in the
 * decision audit. Fire-and-forget, fail-open.
 */
export function recordUnresolvedActorDenial(input: {
  site: string;
  capability: Capability;
  actorKind: "human" | "service";
  actorId: string;
  resource?: PermissionResource;
  auditLabel?: string;
}): void {
  void recordPermissionDecision({
    site: input.site,
    actorKind: input.actorKind,
    actorId: input.actorId,
    capability: input.capability,
    resourceType: input.resource?.type,
    resourceId: input.resource && "id" in input.resource ? input.resource.id : undefined,
    allowed: false,
    reasonCode: "unknown_actor",
    policyVersion: POLICY_VERSION,
    auditLabel: input.auditLabel,
  });
}

export interface StagedDecisionInput {
  /** Stable call-site tag, e.g. "routing.session" or "mcp.actor". */
  site: string;
  capability: Capability;
  resource?: PermissionResource;
  context?: PermissionContext;
  auditLabel?: string;
  appliedActor: PermissionActor;
  shadowActor?: PermissionActor | null;
  shadowMissing?: boolean;
}

/**
 * Authorize with the applied actor, evaluate the shadow verdict when staged,
 * and record the decision (fire-and-forget, fail-open). Returns the applied
 * decision — callers keep their own deny handling.
 */
export function authorizeStaged(input: StagedDecisionInput): AuthorizeDecision {
  const decision = authorize({
    actor: input.appliedActor,
    capability: input.capability,
    resource: input.resource,
    context: input.context,
  });

  let shadowAllowed: boolean | undefined;
  let shadowReasonCode: string | undefined;
  if (input.shadowMissing) {
    shadowAllowed = false;
    shadowReasonCode = "unknown_actor";
  } else if (input.shadowActor) {
    const shadow = authorize({
      actor: input.shadowActor,
      capability: input.capability,
      resource: input.resource,
      context: input.context,
    });
    shadowAllowed = shadow.allowed;
    shadowReasonCode = shadow.reasonCode;
  }

  void recordPermissionDecision({
    site: input.site,
    actorKind: input.appliedActor.kind,
    actorId: input.appliedActor.id,
    capability: input.capability,
    resourceType: input.resource?.type,
    resourceId: input.resource && "id" in input.resource ? input.resource.id : undefined,
    allowed: decision.allowed,
    reasonCode: decision.reasonCode,
    policyVersion: decision.policyVersion,
    shadowAllowed,
    shadowReasonCode,
    auditLabel: input.auditLabel,
  });

  return decision;
}
