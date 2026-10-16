// TASK-3012: Sign out ends the Microsoft session too, so the next sign-in on a
// shared machine asks which account to use instead of silently reusing the
// last one. signOutAction clears the Mission Control cookie, then sends the
// browser to Entra's end-session endpoint, which returns it to /signin. Sign-in
// always asks Microsoft for the account picker (prompt=select_account).

import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  factory: undefined as undefined | (() => { providers: unknown[] }),
  signIn: vi.fn(),
  signOut: vi.fn(),
  redirect: vi.fn(),
  entraProvider: vi.fn((options: unknown) => ({ id: "microsoft-entra-id", options })),
  entraAuthConfigured: vi.fn(),
  headers: new Headers(),
}));

vi.mock("next-auth", () => ({
  default: (factory: () => { providers: unknown[] }) => {
    m.factory = factory;
    return { handlers: {}, auth: vi.fn(), signIn: m.signIn, signOut: m.signOut };
  },
}));
vi.mock("next-auth/providers/microsoft-entra-id", () => ({ default: m.entraProvider }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("next/headers", () => ({ headers: async () => m.headers }));
vi.mock("@/lib/secrets", () => ({
  entraAuthConfigured: m.entraAuthConfigured,
  entraAuthCredentials: () => ({
    tenantId: "tenant-1",
    clientId: "client-1",
    clientSecret: "client-secret",
    authSecret: "auth-secret",
  }),
}));

import { signOutAction } from "@/lib/auth/actions";

beforeEach(() => {
  m.signOut.mockReset();
  m.redirect.mockReset();
  m.entraProvider.mockClear();
  m.entraAuthConfigured.mockReset().mockReturnValue(true);
  m.headers = new Headers({ host: "mc.example.test", "x-forwarded-proto": "https" });
});

describe("signOutAction", () => {
  it("clears the local session, then ends the Entra session and returns to /signin", async () => {
    await signOutAction();
    expect(m.signOut).toHaveBeenCalledWith({ redirect: false });
    expect(m.redirect).toHaveBeenCalledTimes(1);
    const url = new URL(m.redirect.mock.calls[0][0]);
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://login.microsoftonline.com/tenant-1/oauth2/v2.0/logout"
    );
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe("https://mc.example.test/signin");
  });

  it("uses the forwarded host the browser actually reached", async () => {
    m.headers = new Headers({
      host: "internal:3000",
      "x-forwarded-host": "preview.example.test",
      "x-forwarded-proto": "https",
    });
    await signOutAction();
    const url = new URL(m.redirect.mock.calls[0][0]);
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe("https://preview.example.test/signin");
  });

  it("goes straight to /signin when Entra sign-in is not configured", async () => {
    m.entraAuthConfigured.mockReturnValue(false);
    await signOutAction();
    expect(m.signOut).toHaveBeenCalledWith({ redirect: false });
    expect(m.redirect).toHaveBeenCalledWith("/signin");
  });
});

describe("Microsoft Entra sign-in", () => {
  it("asks Microsoft which account to use", () => {
    m.factory?.();
    expect(m.entraProvider).toHaveBeenCalledWith(
      expect.objectContaining({ authorization: { params: { prompt: "select_account" } } })
    );
  });
});
