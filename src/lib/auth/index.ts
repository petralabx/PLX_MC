// Microsoft Entra ID sign-in for the staging deployment (operator-named
// allowlist; users authenticate with their Petra M365 credentials). Active
// only when the PLX_MC_AUTH_* secrets are configured (Vercel); local dev and
// tests fall back to the Basic gate / open access via the middleware.
//
// App registration: `plx-mission-control` (created 2026-06-11 via Graph),
// auth-code flow, redirect /api/auth/callback/microsoft-entra-id.

import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

import { entraAuthConfigured, entraAuthCredentials } from "@/lib/secrets";

import { basicGate, isAllowedUser, isPublicAsset } from "./gate";
import { extractEntraOid, toSessionIdentity, type EntraProfileClaims } from "./identity";

export { basicGate, isAllowedUser } from "./gate";
export {
  extractEntraOid,
  hydrateMcUserByOid,
  permissionsEnforcementEnabled,
  permissionsEnforcementMode,
  permissionsIdentityHydrationEnabled,
  permissionActorFromDirectoryRole,
  permissionActorFromMcUser,
  toSessionIdentity,
  type PermissionsEnforcementMode,
} from "./identity";
export const oidcEnabled = entraAuthConfigured;

// Lazy config: secrets are read per-request, never at module load — builds
// and local dev must not require AUTH_SECRET to merely import this module.
export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  const creds = entraAuthConfigured() ? entraAuthCredentials() : null;
  return {
    trustHost: true,
    // In dormant mode no provider exists, no session can ever be issued, and
    // `authorized` ignores sessions entirely — the placeholder only keeps the
    // JWT plumbing from throwing in local dev/tests.
    secret: creds?.authSecret ?? "plx-mc-dormant-mode-placeholder",
    session: { strategy: "jwt" },
    // The branded sign-in page replaces Auth.js's default /api/auth/signin
    // screen — the only surface an unauthenticated visitor ever sees.
    pages: { signIn: "/signin" },
    providers: creds
      ? [
          MicrosoftEntraID({
            clientId: creds.clientId,
            clientSecret: creds.clientSecret,
            issuer: `https://login.microsoftonline.com/${creds.tenantId}/v2.0`,
          }),
        ]
      : [],
    callbacks: {
      signIn({ profile }) {
        const claims = profile as EntraProfileClaims | null;
        return isAllowedUser(claims?.email ?? claims?.preferred_username);
      },
      // Persist Entra oid on the JWT so session callbacks can expose it.
      // Email allowlist remains the admission gate above; oid is durable id.
      jwt({ token, profile }) {
        if (profile) {
          const claims = profile as EntraProfileClaims;
          const oid = extractEntraOid(claims);
          if (oid) token.oid = oid;
          const email = (claims.email ?? claims.preferred_username)?.trim().toLowerCase();
          if (email) token.email = email;
        }
        return token;
      },
      session({ session, token }) {
        const identity = toSessionIdentity({
          oid: typeof token.oid === "string" ? token.oid : undefined,
          email:
            (typeof token.email === "string" ? token.email : undefined) ??
            session.user?.email,
        });
        if (session.user) {
          session.user.oid = identity.oid ?? null;
          if (identity.email) session.user.email = identity.email;
        }
        return session;
      },
      // Drives the middleware (src/middleware.ts default-exports `auth`):
      // OIDC mode: unauthenticated → false → redirect to Microsoft sign-in.
      // Dormant/fallback mode: the Basic gate decides (Response = challenge).
      authorized({ request, auth: session }) {
        // The sign-in page and the brand/font assets it renders must load
        // before auth, or OIDC mode loops /signin → /signin and the logo
        // 307s instead of returning an image. These paths expose no data.
        if (isPublicAsset(request.nextUrl.pathname)) return true;
        if (!entraAuthConfigured()) {
          return basicGate(request) ?? true;
        }
        return !!session?.user;
      },
    },
  };
});
