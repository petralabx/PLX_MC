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

import { basicGate, isAllowedUser } from "./gate";

export { basicGate, isAllowedUser } from "./gate";
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
        const claims = profile as { email?: string; preferred_username?: string } | null;
        return isAllowedUser(claims?.email ?? claims?.preferred_username);
      },
      // Drives the middleware (src/middleware.ts default-exports `auth`):
      // OIDC mode: unauthenticated → false → redirect to Microsoft sign-in.
      // Dormant/fallback mode: the Basic gate decides (Response = challenge).
      authorized({ request, auth: session }) {
        if (!entraAuthConfigured()) {
          return basicGate(request) ?? true;
        }
        return !!session?.user;
      },
    },
  };
});
