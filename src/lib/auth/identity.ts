// Session identity helpers — propagate Entra oid through JWT/session.
// Email allowlist remains the outer admission gate (gate.ts). DB hydration
// is gated by PLX_MC_PERMISSIONS_ENFORCEMENT_ENABLED so local dev/build
// never requires identity tables.

import type {
  AccessRole,
  IdentityQuery,
  McUserRecord,
  PermissionActor,
} from "@/lib/permissions";
import { directoryRoleToAccessRole } from "@/lib/permissions";
import { findMcUserByEntraOid } from "@/lib/permissions/repository";

export interface EntraProfileClaims {
  oid?: string;
  sub?: string;
  email?: string;
  preferred_username?: string;
  name?: string;
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
    };
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    oid?: string;
    email?: string;
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
 * Compatibility: map a directory Human role string into a permission actor
 * without DB lookup. Used by synchronous callers (e.g. isApprover shim).
 */
export function permissionActorFromDirectoryRole(input: {
  id: string;
  role: string;
}): PermissionActor | null {
  const accessRole: AccessRole | null = directoryRoleToAccessRole(input.role);
  if (!accessRole) return null;
  return {
    kind: "human",
    id: input.id,
    role: accessRole,
    status: "active",
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
