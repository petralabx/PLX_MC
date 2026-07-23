// P11 — Graph webhook: validationToken plaintext pass-through, clientState
// verification, enqueue-then-respond (no inline sweep).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const m = vi.hoisted(() => ({
  enabled: true,
  configured: true,
  clientState: "test-client-state",
  inlineDrain: false,
  enqueue: vi.fn(),
  drain: vi.fn(async () => ({ claimed: 0, processed: 0, failed: 0 })),
}));

vi.mock("@/lib/secrets", () => ({
  graphWebhookEnabled: () => m.enabled,
  graphWebhookConfigured: () => m.configured,
  graphWebhookClientState: () => m.clientState,
  graphInlineDrainEnabled: () => m.inlineDrain,
}));

vi.mock("@/lib/sync/notification-queue", () => ({
  enqueueNotifications: m.enqueue,
  processNotificationQueue: () => m.drain(),
}));

import { GET, POST } from "@/app/api/sync/webhook/route";

const ctx = { params: Promise.resolve({}) };

beforeEach(() => {
  m.enabled = true;
  m.configured = true;
  m.clientState = "test-client-state";
  m.inlineDrain = false;
  m.drain.mockClear();
  m.enqueue.mockReset().mockResolvedValue({
    accepted: 1,
    duplicates: 0,
    rejected: 0,
    results: [],
  });
});

afterEach(() => vi.restoreAllMocks());

describe("middleware carve-out for sync webhook", () => {
  it("exempts api/sync/webhook exactly and keeps P6 propose carve-out", () => {
    const source = readFileSync(resolve(process.cwd(), "src/middleware.ts"), "utf8");
    expect(source).toMatch(/api\/sync\/webhook/);
    expect(source).toMatch(/do not broaden to `\/api\/sync\/\*`/);
    expect(source).toMatch(/api\/routing\/propose/);
    expect(source).toMatch(
      /api\/compliance\/webhook\|api\/compliance\/verify\|api\/routing\/propose\|api\/cursor/
    );
  });
});

describe("Graph validationToken plaintext", () => {
  it("GET returns the validation token as text/plain without JSON envelope", async () => {
    const token = "Validation:Token-abc";
    const resp = await GET(
      new Request(`http://test/api/sync/webhook?validationToken=${encodeURIComponent(token)}`),
      ctx
    );
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toMatch(/text\/plain/);
    expect(await resp.text()).toBe(token);
    expect(m.enqueue).not.toHaveBeenCalled();
  });

  it("POST with validationToken also returns plaintext", async () => {
    const token = "Validation:Post-xyz";
    const resp = await POST(
      new Request(`http://test/api/sync/webhook?validationToken=${encodeURIComponent(token)}`, {
        method: "POST",
        body: "{}",
      }),
      ctx
    );
    expect(await resp.text()).toBe(token);
    expect(m.enqueue).not.toHaveBeenCalled();
  });
});

describe("Graph notification delivery", () => {
  it("is default-off when kill switch / config missing", async () => {
    m.enabled = false;
    const resp = await POST(
      new Request("http://test/api/sync/webhook", {
        method: "POST",
        body: JSON.stringify({ value: [] }),
      }),
      ctx
    );
    expect(resp.status).toBe(503);
    expect((await resp.json()).error.code).toBe("webhook_disabled");
    expect(m.enqueue).not.toHaveBeenCalled();
  });

  it("enqueues notifications and returns immediately without sweeping", async () => {
    const body = {
      value: [
        {
          subscriptionId: "sub-1",
          clientState: "test-client-state",
          changeType: "updated",
          resource: "sites/s/lists/l",
          resourceData: { id: "42", "@odata.etag": "W/\"1\"" },
        },
      ],
    };
    const resp = await POST(
      new Request("http://test/api/sync/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      ctx
    );
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({
      data: { accepted: 1, duplicates: 0, rejected: 0 },
    });
    expect(m.enqueue).toHaveBeenCalledTimes(1);
    expect(m.enqueue).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          subscriptionId: "sub-1",
          resource: "sites/s/lists/l",
          clientState: "test-client-state",
        }),
      ],
      { expectedClientState: "test-client-state" }
    );
  });
});

describe("inline drain after ack (TASK-627)", () => {
  const notifyBody = {
    value: [
      {
        subscriptionId: "sub-1",
        clientState: "test-client-state",
        changeType: "updated",
        resource: "sites/s/lists/l",
        resourceData: { id: "42" },
      },
    ],
  };

  function notifyReq(): Request {
    return new Request("http://test/api/sync/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(notifyBody),
    });
  }

  it("drains the queue after acking when enabled", async () => {
    m.inlineDrain = true;
    const resp = await POST(notifyReq(), ctx);
    expect(resp.status).toBe(200);
    await new Promise((r) => setImmediate(r));
    expect(m.drain).toHaveBeenCalledTimes(1);
  });

  it("kill switch off: ack only, cron drain remains the path", async () => {
    m.inlineDrain = false;
    const resp = await POST(notifyReq(), ctx);
    expect(resp.status).toBe(200);
    await new Promise((r) => setImmediate(r));
    expect(m.drain).not.toHaveBeenCalled();
  });

  it("nothing accepted: no inline drain", async () => {
    m.inlineDrain = true;
    m.enqueue.mockResolvedValue({ accepted: 0, duplicates: 1, rejected: 0, results: [] });
    await POST(notifyReq(), ctx);
    await new Promise((r) => setImmediate(r));
    expect(m.drain).not.toHaveBeenCalled();
  });
});
