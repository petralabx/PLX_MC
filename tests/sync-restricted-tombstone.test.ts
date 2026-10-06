// TASK-1534 — Graph tombstone for restrict-after-push mirror rows: surgical
// deleteListItem, default-OFF gate, strict project scoping, 404/5xx handling,
// and no SQL DELETE / local row removal.

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sql: [] as string[],
  projects: [] as { project: Record<string, unknown>; spItemId: string | null }[],
  buckets: [] as { bucket: Record<string, unknown>; spItemId: string | null }[],
  tasks: [] as { id: string; sp_item_id: string | null; data: Record<string, unknown> }[],
  clears: [] as string[],
  audits: [] as string[],
  deferred: new Set<string>(),
  recorded: [] as string[],
  terminal: false,
}));

vi.mock("@/lib/db", () => ({
  query: async (text: string) => {
    h.sql.push(text);
    return [];
  },
}));
vi.mock("@/lib/secrets", async (orig) => ({
  ...(await orig<typeof import("@/lib/secrets")>()),
  graphCredentials: () => ({ tenantId: "t", clientId: "c", clientSecret: "s" }),
}));
vi.mock("@/lib/sync/push-queue", async (orig) => ({
  ...(await orig<typeof import("@/lib/sync/push-queue")>()),
  getDeferredPushSet: async () => h.deferred,
  clearPushRetry: async () => undefined,
  recordTransientPushFailure: async (kind: string, id: string) => {
    h.recorded.push(`${kind}:${id}`);
    return { attempts: 1, terminal: h.terminal, nextAttemptAt: "x" };
  },
}));
vi.mock("@/lib/sync/repo", () => ({
  getProjectRows: async () => h.projects,
  getBucketRows: async () => h.buckets,
  getEntities: async () => h.tasks,
  updateEntity: async (_t: string, id: string, o: { clearSpItemId?: boolean }) => {
    if (o.clearSpItemId) h.clears.push(`task:${id}`);
  },
  updateBucket: async (id: string, o: { spItemId?: string | null }) => {
    if (o.spItemId === null) h.clears.push(`bucket:${id}`);
  },
  updateProject: async (id: string, o: { spItemId?: string | null }) => {
    if (o.spItemId === null) h.clears.push(`project:${id}`);
  },
  appendAudit: async (_a: string, body: string) => {
    h.audits.push(body);
  },
}));

import { clearSiteContextCache, deleteListItem, GraphError, type SiteContext } from "@/lib/sync/graph";
import { tombstoneRestrictedMirrors } from "@/lib/sync/restricted-tombstone";

const ctx: SiteContext = {
  siteId: "site1",
  listIds: { projects: "LP", roadmap: "LR", todos: "LT" },
};

let fetchMock: ReturnType<typeof vi.fn>;
let respond: (url: string) => Response;
const deletes = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit)?.method === "DELETE");
const graphCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes("graph.microsoft.com"));

