// Edge-safe Auth.js config. Middleware imports this module only.
// The mc_users write stays on the Node sign-in callback in index.ts.
// Middleware does not import that module, so the Edge bundle never traces it.

import NextAuth, { type NextAuthConfig } from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

import { entraAuthConfigured, entraAuthCredentials } from "@/lib/secrets";

import {
  extractEntraOid,
  extractEntraRoles,
  toSessionIdentity,
  type EntraProfileClaims,
} from "./claims";
import { basicGate, isPublicAsset, sessionStillValid } from "./gate";

// Lazy config: secrets are read per request, never at module load.
export function edgeAuthConfig(): NextAuthConfig {
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
            // Shared machines: Microsoft asks which account every time instead
            // of silently reusing the last one (TASK-3012).
            authorization: { params: { prompt: "select_account" } },
          }),
        ]
      : [],
    callbacks: {
      // Persist Entra oid on the JWT so session callbacks can expose it.
      // Admission is decided in the Node sign-in callback; oid is the durable id.
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
      async authorized({ request, auth: session }) {
        // The sign-in page and the brand/font assets it renders must load
        // before auth, or OIDC mode loops /signin → /signin and the logo
        // 307s instead of returning an image. These paths expose no data.
        if (isPublicAsset(request.nextUrl.pathname)) return true;
        if (!entraAuthConfigured()) {
          return (await basicGate(request)) ?? true;
        }
        return !!session?.user;
      },
    },
  };
}

export const { auth } = NextAuth(edgeAuthConfig);
