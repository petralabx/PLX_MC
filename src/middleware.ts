// Staging access gate (SOUL non-negotiable: internal Petra staff only).
// Two modes, decided by configuration:
//   1. Entra OIDC (Vercel: PLX_MC_AUTH_* set) — named Petra users sign in
//      with their M365 credentials; allowlist enforced server-side at the
//      signIn callback (src/lib/auth).
//   2. Basic-auth fallback (PLX_MC_STAGING_PASSWORD set, no OIDC) — the
//      break-glass shared secret.
// With neither configured (local dev, tests) the gate is dormant.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { auth, basicGate, oidcEnabled } from "@/lib/auth";

const oidcMiddleware = auth(() => undefined);

export default function middleware(req: NextRequest) {
  if (oidcEnabled()) {
    return (oidcMiddleware as unknown as (r: NextRequest) => Response | Promise<Response>)(req);
  }
  return basicGate(req) ?? NextResponse.next();
}

export const config = {
  // Never gate the auth endpoints themselves or static assets.
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
