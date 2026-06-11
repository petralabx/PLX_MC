// The staging gate's invariants. Basic mode: dormant without the secret,
// 401 without (or with wrong) credentials, pass-through with the right ones.
// OIDC mode: the allowlist is fail-closed and Petra-domain-only.

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { basicGate, isAllowedUser } from "@/lib/auth/gate";
import middleware from "@/middleware";

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
