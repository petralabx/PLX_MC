// TASK-627 — expired cursors recover in the backup sweep, never silently in
// the notification path. All HTTP requests and credentials are test fixtures.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/secrets", () => ({
  graphCredentials: () => ({ tenantId: "mock", clientId: "mock", clientSecret: "mock" }),
}));

const initialUrl = "https://graph.microsoft.com/v1.0/sites/s/lists/t/items/delta?$select=id,lastModifiedDateTime,lastModifiedBy&$expand=fields";
const storedUrl = "https://graph.microsoft.com/v1.0/mock-stored-delta";
const nextUrl = "https://graph.microsoft.com/v1.0/mock-next-page";
const ctx = { siteId: "s", listIds: { todos: "t", risks: "r" } };
const http = vi.fn<typeof fetch>();
const page = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  vi.resetModules();
  http.mockReset();
  vi.stubGlobal("fetch", http);
  http.mockResolvedValueOnce(page({ access_token: "mock-token", expires_in: 3600 }));
});
afterEach(() => vi.unstubAllGlobals());

const urls = () => http.mock.calls.slice(1).map(([url]) => url);

describe("listDelta cursor recovery", () => {
  it("uses the stored list cursor, follows pages, and returns the next cursor", async () => {
    http.mockResolvedValueOnce(page({ value: [{ id: "1" }], "@odata.nextLink": nextUrl }));
    http.mockResolvedValueOnce(page({ value: [{ id: "2" }], "@odata.deltaLink": "new-cursor" }));
    const { listDelta } = await import("@/lib/sync/graph");
    expect(await listDelta(ctx, "todos", storedUrl, false)).toEqual({
      items: [{ id: "1" }, { id: "2" }], deltaLink: "new-cursor",
    });
    expect(urls()).toEqual([storedUrl, nextUrl]);
  });

  it("backup sweep discards partial pages and restarts after 410", async () => {
    http.mockResolvedValueOnce(page({ value: [{ id: "stale" }], "@odata.nextLink": nextUrl }));
    http.mockResolvedValueOnce(page({ error: "expired" }, 410));
    http.mockResolvedValueOnce(page({ value: [{ id: "fresh" }], "@odata.deltaLink": "replacement" }));
    const { listDelta } = await import("@/lib/sync/graph");
    expect(await listDelta(ctx, "todos", storedUrl)).toEqual({
      items: [{ id: "fresh" }], deltaLink: "replacement",
    });
    expect(urls()).toEqual([storedUrl, nextUrl, initialUrl]);
  });

  it("notification pull propagates 410 so its caller can run a full sweep", async () => {
    http.mockResolvedValueOnce(page({ error: "expired" }, 410));
    const { listDelta } = await import("@/lib/sync/graph");
    await expect(listDelta(ctx, "todos", storedUrl, false)).rejects.toMatchObject({ status: 410 });
    expect(urls()).toEqual([storedUrl]);
  });

  it("does not loop when the restarted walk also returns 410", async () => {
    http.mockResolvedValueOnce(page({}, 410)).mockResolvedValueOnce(page({}, 410));
    const { listDelta } = await import("@/lib/sync/graph");
    await expect(listDelta(ctx, "todos", storedUrl)).rejects.toMatchObject({ status: 410 });
    expect(urls()).toEqual([storedUrl, initialUrl]);
  });

  it("does not reset a cursor on other errors", async () => {
    http.mockResolvedValueOnce(page({}, 503));
    const { listDelta } = await import("@/lib/sync/graph");
    await expect(listDelta(ctx, "todos", storedUrl)).rejects.toMatchObject({ status: 503 });
    expect(urls()).toEqual([storedUrl]);
  });

  it("missing cursor starts at the list endpoint", async () => {
    http.mockResolvedValueOnce(page({ value: [], "@odata.deltaLink": "first-cursor" }));
    const { listDelta } = await import("@/lib/sync/graph");
    expect(await listDelta(ctx, "todos", null)).toEqual({ items: [], deltaLink: "first-cursor" });
    expect(urls()).toEqual([initialUrl]);
  });
});