beforeEach(() => {
  h.sql.length = 0;
  h.clears.length = 0;
  h.audits.length = 0;
  h.deferred = new Set();
  h.recorded.length = 0;
  h.terminal = false;
  clearSiteContextCache();
  respond = (url) =>
    url.includes("login.microsoftonline.com")
      ? new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 })
      : new Response(null, { status: 204 });
  fetchMock = vi.fn(async (url: string) => respond(String(url)));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  // P-R restricted + pushed project with a pushed bucket and task; P-S shared; P-N restricted never pushed.
  h.projects = [
    { project: { id: "P-R", visibility: "restricted" }, spItemId: "11" },
    { project: { id: "P-S", visibility: "shared" }, spItemId: "12" },
    { project: { id: "P-N", visibility: "restricted" }, spItemId: null },
  ];
  h.buckets = [
    { bucket: { id: "B-R", project: "P-R" }, spItemId: "21" },
    { bucket: { id: "B-S", project: "P-S" }, spItemId: "22" },
    { bucket: { id: "B-N", project: "P-N" }, spItemId: null },
  ];
  h.tasks = [
    { id: "T-R", sp_item_id: "31", data: { bucket: "B-R" } },
    { id: "T-S", sp_item_id: "32", data: { bucket: "B-S" } },
    { id: "T-N", sp_item_id: null, data: { bucket: "B-R" } },
  ];
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("deleteListItem", () => {
  it("sends exactly one DELETE to the item URL for the given id", async () => {
    await expect(deleteListItem(ctx, "todos", "31")).resolves.toBe("deleted");
    expect(deletes()).toHaveLength(1);
    expect(deletes()[0][0]).toBe("https://graph.microsoft.com/v1.0/sites/site1/lists/LT/items/31");
    expect(graphCalls()).toHaveLength(1);
  });

  it.each(["", "  ", "1 or 1=1", "../items", "31?$filter=x", "1/2"])("refuses id %j without any request", async (id) => {
    await expect(deleteListItem(ctx, "todos", id)).rejects.toThrow(/refused/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an unresolved list", async () => {
    await expect(deleteListItem(ctx, "nope", "5")).rejects.toThrow(/refused/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a Graph 404 as already deleted", async () => {
    respond = (url) =>
      url.includes("login.") ? new Response(JSON.stringify({ access_token: "t", expires_in: 3600 })) : new Response("gone", { status: 404 });
    await expect(deleteListItem(ctx, "todos", "31")).resolves.toBe("already_gone");
  });

  it("propagates 5xx as a GraphError", async () => {
    respond = (url) =>
      url.includes("login.") ? new Response(JSON.stringify({ access_token: "t", expires_in: 3600 })) : new Response("x", { status: 503 });
    await expect(deleteListItem(ctx, "todos", "31")).rejects.toBeInstanceOf(GraphError);
  });
});

describe("tombstoneRestrictedMirrors", () => {
  it("gate OFF (default): no DELETE, no state change, reports what it would delete", async () => {
    const r = await tombstoneRestrictedMirrors(ctx, "scribe");
    expect(r).toEqual({ deleted: 0, deferred: 0, wouldDelete: 3 });
    expect(deletes()).toHaveLength(0);
    expect(h.clears).toEqual([]);
    expect(console.log).toHaveBeenCalledTimes(3);
  });

  it("gate ON: deletes only the restricted project's pushed items, children first", async () => {
    vi.stubEnv("PLX_MC_SP_RESTRICTED_TOMBSTONE", "1");
    const r = await tombstoneRestrictedMirrors(ctx, "scribe");
    expect(r.deleted).toBe(3);
    expect(deletes().map(([u]) => u)).toEqual([
      "https://graph.microsoft.com/v1.0/sites/site1/lists/LT/items/31",
      "https://graph.microsoft.com/v1.0/sites/site1/lists/LR/items/21",
      "https://graph.microsoft.com/v1.0/sites/site1/lists/LP/items/11",
    ]);
    expect(h.clears).toEqual(["task:T-R", "bucket:B-R", "project:P-R"]);
  });

  it("gate ON: a 404 counts as already deleted and the link is cleared", async () => {
    vi.stubEnv("PLX_MC_SP_RESTRICTED_TOMBSTONE", "1");
    respond = (url) =>
      url.includes("login.") ? new Response(JSON.stringify({ access_token: "t", expires_in: 3600 })) : new Response("gone", { status: 404 });
    const r = await tombstoneRestrictedMirrors(ctx, "scribe");
    expect(r.deleted).toBe(3);
    expect(h.clears).toHaveLength(3);
  });

  it("gate ON: a 503 defers via the push retry ledger and keeps the link", async () => {
    vi.stubEnv("PLX_MC_SP_RESTRICTED_TOMBSTONE", "1");
    respond = (url) =>
      url.includes("login.") ? new Response(JSON.stringify({ access_token: "t", expires_in: 3600 })) : new Response("x", { status: 503 });
    const r = await tombstoneRestrictedMirrors(ctx, "scribe");
    expect(r).toEqual({ deleted: 0, deferred: 3, wouldDelete: 0 });
    expect(h.recorded).toEqual(["task:T-R", "bucket:B-R", "project:P-R"]);
    expect(h.clears).toEqual([]);
  });

  it("gate ON: an entity inside its backoff window is skipped", async () => {
    vi.stubEnv("PLX_MC_SP_RESTRICTED_TOMBSTONE", "1");
    h.deferred = new Set(["task:T-R"]);
    const r = await tombstoneRestrictedMirrors(ctx, "scribe");
    expect(r).toMatchObject({ deleted: 2, deferred: 1 });
    expect(deletes()).toHaveLength(2);
  });

  it("gate ON: a non-transient 4xx audits an error and keeps the link", async () => {
    vi.stubEnv("PLX_MC_SP_RESTRICTED_TOMBSTONE", "1");
    respond = (url) =>
      url.includes("login.") ? new Response(JSON.stringify({ access_token: "t", expires_in: 3600 })) : new Response("no", { status: 403 });
    const r = await tombstoneRestrictedMirrors(ctx, "scribe");
    expect(r.deleted).toBe(0);
    expect(h.clears).toEqual([]);
    expect(h.audits).toHaveLength(3);
  });

  it("does nothing when no project is restricted", async () => {
    vi.stubEnv("PLX_MC_SP_RESTRICTED_TOMBSTONE", "1");
    h.projects = h.projects.filter((p) => p.project.visibility === "shared");
    await tombstoneRestrictedMirrors(ctx, "scribe");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never issues a SQL DELETE (local rows stay)", async () => {
    vi.stubEnv("PLX_MC_SP_RESTRICTED_TOMBSTONE", "1");
    await tombstoneRestrictedMirrors(ctx, "scribe");
    expect(h.sql.filter((s) => /\bDELETE\b/i.test(s))).toEqual([]);
  });

  it("the tombstone module contains no SQL DELETE and only clears links via repo setters", () => {
    const src = readFileSync("src/lib/sync/restricted-tombstone.ts", "utf8").replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/DELETE\s+FROM/i);
    expect(src).not.toMatch(/query\(/);
  });
});
