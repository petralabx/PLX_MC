// Pure gate decisions (unit-tested; edge-safe — no Node APIs).

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

// A signed-in session lasts 12 hours from sign-in, however often it is used.
// Entra app roles (e.g. Goals.Viewer) are only read at sign-in, so this bounds
// how long a role change waits, and a session with no sign-in stamp (issued
// before TASK-2977) ends at once so it picks up roles assigned since.
export const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** Whether an existing session may continue: signed in within 12h and still allowlisted. */
export function sessionStillValid(
  token: { email?: unknown; signedInAt?: unknown },
  now: number = Date.now(),
  allowlistCsv: string | undefined = process.env.PLX_MC_ALLOWED_USERS
): boolean {
  const signedInAt = token.signedInAt;
  if (typeof signedInAt !== "number" || !Number.isFinite(signedInAt)) return false;
  if (signedInAt > now || now - signedInAt >= SESSION_MAX_AGE_MS) return false;
  return isAllowedUser(token.email, allowlistCsv);
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

const sha256 = async (value: string) =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));

/**
 * The one shared-secret check (CRON_SECRET bearer, Basic break-glass, CI
 * token). Fails closed when the secret is unset or blank, so `Bearer ` or
 * `Bearer undefined` never match. Both sides are hashed first and compared
 * without early exit, so neither content nor length leaks through timing.
 * Web Crypto keeps it usable in the edge middleware as well as Node routes.
 */
export async function secretMatches(
  provided: string | null | undefined,
  secret: string | null | undefined,
  prefix = ""
): Promise<boolean> {
  if (!secret?.trim() || provided == null) return false;
  const [got, want] = await Promise.all([sha256(provided), sha256(`${prefix}${secret}`)]);
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}

/** Entra end-session URL: ends the Microsoft session, then returns to /signin. */
export function entraLogoutUrl(tenantId: string, origin: string): string {
  const url = new URL(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/logout`);
  url.searchParams.set("post_logout_redirect_uri", new URL("/signin", origin).toString());
  return url.toString();
}

// Basic-auth fallback gate (used only when Entra OIDC is not configured):
// dormant without the shared secret, 401 challenge otherwise.
export async function basicGate(req: Request): Promise<Response | null> {
  const password = process.env.PLX_MC_STAGING_PASSWORD;
  if (!password) return null;
  const header = req.headers.get("authorization");
  if (await secretMatches(header, btoa(`plx:${password}`), "Basic ")) return null;
  return new Response("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="PLX Mission Control staging"' },
  });
}
