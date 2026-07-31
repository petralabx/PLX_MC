// EN-007 close-out verify — contract tests for scripts/compliance-pr-verify.mjs.
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";

const verifyUrl = pathToFileURLSafe(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../scripts/compliance-pr-verify.mjs")
);
const { verify } = await import(verifyUrl);

function pathToFileURLSafe(filePath: string): string {
  const normalized = path.resolve(filePath);
  let pathname = normalized.replace(/\\/g, "/");
  if (!pathname.startsWith("/")) pathname = `/${pathname}`;
  pathname = pathname.replace(/ /g, "%20");
  return `file://${pathname}`;
}

type FetchCall = { url: string };

function recorder(handler: (url: string) => { ok: boolean; status?: number; json: unknown }) {
  const calls: FetchCall[] = [];
  const fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push({ url });
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
  MC_BASE_URL: "http://mc",
  MC_REPO: "petralabx/local-inference",
  MC_MCP_API_KEY: "test-key",
  MC_OPERATOR_EMAIL: "cos@petrasoap.com",
  MC_PR_NUMBER: "11",
};

function ghStub(body: string, rollup: string) {
  return (args: string[]) => {
    const joined = args.join(" ");
    if (joined.includes("statusCheckRollup")) {
      return { status: 0, stdout: rollup + "\n", stderr: "" };
    }
    if (joined.includes("body") || joined.includes(".body")) {
      return { status: 0, stdout: body, stderr: "" };
    }
    return { status: 0, stdout: "", stderr: "" };
  };
}

describe("compliance-pr-verify", () => {
  it("fails when actor.repo does not match MC_REPO (decision 3 root cause)", async () => {
    const { fetch } = recorder((url) => {
      if (url.includes("/self-check")) {
        return {
          ok: true,
          json: { data: { ok: true }, meta: { actor: { repo: "petralabx/plx-customer-portal" } } },
        };
      }
      return { ok: true, json: {} };
    });
    const logs: string[] = [];
    const r = await verify({
      env: baseEnv,
      fetch,
      gh: ghStub("MC-Checkout: dsp_x\nTASK-1", "COMPLETED\tSUCCESS"),
      log: (m) => logs.push(m),
      argv: [],
    });
    expect(r.ok).toBe(false);
    expect(logs.some((l) => l.includes("FAIL") && l.includes("actor.repo"))).toBe(true);
  });

  it("rejects a PR with no MC-Checkout stamp", async () => {
    const { fetch } = recorder((url) => {
      if (url.includes("/self-check")) {
        return {
          ok: true,
          json: { data: { ok: true }, meta: { actor: { repo: "petralabx/local-inference" } } },
        };
      }
      return { ok: true, json: { data: { tasks: [] } } };
    });
    const r = await verify({
      env: baseEnv,
      fetch,
      gh: ghStub("## Summary\nnothing", "COMPLETED\tSUCCESS"),
      log: () => {},
      argv: [],
    });
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => x.includes("no 'MC-Checkout"))).toBe(true);
  });

  it("rejects a failing compliance conclusion even when evidence looks fine", async () => {
    const { fetch } = recorder((url) => {
      if (url.includes("/self-check")) {
        return {
          ok: true,
          json: { data: { ok: true }, meta: { actor: { repo: "petralabx/local-inference" } } },
        };
      }
      if (url.includes("/context")) {
        return {
          ok: true,
          json: {
            data: {
              tasks: [
                {
                  id: "TASK-883",
                  stage: "review",
                  evidence: { summary: "s", rollback: "r" },
                },
              ],
            },
          },
        };
      }
      return { ok: true, json: {} };
    });
    const r = await verify({
      env: baseEnv,
      fetch,
      gh: ghStub("- Task: TASK-883\n- MC-Checkout: dsp_ok", "COMPLETED\tFAILURE"),
      log: () => {},
      argv: [],
    });
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => x.includes("compliance = FAILURE"))).toBe(true);
  });

  it("accepts correct scope + stamp + evidence + green gate", async () => {
    const { fetch } = recorder((url) => {
      if (url.includes("/self-check")) {
        return {
          ok: true,
          json: { data: { ok: true }, meta: { actor: { repo: "petralabx/local-inference" } } },
        };
      }
      if (url.includes("/context")) {
        return {
          ok: true,
          json: {
            data: {
              tasks: [
                {
                  id: "TASK-883",
                  stage: "merged",
                  evidence: { summary: "done", rollback: "revert" },
                },
              ],
            },
          },
        };
      }
      return { ok: true, json: {} };
    });
    const r = await verify({
      env: baseEnv,
      fetch,
      gh: ghStub("- Task: TASK-883\n- MC-Checkout: dsp_ok", "COMPLETED\tSUCCESS"),
      log: () => {},
      argv: [],
    });
    expect(r.ok).toBe(true);
  });

  it("defers stamp/gate checks when no PR exists yet", async () => {
    const { fetch } = recorder(() => ({
      ok: true,
      json: { data: { ok: true }, meta: { actor: { repo: "petralabx/local-inference" } } },
    }));
    const r = await verify({
      env: { ...baseEnv, MC_PR_NUMBER: "" },
      fetch,
      gh: () => ({ status: 0, stdout: "", stderr: "" }),
      log: () => {},
      argv: [],
    });
    expect(r.ok).toBe(true);
    expect(r.deferred).toBe(true);
  });
});
