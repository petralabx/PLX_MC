// TASK-3166: the Graph helpers behind mc_upload_evidence. They find a site by
// path and a library's drive by name (never creating one), and upload a small
// file to an encoded drive path. fetch is stubbed; no network.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GraphError,
  createDriveUploadSession,
  deleteDriveItem,
  driveIdByName,
  driveItemByPath,
  driveItemContent,
  siteIdByPath,
  uploadSmallDriveFile,
} from "@/lib/sync/graph";

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
      if (url.includes(":/createUploadSession")) return Response.json({ uploadUrl: "https://sp/session", expirationDateTime: "2026-10-18T00:00:00Z" });
      if (url.includes("missing.mp4")) return new Response("itemNotFound", { status: 404 });
      if (url.includes("denied.mp4")) return new Response("accessDenied", { status: 403 });
      if (url.endsWith("/items/v-1/content")) return new Response(new Uint8Array([7, 8, 9]));
      if (init.method === "DELETE") return new Response(null, { status: 204 });
      if (url.includes("?$select=id,webUrl,size")) return Response.json({ id: "v-1", webUrl: "https://sp/v-1", size: 3 });
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

  // TASK-3167: large videos go up through an upload session, then MC re-reads them.
  it("opens an upload session that refuses to replace a file", async () => {
    const session = await createDriveUploadSession("d-mc", "PLX Mission Control/No project/BKT-1/TASK-1/a b.mp4");
    expect(session.uploadUrl).toBe("https://sp/session");
    expect(calls[0]).toMatchObject({
      url: "https://graph.microsoft.com/v1.0/drives/d-mc/root:/PLX%20Mission%20Control/No%20project/BKT-1/TASK-1/a%20b.mp4:/createUploadSession",
      method: "POST",
    });
    expect(JSON.parse(calls[0].body as string)).toEqual({ item: { "@microsoft.graph.conflictBehavior": "fail" } });
  });

  it("finds a stored item by path, returns null for a missing one, and keeps other errors", async () => {
    expect(await driveItemByPath("d-mc", "F/v.mp4")).toEqual({ id: "v-1", webUrl: "https://sp/v-1", size: 3 });
    expect(calls[0].url).toBe("https://graph.microsoft.com/v1.0/drives/d-mc/root:/F/v.mp4?$select=id,webUrl,size");
    expect(await driveItemByPath("d-mc", "F/missing.mp4")).toBeNull();
    await expect(driveItemByPath("d-mc", "F/denied.mp4")).rejects.toBeInstanceOf(GraphError);
  });

  it("streams an item's bytes with the token, and deletes an item", async () => {
    const stream = await driveItemContent("d-mc", "v-1");
    expect(new Uint8Array(await new Response(stream).arrayBuffer())).toEqual(new Uint8Array([7, 8, 9]));
    expect(calls[0].url).toBe("https://graph.microsoft.com/v1.0/drives/d-mc/items/v-1/content");
    expect(calls[0].headers.Authorization).toBe("Bearer tok");
    await deleteDriveItem("d-mc", "v-1");
    expect(calls[1]).toMatchObject({ url: "https://graph.microsoft.com/v1.0/drives/d-mc/items/v-1", method: "DELETE" });
  });
});
