// Shared route wrapper — Response pass-through seam (P11) + envelope contract.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiError, parseBody, route } from "@/lib/api/route";
import { patchTaskSchema } from "@/app/api/tasks/[id]/route";

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

describe("route wrapper Response pass-through (P11)", () => {
  it("returns a Response instance as-is without the JSON envelope", async () => {
    const token = "Validation:Token-123";
    const resp = await route(async () => {
      return new Response(token, {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    })(req({}), ctx);
    expect(resp).toBeInstanceOf(Response);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toMatch(/text\/plain/);
    const body = await resp.text();
    expect(body).toBe(token);
    // Must NOT be JSON-enveloped
    expect(() => JSON.parse(body)).toThrow();
  });

  it("still envelopes plain objects when handler does not return Response", async () => {
    const resp = await route(async () => ({ accepted: 1 }))(req({}), ctx);
    expect(await resp.json()).toEqual({ data: { accepted: 1 } });
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

describe("patchTaskSchema (PATCH /api/tasks/{id} validation contract)", () => {
  it("accepts the new optional DB-only fields", () => {
    const parsed = patchTaskSchema.safeParse({
      actor: "vince",
      bucket: "BKT-DAPI",
      labels: ["go-live", "api"],
      coassignees: ["ricardo", "stephen"],
      subtasks: [{ id: "SUB-1", t: "spike", done: false, who: "vince" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a subtask missing the `done` flag (strict subtaskSchema — Risk R5)", () => {
    const parsed = patchTaskSchema.safeParse({
      actor: "vince",
      subtasks: [{ id: "SUB-1", t: "spike", who: "vince" }],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects non-array labels", () => {
    const parsed = patchTaskSchema.safeParse({ actor: "vince", labels: "go-live" });
    expect(parsed.success).toBe(false);
  });

  it("rejects labels over the soft cap (max 25 — Risk R6)", () => {
    const parsed = patchTaskSchema.safeParse({
      actor: "vince",
      labels: Array.from({ length: 26 }, (_, i) => `l${i}`),
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts target repos and targetEnv, and rejects unknown environments", () => {
    expect(
      patchTaskSchema.safeParse({ actor: "vince", repos: ["portal-web"], targetEnv: "staging" }).success
    ).toBe(true);
    expect(patchTaskSchema.safeParse({ actor: "vince", targetEnv: "production" }).success).toBe(true);
    expect(patchTaskSchema.safeParse({ actor: "vince", targetEnv: "prod" }).success).toBe(false);
  });

  it("requires a non-empty actor", () => {
    expect(patchTaskSchema.safeParse({ actor: "", labels: ["x"] }).success).toBe(false);
  });

  it("accepts the WS-3 enriched sub-task fields (description/assignee/due/status)", () => {
    const parsed = patchTaskSchema.safeParse({
      actor: "vince",
      subtasks: [
        { id: "SUB-1", t: "spike", done: false, who: "vince", description: "look", assignee: "ricardo", due: "Jun 22", status: "doing" },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown sub-task status", () => {
    const parsed = patchTaskSchema.safeParse({
      actor: "vince",
      subtasks: [{ id: "SUB-1", t: "spike", done: false, who: "vince", status: "wip" }],
    });
    expect(parsed.success).toBe(false);
  });

  it("refuses a client-supplied comments array — comments go through /comments one op at a time (TASK-3043)", () => {
    const parsed = patchTaskSchema.safeParse({
      actor: "vince",
      comments: [
        { id: "CMT-1", author: "vince", body: "hi @greg", ts: "2026.06.17 · 21:40", mentions: ["greg"] },
      ],
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0].path).toEqual(["comments"]);
    expect(parsed.error!.issues[0].message).toContain("/comments");
  });

  it("refuses even an empty comments array (it would wipe the thread)", () => {
    const parsed = patchTaskSchema.safeParse({ actor: "vince", comments: [] });
    expect(parsed.success).toBe(false);
  });
});
