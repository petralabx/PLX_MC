// Staging access gate (SOUL non-negotiable: internal Petra staff only).
// The decision lives in the `authorized` callback (src/lib/auth):
//   1. Entra OIDC (PLX_MC_AUTH_* set) — named Petra users sign in with their
//      M365 credentials; unauthenticated visitors redirect to Microsoft.
//   2. Basic-auth fallback (PLX_MC_STAGING_PASSWORD set) — break-glass.
//   3. Neither configured (local dev, tests) — open.

import { auth } from "@/lib/auth";

export default auth;

export const config = {
  // Never gate endpoints that carry their OWN authentication and are invoked
  // with no user session: the auth endpoints, the Vercel Cron sweep
  // (`src/app/api/cron/sweep` — CRON_SECRET bearer), the GitHub compliance
  // webhook (`src/app/api/compliance/webhook` — HMAC signature), and the
  // compliance verify endpoint (`src/app/api/compliance/verify` — CI bearer
  // token). Also exempt framework static assets, the branded sign-in page, and
  // the brand/font assets it renders (those load pre-auth; `authorized` also
  // allow-lists them via isPublicAsset).
  //
  // SECURITY: each carve-out is path-EXACT and only for a route that
  // self-authenticates. The remaining compliance routes
  // (checkout/complete/reconcile) and `/api/events` do NOT self-authenticate, so
  // they stay behind the gate — exempting `api/compliance` broadly would make the
  // control plane world-callable (EN-007 runbook, review #3).
  matcher: [
    "/((?!api/auth|api/cron|api/compliance/webhook|api/compliance/verify|_next/static|_next/image|favicon.ico|signin|brand|fonts).*)",
  ],
};
