// The middleware matcher decides which paths the session gate runs for at all.
// Run it the way Next does (unstable_doesMiddlewareMatch compiles config.matcher
// with Next's own matcher semantics) and assert real paths, not the source text.
// Each carve-out covers only its own path segment and its children (TASK-3012):
// a sibling such as /api/cursorX or /signin-anything stays behind the gate.
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { config } from "@/middleware";

const gated = (path: string) =>
  unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: `https://example.test${path}` });

describe("middleware matcher", () => {
  it.each([
    "/api/auth/callback/microsoft-entra-id",
    "/api/auth/signout",
    "/api/cron/sweep",
    "/api/cron/reconcile",
    "/api/cron/x",
    "/api/sync/webhook",
    "/api/compliance/webhook",
    "/api/compliance/verify",
    "/api/routing/propose",
    "/api/cursor",
    "/api/cursor/mcp",
    "/_next/static/chunks/main.js",
    "/_next/image",
    "/favicon.ico",
    "/signin",
    "/brand/x.svg",
    "/fonts/mazius/MaziusDisplay-Regular.woff2",
    "/presentations/plx-platform-vision.html",
  ])("exempts self-authenticating or public path %s", (path) => expect(gated(path)).toBe(false));

  it.each([
    // Prefix siblings must not inherit a carve-out.
    "/api/authX",
    "/api/cronX",
    "/api/cron-jobs/run",
    "/api/cursorX",
    "/api/cursor-admin",
    "/api/sync/webhookX",
    "/api/compliance/webhookX",
    "/api/compliance/verifyX",
    "/api/routing/proposeX",
    "/_next/staticX",
    "/favicon.icoX",
    "/faviconXico",
    "/signin-anything",
    "/signinX",
    "/brandX",
    "/branding",
    "/fontsX",
    "/presentationsX",
    // Exact carve-outs do not widen to their parent.
    "/api/routing/other",
    "/api/sync/other",
    // No self-auth: these MUST stay behind the session gate (EN-007 review #3).
    "/api/compliance/checkout",
    "/api/compliance/complete",
    "/api/compliance/reconcile",
    "/api/events",
    "/api/state",
    "/",
    "/tasks",
  ])("keeps %s behind the session gate", (path) => expect(gated(path)).toBe(true));
});
