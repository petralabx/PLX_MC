// The shared route wrapper's envelope contract (governance: one standard
// response envelope, zod on mutating routes).

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiError, parseBody, route } from "@/lib/api/route";

const ctx = { params: Promise.resolve({}) };
const req = (body?: unknown) =>
  new Request("http://test/api/x", {
    method: "POST",
    body: body === undefined ? "not json {" : JSON.stringify(body),
  });

describe("route wrapper envelope", () => {
  it("wraps success in { data }", async () => {
    const resp = await route(async () => ({ ok: 1 }))(req({}), ctx);
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ data: { ok: 1 } });
  });

  it("wraps ApiError in { error: { code, message } } with its status", async () => {
    const resp = await route(async () => {
      throw new ApiError("not_found", "nope", 404);
    })(req({}), ctx);
    expect(resp.status).toBe(404);
    expect(await resp.json()).toEqual({ error: { code: "not_found", message: "nope" } });
  });

  it("maps unexpected errors to a 500 envelope without leaking details", async () => {
    const resp = await route(async () => {
      throw new Error("secret internals");
    })(req({}), ctx);
    expect(resp.status).toBe(500);
    const body = await resp.json();
    expect(body.error.code).toBe("internal");
    expect(body.error.message).not.toContain("secret internals");
  });
});

describe("parseBody validation", () => {
  const schema = z.object({ winner: z.enum(["mc", "sp"]) });

  it("returns parsed data on valid bodies", async () => {
    await expect(parseBody(req({ winner: "mc" }), schema)).resolves.toEqual({ winner: "mc" });
  });

  it("rejects invalid JSON and schema violations as ApiError", async () => {
    await expect(parseBody(req(), schema)).rejects.toMatchObject({ code: "invalid_json" });
    await expect(parseBody(req({ winner: "lww" }), schema)).rejects.toMatchObject({ code: "invalid_request" });
  });
});
