// Microsoft Entra ID sign-in for the staging deployment (MC.* app roles, with
// the operator-named allowlist as transition / break-glass — TASK-3010; users
// authenticate with their Petra M365 credentials). Active
// only when the PLX_MC_AUTH_* secrets are configured (Vercel); local dev and
// tests fall back to the Basic gate / open access via the middleware.
//
// App registration: `plx-mission-control` (created 2026-06-11 via Graph),
// auth-code flow, redirect /api/auth/callback/microsoft-entra-id.

import NextAuth from "next-auth";

import { entraAuthConfigured } from "@/lib/secrets";

import { edgeAuthConfig } from "./edge";
import { admissionDecision } from "./gate";
import { extractEntraRoles, syncMcUserAtSignIn, type EntraProfileClaims } from "./identity";

export { basicGate, isAllowedUser } from "./gate";
export {
  extractEntraOid,
  extractEntraRoles,
  hydrateMcUserByOid,
  permissionsEnforcementEnabled,
  permissionsEnforcementMode,
  permissionsIdentityHydrationEnabled,
  permissionActorFromMcUser,
  toSessionIdentity,
  type PermissionsEnforcementMode,
} from "./identity";
export const oidcEnabled = entraAuthConfigured;

// Node handlers. The Edge middleware uses edge.ts instead, so this sign-in
// write is not in the Edge bundle. A failed write is logged, never decides.
export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  const config = edgeAuthConfig();
  return {
    ...config,
    callbacks: {
      ...config.callbacks,
      // Admission (TASK-3010): an MC.* app role, or PLX_MC_ALLOWED_USERS
      // (transition / break-glass). Runs on the OAuth callback route
      // (/api/auth is outside the middleware matcher).
      async signIn({ profile }) {
        const claims = profile as EntraProfileClaims | null;
        const email = claims?.email ?? claims?.preferred_username;
        const decision = admissionDecision({ email, roles: extractEntraRoles(claims) });
        if (decision.via === "allowlist") {
          // Who still needs an MC.* role before the allowlist can be emptied.
          console.warn("[auth] admitted by PLX_MC_ALLOWED_USERS without an MC.* app role: %s", email);
        }
        await syncMcUserAtSignIn({ claims, decision });
        return decision.admitted;
      },
    },
  };
});
