// Staging access gate (SOUL non-negotiable: internal Petra staff only).
// The decision lives in the `authorized` callback (src/lib/auth):
//   1. Entra OIDC (PLX_MC_AUTH_* set) — named Petra users sign in with their
//      M365 credentials; unauthenticated visitors redirect to Microsoft.
//   2. Basic-auth fallback (PLX_MC_STAGING_PASSWORD set) — break-glass.
//   3. Neither configured (local dev, tests) — open.

import { auth } from "@/lib/auth";

export default auth;

export const config = {
  // Never gate the auth endpoints themselves or static assets.
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
