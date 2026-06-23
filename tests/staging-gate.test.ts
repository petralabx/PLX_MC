// The staging gate's invariants. Basic mode: dormant without the secret,
// 401 without (or with wrong) credentials, pass-through with the right ones.
// OIDC mode: the allowlist is fail-closed and Petra-domain-only.

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { basicGate, isAllowedUser, isPublicAsset } from "@/lib/auth/gate";
import middleware, { config } from "@/middleware";

const req = (auth?: string) =>
  new NextRequest("http://test/", { headers: auth ? { authorization: auth } : {} });

beforeEach(() => {
  // Pin the gate state: these suites set their own credentials, regardless
  // of whatever the invoking shell has loaded.
  delete process.env.PLX_MC_AUTH_CLIENT_ID;
  delete process.env.PLX_MC_AUTH_CLIENT_SECRET;
  delete process.env.PLX_MC_STAGING_PASSWORD;
});

afterEach(() => {
  delete process.env.PLX_MC_STAGING_PASSWORD;
});

const run = async (request: Request): Promise<Response> =>
  (await (middleware as unknown as (r: Request) => Promise<unknown>)(request)) as Response;

describe("basic gate (fallback mode)", () => {
  it("is dormant when PLX_MC_STAGING_PASSWORD is unset (local dev)", async () => {
    expect(basicGate(req())).toBeNull();
    expect((await run(req())).status).toBe(200);
  });

  it("challenges requests without credentials", async () => {
    process.env.PLX_MC_STAGING_PASSWORD = "s3cret";
    const res = await run(req());
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain("Basic");
  });

  it("rejects wrong credentials and accepts the right ones", async () => {
    process.env.PLX_MC_STAGING_PASSWORD = "s3cret";
    expect((await run(req(`Basic ${btoa("plx:wrong")}`))).status).toBe(401);
    expect((await run(req(`Basic ${btoa("plx:s3cret")}`))).status).toBe(200);
  });
});

describe("OIDC sign-in allowlist", () => {
  const LIST = "ricardo@petrasoap.com, ross@petrasoap.com,VINCE@petrasoap.com";

  it("admits listed Petra users case-insensitively", () => {
    expect(isAllowedUser("ricardo@petrasoap.com", LIST)).toBe(true);
    expect(isAllowedUser("Vince@PetraSoap.com", LIST)).toBe(true);
  });

  it("rejects unlisted users even on Petra domains", () => {
    expect(isAllowedUser("someone.else@petrasoap.com", LIST)).toBe(false);
  });

  it("rejects non-Petra domains regardless of the list", () => {
    expect(isAllowedUser("ricardo@gmail.com", "ricardo@gmail.com")).toBe(false);
  });

  it("fails closed with no allowlist configured", () => {
    expect(isAllowedUser("vince@petrasoap.com", undefined)).toBe(false);
    expect(isAllowedUser("vince@petrasoap.com", "")).toBe(false);
  });
});

describe("public asset + sign-in bypass", () => {
  it("allow-lists only the sign-in page and brand/font assets", () => {
    expect(isPublicAsset("/signin")).toBe(true);
    expect(isPublicAsset("/brand/logo-horizontal-ink.png")).toBe(true);
    expect(isPublicAsset("/fonts/mazius/MaziusDisplay-Regular.woff2")).toBe(true);
    expect(isPublicAsset("/")).toBe(false);
    expect(isPublicAsset("/tasks")).toBe(false);
    // Prefix safety: a sibling route must not inherit the /brand/ bypass.
    expect(isPublicAsset("/branding")).toBe(false);
  });

  it("lets the sign-in page and brand assets through the Basic gate", async () => {
    process.env.PLX_MC_STAGING_PASSWORD = "s3cret";
    expect((await run(new NextRequest("http://test/signin"))).status).toBe(200);
    expect(
      (await run(new NextRequest("http://test/brand/logo-horizontal-ink.png"))).status
    ).toBe(200);
    // A normal route still challenges — the bypass is scoped, not a hole.
    expect((await run(req())).status).toBe(401);
  });
});

describe("middleware matcher — unauthenticated bypass list", () => {
  // The matcher decides which paths the session gate runs for at all. Only
  // endpoints that carry their OWN auth and are called with no user session may
  // be excluded — re-gating them would 302 the external caller to Microsoft
  // sign-in (the cron/webhook would silently never run). Conversely, exempting a
  // route with NO self-auth would expose the control plane (EN-007 review #3).
  const matches = (pathname: string) => new RegExp(`^${config.matcher[0]}$`).test(pathname);

  it("excludes only the self-authenticating external endpoints (cron, webhook, verify, auth)", () => {
    expect(matches("/api/cron/sweep")).toBe(false); // CRON_SECRET bearer
    expect(matches("/api/cron/reconcile")).toBe(false); // CRON_SECRET bearer
    expect(matches("/api/compliance/webhook")).toBe(false); // GitHub HMAC signature
    expect(matches("/api/compliance/verify")).toBe(false); // COMPLIANCE_CI_TOKEN bearer
    expect(matches("/api/auth/callback/microsoft-entra-id")).toBe(false);
  });

  it("still gates the app shell, its data API, and the non-self-auth control plane", () => {
    expect(matches("/")).toBe(true);
    expect(matches("/tasks")).toBe(true);
    expect(matches("/api/state")).toBe(true);
    // These have no self-auth — they MUST stay behind the session gate.
    expect(matches("/api/compliance/checkout")).toBe(true);
    expect(matches("/api/compliance/complete")).toBe(true);
    expect(matches("/api/compliance/reconcile")).toBe(true);
    expect(matches("/api/events")).toBe(true);
  });
});
