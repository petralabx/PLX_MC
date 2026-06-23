// EN-007 — the capture hook (agent-governance-automation P3). Proves the
// hands-off behavior without a live server: default-off no-op, single + multi
// checkout (one stamp per task), auto-create-or-checkout, and optional basic-auth
// pass-through. fetch is injected so no network is touched.
import { describe, it, expect } from "vitest";
import { capture } from "../scripts/compliance-checkout.mjs";

type FetchCall = { url: string; body: Record<string, unknown>; headers: Record<string, string> };

function recorder(handler: (url: string) => { ok: boolean; status?: number; json: unknown }) {
  const calls: FetchCall[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      body: JSON.parse(String(init?.body ?? "{}")),
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const r = handler(url);
    return { ok: r.ok, status: r.status ?? (r.ok ? 200 : 500), json: async () => r.json } as unknown as Response;
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const baseEnv = { COMPLIANCE_CAPTURE: "1", MC_BASE_URL: "http://mc", MC_ACCOUNTABLE: "vince", MC_REPO: "PLX_MC" };

describe("compliance capture hook", () => {
  it("is a no-op when disabled (default-off)", async () => {
    const { fetch, calls } = recorder(() => ({ ok: true, json: {} }));
    const r = await capture({ env: {}, fetch, log: () => {} });
    expect(r.enabled).toBe(false);
    expect(calls.length).toBe(0);
  });

  it("checks out a single task and emits one stamp", async () => {
    const { fetch, calls } = recorder(() => ({ ok: true, json: { data: { checkoutId: "dsp_a" } } }));
    const logs: string[] = [];
    const r = await capture({ env: { ...baseEnv, MC_TASK_ID: "TASK-1" }, fetch, log: (m: string) => logs.push(m) });
    expect(r.stamps).toEqual(["dsp_a"]);
    expect(logs).toContain("MC-Checkout: dsp_a");
    expect(calls[0].body).toMatchObject({ taskId: "TASK-1", repo: "PLX_MC", accountableHuman: "vince" });
  });

  it("checks out MULTIPLE tasks (comma/space separated) and stamps each", async () => {
    let n = 0;
    const { fetch } = recorder(() => ({ ok: true, json: { data: { checkoutId: `dsp_${++n}` } } }));
    const logs: string[] = [];
    const r = await capture({ env: { ...baseEnv, MC_TASK_ID: "TASK-1, TASK-2 TASK-3" }, fetch, log: (m: string) => logs.push(m) });
    expect(r.taskIds).toEqual(["TASK-1", "TASK-2", "TASK-3"]);
    expect(r.stamps).toEqual(["dsp_1", "dsp_2", "dsp_3"]);
    expect(logs.filter((m) => m.startsWith("MC-Checkout:")).length).toBe(3);
  });

  it("auto-creates a task when none is supplied, then checks it out", async () => {
    const { fetch, calls } = recorder((url) =>
      url.includes("/api/tasks")
        ? { ok: true, json: { data: { id: "TASK-99" } } }
        : { ok: true, json: { data: { checkoutId: "dsp_new" } } }
    );
    const r = await capture({ env: { ...baseEnv, MC_TASK_TITLE: "Fix the thing", MC_BUCKET: "BKT-WMS" }, fetch, log: () => {} });
    expect(r.created).toEqual(["TASK-99"]);
    expect(r.stamps).toEqual(["dsp_new"]);
    expect(calls[0].url).toContain("/api/tasks");
    expect(calls[0].body).toMatchObject({ title: "Fix the thing", bucket: "BKT-WMS", reporter: "vince" });
    expect(calls[1].url).toContain("/api/compliance/checkout");
  });

  it("throws when there is no task id and nothing to auto-create from", async () => {
    const { fetch } = recorder(() => ({ ok: true, json: {} }));
    await expect(capture({ env: { ...baseEnv }, fetch, log: () => {} })).rejects.toThrow(/auto-create/);
  });

  it("sends basic-auth when MC_BASIC_AUTH is set", async () => {
    const { fetch, calls } = recorder(() => ({ ok: true, json: { data: { checkoutId: "dsp_a" } } }));
    await capture({ env: { ...baseEnv, MC_TASK_ID: "TASK-1", MC_BASIC_AUTH: "u:p" }, fetch, log: () => {} });
    expect(calls[0].headers.authorization).toBe(`Basic ${Buffer.from("u:p").toString("base64")}`);
  });
});
