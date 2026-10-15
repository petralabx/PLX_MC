// Microsoft Entra ID sign-in for the staging deployment (MC.* app roles, with
// the operator-named allowlist as transition / break-glass — TASK-3010; users
// authenticate with their Petra M365 credentials). Active
// only when the PLX_MC_AUTH_* secrets are configured (Vercel); local dev and
// tests fall back to the Basic gate / open access via the middleware.
//
// App registration: `plx-mission-control` (created 2026-06-11 via Graph),
// auth-code flow, redirect /api/auth/callback/microsoft-entra-id.

import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

import { entraAuthConfigured, entraAuthCredentials } from "@/lib/secrets";

import { admissionDecision, basicGate, isPublicAsset, sessionStillValid } from "./gate";
import {
  extractEntraOid,
  extractEntraRoles,
  syncMcUserAtSignIn,
  toSessionIdentity,
  type EntraProfileClaims,
} from "./identity";

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
      // Admission (TASK-3010): an MC.* app role, or PLX_MC_ALLOWED_USERS
      // (transition / break-glass). Runs only on the OAuth callback route
      // (/api/auth is outside the middleware matcher), so the mc_users write
      // never runs in middleware. A failed write is logged, never decides.
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
      // Persist Entra oid on the JWT so session callbacks can expose it.
      // Admission is decided in signIn above; oid is the durable id.
      jwt({ token, profile }) {
        if (profile) {
          const claims = profile as EntraProfileClaims;
          const oid = extractEntraOid(claims);
          if (oid) token.oid = oid;
          const email = (claims.email ?? claims.preferred_username)?.trim().toLowerCase();
          if (email) token.email = email;
          // App roles (e.g. Goals.Viewer / Goals.Editor), assigned to groups on
          // the sign-in app. Refreshed at each sign-in.
          token.roles = extractEntraRoles(claims);
          token.signedInAt = Date.now();
          return token;
        }
        // Existing session: end it after 12h, when it predates the sign-in
        // stamp, or once it holds no MC.* role and the email leaves the
        // allowlist (null signs out).
        return sessionStillValid(token) ? token : null;
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
          session.user.roles = Array.isArray(token.roles) ? token.roles : [];
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
