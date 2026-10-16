// Entra claim reads for the JWT and the session. No database imports:
// middleware's Edge bundle loads this through the Edge auth entry.

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
