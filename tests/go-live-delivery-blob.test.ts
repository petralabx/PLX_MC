import { describe, expect, it, vi } from "vitest";

import {
  GO_LIVE_STORAGE_ACCOUNT,
  deliveryBlobName,
  parseAzureConnectionString,
  putGoLiveDeliveryBlobIfNotExists,
  sharedKeyAuthorization,
} from "@/lib/compliance/go-live-delivery-blob";

const FAKE_KEY = Buffer.from("go-live-test-account-key").toString("base64");
const CONNECTION = `DefaultEndpointsProtocol=https;AccountName=${GO_LIVE_STORAGE_ACCOUNT};AccountKey=${FAKE_KEY};EndpointSuffix=core.windows.net`;

describe("go-live delivery blob", () => {
  it("parses a connection string and rejects a foreign account", () => {
    expect(parseAzureConnectionString(CONNECTION)?.accountName).toBe(GO_LIVE_STORAGE_ACCOUNT);
    expect(
      parseAzureConnectionString(
        "DefaultEndpointsProtocol=https;AccountName=someoneelse;AccountKey=abc;EndpointSuffix=core.windows.net"
      )?.accountName
    ).toBe("someoneelse");
  });

  it("builds a safe blob name from the announce event id", () => {
    expect(deliveryBlobName("task.completed:TASK-1697")).toBe("announce/task.completed:TASK-1697.json");
    expect(deliveryBlobName("../secret")).toBeNull();
  });

  it("signs Shared Key without embedding the raw key in the header", () => {
    const auth = sharedKeyAuthorization({
      accountName: GO_LIVE_STORAGE_ACCOUNT,
      accountKey: FAKE_KEY,
      method: "PUT",
      contentLength: 2,
      contentType: "application/json",
      ifNoneMatch: "*",
      canonicalizedHeaders: {
        "x-ms-blob-type": "BlockBlob",
        "x-ms-date": "Tue, 15 Sep 2026 00:00:00 GMT",
        "x-ms-version": "2020-10-02",
      },
      canonicalizedResource: `/${GO_LIVE_STORAGE_ACCOUNT}/mc-go-live-delivery/announce/task.completed:TASK-1697.json`,
    });
    expect(auth.startsWith(`SharedKey ${GO_LIVE_STORAGE_ACCOUNT}:`)).toBe(true);
    expect(auth.includes(FAKE_KEY)).toBe(false);
  });

  it("skips when storage is not configured", async () => {
    const fetchImpl = vi.fn();
    const result = await putGoLiveDeliveryBlobIfNotExists(
      { eventId: "task.completed:TASK-1697", taskId: "TASK-1697", kind: "task.completed" },
      { loadStorage: () => null, fetchImpl }
    );
    expect(result).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns created on 201 and exists on 409", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ status: 201 })
      .mockResolvedValueOnce({ status: 409 });
    const storage = {
      accountName: GO_LIVE_STORAGE_ACCOUNT,
      container: "mc-go-live-delivery",
      connectionString: CONNECTION,
    };
    const first = await putGoLiveDeliveryBlobIfNotExists(
      { eventId: "task.completed:TASK-1697", taskId: "TASK-1697", kind: "task.completed" },
      { loadStorage: () => storage, fetchImpl, nowIso: () => "2026-09-15T00:00:00.000Z" }
    );
    const second = await putGoLiveDeliveryBlobIfNotExists(
      { eventId: "task.completed:TASK-1697", taskId: "TASK-1697", kind: "task.completed" },
      { loadStorage: () => storage, fetchImpl, nowIso: () => "2026-09-15T00:00:00.000Z" }
    );
    expect(first).toBe("created");
    expect(second).toBe("exists");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)["If-None-Match"]).toBe("*");
  });

  it("rejects a non-allowlisted storage account without posting", async () => {
    const fetchImpl = vi.fn();
    const result = await putGoLiveDeliveryBlobIfNotExists(
      { eventId: "task.completed:TASK-1697", taskId: "TASK-1697", kind: "task.completed" },
      {
        loadStorage: () => ({
          accountName: "nottheaccount",
          container: "mc-go-live-delivery",
          connectionString:
            "DefaultEndpointsProtocol=https;AccountName=nottheaccount;AccountKey=abc;EndpointSuffix=core.windows.net",
        }),
        fetchImpl,
      }
    );
    expect(result).toBe("error");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
