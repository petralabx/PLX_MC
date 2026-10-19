// TASK-3166: the Graph helpers behind mc_upload_evidence. They find a site by
// path and a library's drive by name (never creating one), and upload a small
// file to an encoded drive path. fetch is stubbed; no network.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { driveIdByName, siteIdByPath, uploadSmallDriveFile } from "@/lib/sync/graph";

const calls: { url: string; method: string; headers: Record<string, string>; body: unknown }[] = [];

beforeEach(() => {
  calls.length = 0;
  vi.stubEnv("MICROSOFT_GRAPH_TENANT_ID", "tenant");
  vi.stubEnv("MICROSOFT_GRAPH_CLIENT_ID", "client");
  vi.stubEnv("MICROSOFT_GRAPH_CLIENT_SECRET", "secret");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url.includes("/oauth2/v2.0/token")) return Response.json({ access_token: "tok", expires_in: 3600 });
      calls.push({ url, method: init.method ?? "GET", headers: init.headers as Record<string, string>, body: init.body });
      if (url.includes("/drives?")) return Response.json({ value: [{ id: "d-docs", name: "Documents" }, { id: "d-mc", name: "Mission Control" }] });
      if (url.includes(":/content")) return Response.json({ id: "item-1", webUrl: "https://sp/item-1", size: 3 });
      return Response.json({ id: "site-1" });
    })
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("evidence store Graph helpers", () => {
  it("finds a site by its path on the tenant host", async () => {
    expect(await siteIdByPath("/sites/PLXSite")).toBe("site-1");
    expect(calls[0].url).toBe("https://graph.microsoft.com/v1.0/sites/petrasoap.sharepoint.com:/sites/PLXSite?$select=id");
  });

  it("finds a library's drive by its exact name, and returns null rather than creating one", async () => {
    expect(await driveIdByName("site-1", "Mission Control")).toBe("d-mc");
    expect(await driveIdByName("site-1", "Evidence")).toBeNull();
    expect(calls.every((call) => call.method === "GET")).toBe(true);
  });

  it("PUTs the bytes to an encoded path with the file's content type", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const item = await uploadSmallDriveFile("d-mc", "PLX Mission Control/No project/BKT-1/TASK-1/a b#.png", bytes, "image/png");
    expect(item).toEqual({ id: "item-1", webUrl: "https://sp/item-1", size: 3 });
    expect(calls[0]).toMatchObject({
      url: "https://graph.microsoft.com/v1.0/drives/d-mc/root:/PLX%20Mission%20Control/No%20project/BKT-1/TASK-1/a%20b%23.png:/content",
      method: "PUT",
      body: bytes,
    });
    expect(calls[0].headers["content-type"]).toBe("image/png");
  });
});
