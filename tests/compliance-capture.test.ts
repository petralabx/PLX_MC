// EN-007 - the capture hook (agent-governance-automation P3 / routing P5).
// Cross-platform: runs on Windows and Unix (no platform exclusion).
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Load the .mjs hook via an absolute file URL so vitest/oxc does not need to
// transform it — keeps the contract test genuinely cross-platform.
const checkoutUrl = pathToFileURLSafe(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../scripts/compliance-checkout.mjs")
);
const { capture } = await import(checkoutUrl);

function pathToFileURLSafe(filePath: string): string {
  const normalized = path.resolve(filePath);
  let pathname = normalized.replace(/\\/g, "/");
  if (!pathname.startsWith("/")) pathname = `/${pathname}`;
  // Encode spaces but keep drive-letter colon for Windows (file:///C:/...).
  pathname = pathname.replace(/ /g, "%20");
  return `file://${pathname}`;
}

type FetchCall = { url: string; body: Record<string, unknown>; headers: Record<string, string> };

function recorder(handler: (url: string) => { ok: boolean; status?: number; json: unknown }) {
  const calls: FetchCall[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const rawHeaders = init?.headers;
    const headers: Record<string, string> =
      rawHeaders && typeof rawHeaders === "object" && !Array.isArray(rawHeaders)
        ? Object.fromEntries(
            Object.entries(rawHeaders as Record<string, string>).map(([k, v]) => [
              k.toLowerCase(),
              String(v),
            ])
          )
        : {};
    calls.push({
      url,
      body: JSON.parse(String(init?.body ?? "{}")),
      headers,
    });
    const r = handler(url);
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: async () => r.json,
    } as unknown as Response;
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const baseEnv = {
  COMPLIANCE_CAPTURE: "1",
  MC_BASE_URL: "http://mc",
  MC_ACCOUNTABLE: "vince",
  MC_REPO: "PLX_MC",
};

describe("compliance capture hook", () => {
  it("is a no-op when disabled (default-off)", async () => {
    const { fetch, calls } = recorder(() => ({ ok: true, json: {} }));
    const r = await capture({ env: {}, fetch, log: () => {} });
    expect(r.enabled).toBe(false);
    expect(calls.length).toBe(0);
  });

  it("checks out a single task and emits one stamp", async () => {
    const { fetch, calls } = recorder(() => ({
      ok: true,
      json: { data: { checkoutId: "dsp_a" } },
    }));
    const logs: string[] = [];
    const r = await capture({
      env: { ...baseEnv, MC_TASK_ID: "TASK-1" },
      fetch,
      log: (m: string) => logs.push(m),
    });
    expect(r.stamps).toEqual(["dsp_a"]);
    expect(logs).toContain("MC-Checkout: dsp_a");
    expect(calls[0].body).toMatchObject({
      taskId: "TASK-1",
      repo: "PLX_MC",
      accountableHuman: "vince",
    });
  });

  it("checks out MULTIPLE tasks and stamps each", async () => {
    let n = 0;
    const { fetch } = recorder(() => ({
      ok: true,
      json: { data: { checkoutId: `dsp_${++n}` } },
    }));
    const logs: string[] = [];
    const r = await capture({
      env: { ...baseEnv, MC_TASK_ID: "TASK-1, TASK-2 TASK-3" },
      fetch,
      log: (m: string) => logs.push(m),
    });
    expect(r.taskIds).toEqual(["TASK-1", "TASK-2", "TASK-3"]);
    expect(r.stamps).toEqual(["dsp_1", "dsp_2", "dsp_3"]);
    expect(logs.filter((m) => m.startsWith("MC-Checkout:")).length).toBe(3);
  });

  it("requests suggestions and stops when Task ID is missing (no immediate create)", async () => {
    const { fetch, calls } = recorder((url) =>
      url.includes("/routing/suggest")
        ? {
            ok: true,
            json: {
              data: {
                routingSessionId: "rtx_suggest1",
                candidates: [
                  {
                    rank: 1,
                    taskId: "TASK-99",
                    matchScore: 80,
                    reasons: ["title_overlap"],
                    link: "http://mc/tasks/TASK-99",
                  },
                ],
                mcRoutingMarker: "MC-Routing: rtx_suggest1",
              },
            },
          }
        : { ok: false, status: 500, json: {} }
    );
    const logs: string[] = [];
    const r = await capture({
      env: {
        ...baseEnv,
        MC_TASK_TITLE: "Fix the thing",
        MC_BUCKET: "BKT-WMS",
        MC_MCP_API_KEY: "sek",
        MC_OPERATOR_EMAIL: "vince@petrasoap.com",
      },
      fetch,
      log: (m: string) => logs.push(m),
    });
    expect(r.created).toEqual([]);
    expect(r.stamps).toEqual([]);
    expect(r.taskIds).toEqual([]);
    expect(r.needsSelection).toBe(true);
    expect(r.routingSessionId).toBe("rtx_suggest1");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/api/cursor/routing/suggest");
    expect(calls.some((c) => c.url.includes("/api/tasks"))).toBe(false);
    expect(logs.some((m) => m.includes("routing suggestions ready"))).toBe(true);
    expect(logs).toContain("MC-Routing: rtx_suggest1");
  });

  it("creates only with explicit MC_CREATE_TASK=1 intent, then checks out", async () => {
    const { fetch, calls } = recorder((url) =>
      url.includes("/api/tasks")
        ? { ok: true, json: { data: { id: "TASK-99" } } }
        : { ok: true, json: { data: { checkoutId: "dsp_new" } } }
    );
    const r = await capture({
      env: {
        ...baseEnv,
        MC_TASK_TITLE: "Fix the thing",
        MC_BUCKET: "BKT-WMS",
        MC_CREATE_TASK: "1",
      },
      fetch,
      log: () => {},
    });
    expect(r.created).toEqual(["TASK-99"]);
    expect(r.stamps).toEqual(["dsp_new"]);
    expect(calls[0].url).toContain("/api/tasks");
    expect(calls[1].url).toContain("/api/compliance/checkout");
  });

  it("uses cursor checkout when MC_MCP_API_KEY is set", async () => {
    const { fetch, calls } = recorder(() => ({
      ok: true,
      json: { data: { checkoutId: "dsp_mcp" } },
    }));
    await capture({
      env: {
        ...baseEnv,
        MC_TASK_ID: "TASK-1",
        MC_MCP_API_KEY: "sek",
        MC_OPERATOR_EMAIL: "vince@petrasoap.com",
      },
      fetch,
      log: () => {},
    });
    expect(calls[0].url).toContain("/api/cursor/checkout");
    expect(calls[0].headers["x-api-key"]).toBe("sek");
    expect(calls[0].body).toEqual({ taskId: "TASK-1" });
  });
});
