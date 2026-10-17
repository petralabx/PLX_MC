// TASK-3161: once a session ends (12h cap, TASK-2977; admission re-check,
// TASK-3010), an API call must not follow the middleware's redirect to the
// sign-in page and report "non-JSON response (200)". The middleware answers
// /api/* with 401 signin_required; a read through api()/apiDownload() sends the
// browser to /signin, which returns it to the same screen after sign-in. A
// write fails with the message and stays on the page, keeping unsaved input.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ entraAuthConfigured: vi.fn() }));

vi.mock("next-auth", () => ({ default: () => ({ auth: vi.fn() }) }));
vi.mock("next-auth/providers/microsoft-entra-id", () => ({ default: (options: unknown) => ({ options }) }));
vi.mock("@/lib/secrets", () => ({
  entraAuthConfigured: m.entraAuthConfigured,
  entraAuthCredentials: () => ({
    tenantId: "tenant-1",
    clientId: "client-1",
    clientSecret: "client-secret",
    authSecret: "auth-secret",
  }),
}));

import { edgeAuthConfig } from "@/lib/auth/edge";
import { signInReturnPath } from "@/lib/auth/gate";

type Authorized = (params: { request: unknown; auth: unknown }) => Promise<unknown>;
const authorized = edgeAuthConfig().callbacks!.authorized as unknown as Authorized;
const gate = (path: string, auth: unknown) => authorized({ request: { nextUrl: new URL(`https://mc.test${path}`) }, auth });

const signinRequired = {
  error: { code: "signin_required", message: "Sign in to Mission Control: there is no session, or it has ended." },
};

describe("middleware gate without a session", () => {
  beforeEach(() => m.entraAuthConfigured.mockReset().mockReturnValue(true));

  it.each(["/api/governance-sops", "/api/architecture/model", "/api"])(
    "answers the API call %s with 401 signin_required JSON, not a redirect to the sign-in page",
    async (path) => {
      const res = (await gate(path, null)) as Response;
      expect(res).toBeInstanceOf(Response);
      expect(res.status).toBe(401);
      expect(res.headers.get("location")).toBeNull();
      expect(res.headers.get("www-authenticate")).toBeNull();
      expect(await res.json()).toEqual(signinRequired);
    }
  );

  it("still redirects a page or static file request to sign in", async () => {
    expect(await gate("/", null)).toBe(false);
    expect(await gate("/apiX", null)).toBe(false);
    expect(await gate("/architecture/context.svg", { expires: "x" })).toBe(false);
  });

  it("admits a signed-in session and the public sign-in assets", async () => {
    expect(await gate("/api/state", { user: { email: "vince@petrasoap.com" } })).toBe(true);
    expect(await gate("/signin", null)).toBe(true);
  });

  it("leaves dormant mode open", async () => {
    m.entraAuthConfigured.mockReturnValue(false);
    expect(await gate("/api/state", null)).toBe(true);
  });
});

describe("api() and apiDownload() when sign-in is required", () => {
  const assign = vi.fn();
  const signinUrl = "/signin?callbackUrl=%2F%3Fscreen%3Dgovernance-sops";

  beforeEach(() => {
    vi.resetModules();
    assign.mockReset();
    vi.stubGlobal("window", { location: { pathname: "/", search: "?screen=governance-sops", assign } });
  });
  afterEach(() => vi.unstubAllGlobals());

  const respond = (status: number, body: unknown) =>
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(body, { status })));

  it("sends a read to sign in and back to this screen; every concurrent read lands on the same URL", async () => {
    respond(401, signinRequired);
    const { api, ApiClientError } = await import("@/lib/api");
    const results = await Promise.allSettled([api("/governance-sops"), api("/skills-directory")]);
    for (const result of results) {
      expect(result.status).toBe("rejected");
      const reason = (result as PromiseRejectedResult).reason;
      expect(reason).toBeInstanceOf(ApiClientError);
      expect(reason.code).toBe("signin_required");
    }
    expect(assign).toHaveBeenCalled();
    for (const call of assign.mock.calls) expect(call).toEqual([signinUrl]);
  });

  it("redirects again on a later read (no one-shot latch, e.g. after Back restores the page)", async () => {
    respond(401, signinRequired);
    const { api } = await import("@/lib/api");
    await expect(api("/governance-sops")).rejects.toMatchObject({ code: "signin_required" });
    await expect(api("/governance-sops")).rejects.toMatchObject({ code: "signin_required" });
    expect(assign).toHaveBeenCalledTimes(2);
  });

  it("does the same for a file download", async () => {
    respond(401, signinRequired);
    const { apiDownload } = await import("@/lib/api");
    await expect(apiDownload("/reporting/goals/export")).rejects.toMatchObject({ code: "signin_required" });
    expect(assign).toHaveBeenCalledWith(signinUrl);
  });

  it("keeps a write on the page with the sign-in message, so unsaved input is not lost", async () => {
    respond(401, signinRequired);
    const { api } = await import("@/lib/api");
    await expect(
      api("/tasks/TASK-1/comments", { method: "PATCH", body: "{}" })
    ).rejects.toMatchObject({ code: "signin_required", message: signinRequired.error.message });
    expect(assign).not.toHaveBeenCalled();
  });

  it("does not redirect on a route's own not_authenticated, which a live session can hit (no sign-in loop)", async () => {
    respond(401, { error: { code: "not_authenticated", message: "Sign in to see Goals & production." } });
    const { api } = await import("@/lib/api");
    await expect(api("/reporting/goals")).rejects.toMatchObject({ code: "not_authenticated" });
    expect(assign).not.toHaveBeenCalled();
  });
});

describe("signInReturnPath", () => {
  it.each([
    ["/?screen=governance-sops", "/?screen=governance-sops"],
    ["https://mc.plxcustomer.io/?screen=goals", "/?screen=goals"],
    ["/tasks/TASK-1?x=1#frag", "/tasks/TASK-1?x=1"],
    // Another origin keeps only its path: the browser never leaves this site.
    ["https://evil.example/x", "/x"],
    ["//evil.example/path", "/path"],
    ["/\\evil.example", "/"],
  ])("returns %j as the same-site path %j", (input, expected) => expect(signInReturnPath(input)).toBe(expected));

  it.each([
    [undefined],
    [""],
    [["/?screen=a", "/?screen=b"]],
    ["javascript:alert(1)"],
    ["https://mc.plxcustomer.io//evil.example/"],
    ["/api/governance-sops"],
    ["https://mc.plxcustomer.io/api/state"],
    ["/signin"],
  ])("returns home for %j", (input) => expect(signInReturnPath(input)).toBe("/"));
});
