// Pure gate decisions (unit-tested; edge-safe — no Node APIs).

import { isPetraEmail } from "@/lib/mc-data/helpers";

// Server-side sign-in allowlist (SOUL: domain rule enforced server-side, not
// just in the picker). Fail closed: no allowlist configured → nobody signs in.
export function isAllowedUser(
  email: unknown,
  allowlistCsv: string | undefined = process.env.PLX_MC_ALLOWED_USERS
): boolean {
  const addr = String(email ?? "")
    .trim()
    .toLowerCase();
  if (!addr || !isPetraEmail(addr)) return false;
  const allowed = (allowlistCsv ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(addr);
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
    pathname.startsWith("/brand/") ||
    pathname.startsWith("/fonts/")
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
