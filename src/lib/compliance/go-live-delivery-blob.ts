// Optional Azure Blob overlay for go-live announce delivery state (TASK-1454 /
// TASK-1699). Account is hard-allowlisted to `stvmcresearch`. Missing config
// skips the overlay; Postgres claim remains the always-on gate. Never logs
// connection strings, keys, or blob URLs that would include a SAS.

import { createHmac } from "node:crypto";

import {
  GO_LIVE_STORAGE_ACCOUNT,
  goLiveDeliveryStorage,
  type GoLiveDeliveryStorage,
} from "@/lib/secrets";

export { GO_LIVE_DELIVERY_CONTAINER_DEFAULT, GO_LIVE_STORAGE_ACCOUNT } from "@/lib/secrets";

export type GoLiveBlobClaim = "skipped" | "created" | "exists" | "error";

export interface GoLiveBlobRecord {
  eventId: string;
  taskId: string;
  kind: string;
  receiptId?: string;
  claimedAt: string;
}

export interface GoLiveBlobDeps {
  loadStorage?: () => GoLiveDeliveryStorage | null;
  fetchImpl?: typeof fetch;
  nowIso?: () => string;
}

export function parseAzureConnectionString(
  raw: string
): { accountName: string; accountKey: string; endpointSuffix: string } | null {
  const parts: Record<string, string> = {};
  for (const segment of raw.split(";")) {
    const idx = segment.indexOf("=");
    if (idx <= 0) continue;
    parts[segment.slice(0, idx)] = segment.slice(idx + 1);
  }
  const accountName = (parts.AccountName ?? "").trim();
  const accountKey = (parts.AccountKey ?? "").trim();
  const endpointSuffix = (parts.EndpointSuffix ?? "core.windows.net").trim();
  if (!accountName || !accountKey) return null;
  return { accountName, accountKey, endpointSuffix };
}

export function deliveryBlobName(eventId: string): string | null {
  const trimmed = eventId.trim();
  if (!/^[a-z0-9.:_-]{3,120}$/i.test(trimmed)) return null;
  return `announce/${trimmed}.json`;
}

function canonicalizedHeaders(headers: Record<string, string>): string {
  return Object.keys(headers)
    .filter((name) => name.toLowerCase().startsWith("x-ms-"))
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map((name) => `${name.toLowerCase()}:${headers[name].trimEnd()}\n`)
    .join("");
}

export function sharedKeyAuthorization(input: {
  accountName: string;
  accountKey: string;
  method: string;
  contentLength: number;
  contentType: string;
  ifNoneMatch: string;
  canonicalizedHeaders: Record<string, string>;
  canonicalizedResource: string;
}): string {
  const contentLength = input.contentLength === 0 ? "" : String(input.contentLength);
  const stringToSign = [
    input.method,
    "",
    "",
    contentLength,
    "",
    input.contentType,
    "",
    "",
    "",
    input.ifNoneMatch,
    "",
    "",
    canonicalizedHeaders(input.canonicalizedHeaders) + input.canonicalizedResource,
  ].join("\n");
  const signature = createHmac("sha256", Buffer.from(input.accountKey, "base64"))
    .update(stringToSign, "utf8")
    .digest("base64");
  return `SharedKey ${input.accountName}:${signature}`;
}

export async function putGoLiveDeliveryBlobIfNotExists(
  record: Omit<GoLiveBlobRecord, "claimedAt"> & { claimedAt?: string },
  deps: GoLiveBlobDeps = {}
): Promise<GoLiveBlobClaim> {
  const storage = (deps.loadStorage ?? goLiveDeliveryStorage)();
  if (!storage) return "skipped";
  const blobName = deliveryBlobName(record.eventId);
  if (!blobName) return "error";

  const parsed = parseAzureConnectionString(storage.connectionString);
  if (!parsed || parsed.accountName !== GO_LIVE_STORAGE_ACCOUNT) return "error";
  if (storage.accountName !== GO_LIVE_STORAGE_ACCOUNT) return "error";

  const body = JSON.stringify({
    eventId: record.eventId,
    taskId: record.taskId,
    kind: record.kind,
    receiptId: record.receiptId,
    claimedAt: record.claimedAt ?? (deps.nowIso ?? (() => new Date().toISOString()))(),
  } satisfies GoLiveBlobRecord);
  const date = new Date().toUTCString();
  const contentType = "application/json";
  const msHeaders = {
    "x-ms-blob-type": "BlockBlob",
    "x-ms-date": date,
    "x-ms-version": "2020-10-02",
  };
  const resource = `/${parsed.accountName}/${storage.container}/${blobName}`;
  const authorization = sharedKeyAuthorization({
    accountName: parsed.accountName,
    accountKey: parsed.accountKey,
    method: "PUT",
    contentLength: Buffer.byteLength(body),
    contentType,
    ifNoneMatch: "*",
    canonicalizedHeaders: msHeaders,
    canonicalizedResource: resource,
  });
  const url = `https://${parsed.accountName}.blob.${parsed.endpointSuffix}/${storage.container}/${blobName}`;
  try {
    const fetchImpl = deps.fetchImpl ?? fetch;
    const resp = await fetchImpl(url, {
      method: "PUT",
      signal: AbortSignal.timeout(8_000),
      headers: {
        Authorization: authorization,
        "Content-Type": contentType,
        "Content-Length": String(Buffer.byteLength(body)),
        "If-None-Match": "*",
        ...msHeaders,
      },
      body,
    });
    if (resp.status === 201 || resp.status === 200) return "created";
    if (resp.status === 409 || resp.status === 412) return "exists";
    console.error("[go-live-announcer] delivery blob put status=%s", resp.status);
    return "error";
  } catch (err) {
    console.error(
      "[go-live-announcer] delivery blob put failed: %s",
      err instanceof Error ? err.message : "error"
    );
    return "error";
  }
}
