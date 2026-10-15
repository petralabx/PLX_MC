// Session identity helpers — propagate Entra oid through JWT/session.
// Admission (MC.* app role or allowlist) is decided in gate.ts. DB hydration
// is gated by PLX_MC_PERMISSIONS_ENFORCEMENT_ENABLED so local dev/build
// never requires identity tables; the sign-in mc_users write (TASK-3010)
// runs only on an Entra sign-in, which needs a deployed database anyway.

import type {
  IdentityQuery,
  McUserRecord,
  PermissionActor,
} from "@/lib/permissions";
import {
  findMcUserByEntraOid,
  revokeMcUserByEntraOid,
  upsertMcUserFromEntra,
} from "@/lib/permissions/repository";

import type { AdmissionDecision } from "./gate";

export interface EntraProfileClaims {
  oid?: string;
  sub?: string;
  email?: string;
  preferred_username?: string;
  name?: string;
  /** App roles assigned to the user (directly or through a group) on the sign-in app. */
  roles?: unknown;
}

export interface SessionIdentity {
  oid?: string;
  email?: string;
}

declare module "next-auth" {
  interface User {
    oid?: string | null;
  }

  interface Session {
    user: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
      oid?: string | null;
      roles?: string[];
    };
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    oid?: string;
    email?: string;
    roles?: string[];
    /** Epoch ms of the Entra sign-in that issued this session (gate.sessionStillValid). */
    signedInAt?: number;
  }
}

/**
 * Staged enforcement rollout (TASK-618): off → log-only → review → enforce.
 * - off       — legacy behavior: no DB hydration, humans synthesized as admin.
 * - log-only  — hydrate identities best-effort and record every decision;
 *               outcomes are unchanged (nothing new is denied).
 * - review    — service principals fully enforced (existence + revocation);
 *               humans still admitted as before, real-identity decision
 *               recorded as a shadow verdict for review.
 * - enforce   — full enforcement for humans and service principals.
 */
export type PermissionsEnforcementMode = "off" | "log-only" | "review" | "enforce";

export function permissionsEnforcementMode(): PermissionsEnforcementMode {
  const mode = (process.env.PLX_MC_PERMISSIONS_ENFORCEMENT_MODE ?? "").trim().toLowerCase();
  if (mode === "off" || mode === "log-only" || mode === "review" || mode === "enforce") {
    return mode;
  }
  // Legacy flag compatibility: ENABLED=1 has always meant full enforcement.
  const legacy = (process.env.PLX_MC_PERMISSIONS_ENFORCEMENT_ENABLED ?? "0").trim();
  return legacy === "1" ? "enforce" : "off";
}

export function permissionsEnforcementEnabled(): boolean {
  return permissionsEnforcementMode() === "enforce";
}

/** True when identity hydration may touch the database (any staged mode). */
export function permissionsIdentityHydrationEnabled(): boolean {
  return permissionsEnforcementMode() !== "off";
}

export function extractEntraOid(
  profile: EntraProfileClaims | null | undefined
): string | null {
  const oid = profile?.oid?.trim();
  return oid ? oid : null;
}

/**
 * App-role values from the ID token (e.g. "Goals.Viewer"). Read once at sign-in,
 * so a role change applies at the user's next sign-in.
 */
export function extractEntraRoles(profile: EntraProfileClaims | null | undefined): string[] {
  const roles = profile?.roles;
  return Array.isArray(roles) ? roles.filter((r): r is string => typeof r === "string" && r.trim() !== "") : [];
}

export function toSessionIdentity(input: {
  oid?: string | null;
  email?: string | null;
}): SessionIdentity {
  const email = input.email?.trim().toLowerCase() || undefined;
  const oid = input.oid?.trim() || undefined;
  return { oid, email };
}

/**
 * Build a permission actor from an already-hydrated MC user record.
 * Does not touch the database — callers hydrate only when enforcement is on.
 */
export function permissionActorFromMcUser(user: McUserRecord): PermissionActor {
  return {
    kind: "human",
    id: user.entraOid,
    role: user.accessRole,
    status: user.status,
  };
}

/**
 * Optional DB hydration seam. When enforcement is disabled/unconfigured this
 * returns null immediately and never opens a database connection — local
 * Next.js builds and dormant auth mode stay DB-free.
 */
export async function hydrateMcUserByOid(
  entraOid: string,
  runQuery?: IdentityQuery
): Promise<McUserRecord | null> {
  if (!permissionsIdentityHydrationEnabled()) {
    return null;
  }
  return findMcUserByEntraOid(entraOid, runQuery);
}

export type McUserSignInSync = "upserted" | "revoked" | "unchanged" | "failed";

/**
 * Write the sign-in's admission to mc_users (TASK-3010):
 * - MC.* role → create/update the row with that access_role, status active.
 * - allowlist only → no role claim to write; an existing row is left as is.
 * - refused → mark an existing row revoked.
 * Never throws: a failed write is logged and admission alone decides the
 * sign-in, so the database can neither grant nor block it.
 */
export async function syncMcUserAtSignIn(
  input: { claims: EntraProfileClaims | null | undefined; decision: AdmissionDecision },
  runQuery?: IdentityQuery
): Promise<McUserSignInSync> {
  const { claims, decision } = input;
  if (decision.admitted && !decision.accessRole) return "unchanged";
  const oid = extractEntraOid(claims);
  const email = (claims?.email ?? claims?.preferred_username)?.trim().toLowerCase();
  if (!oid || (decision.accessRole && !email)) {
    console.error(
      "[auth] mc_users sign-in sync skipped: ID token has no %s (admitted=%s)",
      oid ? "email" : "oid",
      String(decision.admitted)
    );
    return "failed";
  }
  try {
    if (decision.accessRole && email) {
      await upsertMcUserFromEntra(
        { entraOid: oid, email, displayName: claims?.name?.trim() || null, accessRole: decision.accessRole },
        runQuery
      );
      return "upserted";
    }
    await revokeMcUserByEntraOid(oid, runQuery);
    return "revoked";
  } catch (err) {
    console.error(
      "[auth] mc_users sign-in sync FAILED for oid %s (admitted=%s, role=%s): %s",
      oid,
      String(decision.admitted),
      decision.accessRole ?? "none",
      err instanceof Error ? err.message : String(err)
    );
    return "failed";
  }
}
