// Pure gate decisions (unit-tested; edge-safe — no Node APIs).

import type { AccessRole } from "@/lib/permissions/types";

// Server-side sign-in + MCP operator allowlist. Exact case-insensitive CSV
// match is sufficient — Vince-approved non-Petra exceptions (gmail/Proton)
// are admitted when listed. Fail closed: empty/undefined CSV → nobody is
// admitted. Unlisted emails are denied. Petra domain remains a picker helper
// (`isPetraEmail`); it is not a veto of an explicit list entry.
export function isAllowedUser(
  email: unknown,
  allowlistCsv: string | undefined = process.env.PLX_MC_ALLOWED_USERS
): boolean {
  const addr = String(email ?? "")
    .trim()
    .toLowerCase();
  if (!addr) return false;
  const allowed = (allowlistCsv ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return false;
  return allowed.includes(addr);
}

// Entra app roles on plx-mission-control that admit to MC and set the
// mc_users access_role (TASK-3010). Values are case-sensitive, as Entra
// issues them. Highest role wins when several are assigned.
export const MC_APP_ROLES: Readonly<Record<string, AccessRole>> = {
  "MC.Owner": "owner",
  "MC.Admin": "admin",
  "MC.Member": "member",
};

const ACCESS_ROLE_RANK: Record<AccessRole, number> = { member: 1, admin: 2, owner: 3 };

/** The MC access role carried by the ID token's `roles` claim, or null when it has no MC.* role. */
export function accessRoleFromEntraRoles(roles: unknown): AccessRole | null {
  if (!Array.isArray(roles)) return null;
  let best: AccessRole | null = null;
  for (const value of roles) {
    const role = typeof value === "string" ? MC_APP_ROLES[value] : undefined;
    if (role && (!best || ACCESS_ROLE_RANK[role] > ACCESS_ROLE_RANK[best])) best = role;
  }
  return best;
}

export interface AdmissionDecision {
  admitted: boolean;
  /** "role" = an MC.* app role; "allowlist" = PLX_MC_ALLOWED_USERS (transition / break-glass). */
  via: "role" | "allowlist" | null;
  /** The access_role to write to mc_users; null when no MC.* role was presented. */
  accessRole: AccessRole | null;
}

/**
 * Who may sign in (TASK-3010): anyone holding an MC.* app role, or — while the
 * roles are rolled out, and afterwards as break-glass — anyone on
 * PLX_MC_ALLOWED_USERS. Neither → refused.
 */
export function admissionDecision(
  input: { email: unknown; roles: unknown },
  allowlistCsv: string | undefined = process.env.PLX_MC_ALLOWED_USERS
): AdmissionDecision {
  const accessRole = accessRoleFromEntraRoles(input.roles);
  if (accessRole) return { admitted: true, via: "role", accessRole };
  if (isAllowedUser(input.email, allowlistCsv)) return { admitted: true, via: "allowlist", accessRole: null };
  return { admitted: false, via: null, accessRole: null };
}

// A signed-in session lasts 12 hours from sign-in, however often it is used.
// Entra app roles (e.g. Goals.Viewer) are only read at sign-in, so this bounds
// how long a role change waits, and a session with no sign-in stamp (issued
// before TASK-2977) ends at once so it picks up roles assigned since.
export const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/**
 * Whether an existing session may continue: signed in within 12h and still
 * admitted — an MC.* role from sign-in, or the email still on the allowlist.
 */
export function sessionStillValid(
  token: { email?: unknown; roles?: unknown; signedInAt?: unknown },
  now: number = Date.now(),
  allowlistCsv: string | undefined = process.env.PLX_MC_ALLOWED_USERS
): boolean {
  const signedInAt = token.signedInAt;
  if (typeof signedInAt !== "number" || !Number.isFinite(signedInAt)) return false;
  if (signedInAt > now || now - signedInAt >= SESSION_MAX_AGE_MS) return false;
  return admissionDecision({ email: token.email, roles: token.roles }, allowlistCsv).admitted;
}

// Public, non-sensitive paths that must load BEFORE authentication: the
// branded sign-in page and the static brand assets it renders (logo,
// favicons, webfonts). Without this bypass an unauthenticated visitor in OIDC
// mode is redirected to pages.signIn (/signin), which is itself gated — an
// infinite redirect loop — and the /brand favicons resolve to a redirect
// instead of an image. None of these paths expose data.
export function isPublicAsset(pathname: string): boolean {
  return (
    pathname === "/signin" ||
    pathname === "/welcome" ||
    pathname.startsWith("/brand/") ||
    pathname.startsWith("/fonts/") ||
    pathname.startsWith("/presentations/")
  );
}

// Basic-auth fallback gate (used only when Entra OIDC is not configured):
// dormant without the shared secret, 401 challenge otherwise.
export function basicGate(req: Request): Response | null {
  const password = process.env.PLX_MC_STAGING_PASSWORD;
  if (!password) return null;
  const header = req.headers.get("authorization") ?? "";
  if (header === `Basic ${btoa(`plx:${password}`)}`) return null;
  return new Response("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="PLX Mission Control staging"' },
  });
}
