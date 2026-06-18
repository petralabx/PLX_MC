// The shared route wrapper's envelope contract (governance: one standard
// response envelope, zod on mutating routes).

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

  it("accepts a comments array (EN-001 / WS-3, app-only DB-only field)", () => {
    const parsed = patchTaskSchema.safeParse({
      actor: "vince",
      comments: [
        { id: "CMT-1", author: "vince", body: "hi @greg", ts: "2026.06.17 · 21:40", mentions: ["greg"] },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a comment with an empty body", () => {
    const parsed = patchTaskSchema.safeParse({
      actor: "vince",
      comments: [{ id: "CMT-1", author: "vince", body: "", ts: "t", mentions: [] }],
    });
    expect(parsed.success).toBe(false);
  });
});
