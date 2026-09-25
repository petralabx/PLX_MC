// scripts/mc.mjs — dependency-free REST fallback CLI for when the MCP connector
// is unavailable. Pure arg parsing + request building are tested directly; run()
// is driven with a fake fetch (no network).

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

const cliUrl = pathToFileURL(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../scripts/mc.mjs")
).href;
const { DEFAULT_MC_BASE_URL, buildRequest, parseArgs, run } = await import(cliUrl);

const ENV = {
  MC_MCP_API_KEY: "k-test",
  MC_OPERATOR_EMAIL: "Vince@PetraSoap.com",
  MC_REPO: "petralabx/PLX_MC",
};

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return undefined;
}

describe("parseArgs", () => {
  it("collects a repeatable --verify and single-value flags", () => {
    expect(
      parseArgs([
        "complete",
        "--checkout",
        "dsp_x",
        "--summary",
        "Did the thing",
        "--verify",
        "npm run typecheck",
        "--verify",
        "npx vitest run",
        "--rollback",
        "git revert HEAD",
      ])
    ).toEqual({
      command: "complete",
      flags: {
        checkout: "dsp_x",
        summary: "Did the thing",
        verify: ["npm run typecheck", "npx vitest run"],
        rollback: "git revert HEAD",
      },
    });
  });

  it("rejects unknown flags, missing values and unknown commands", () => {
    expect(codeOf(() => parseArgs(["checkout", "--tsk", "TASK-1"]))).toBe("invalid_args");
    expect(codeOf(() => parseArgs(["checkout", "--task"]))).toBe("invalid_args");
    expect(codeOf(() => parseArgs(["deploy"]))).toBe("invalid_args");
    expect(codeOf(() => parseArgs([]))).toBe("invalid_args");
  });
});

describe("buildRequest", () => {
  it("builds the checkout call against the cursor REST API with MCP headers", () => {
    const req = buildRequest(
      parseArgs(["checkout", "--task", "TASK-123", "--repo", "petralabx/local-inference"]),
      ENV
    );
    expect(req).toEqual({
      method: "POST",
      url: `${DEFAULT_MC_BASE_URL}/api/cursor/checkout`,
      headers: {
        "content-type": "application/json",
        "x-api-key": "k-test",
        "x-mc-operator-email": "vince@petrasoap.com",
        "x-mc-repo": "petralabx/local-inference",
        "x-mc-runtime": "mc-cli",
        "x-mc-worker-id": "mc-cli",
      },
      body: { taskId: "TASK-123", repo: "petralabx/local-inference" },
    });
    expect(DEFAULT_MC_BASE_URL).toBe("https://mc.plxcustomer.io");
  });

  it("builds complete with every --verify and the rollback", () => {
    const req = buildRequest(
      parseArgs([
        "complete",
        "--checkout",
        "dsp_x",
        "--summary",
        "s",
        "--verify",
        "a",
        "--verify",
        "b",
        "--rollback",
        "r",
        "--pr",
        "https://github.com/petralabx/PLX_MC/pull/9",
      ]),
      { ...ENV, MC_BASE_URL: "http://localhost:3000/", MC_RUNTIME: "claude-code" }
    );
    expect(req.method).toBe("POST");
    expect(req.url).toBe("http://localhost:3000/api/cursor/complete");
    expect(req.headers["x-mc-runtime"]).toBe("claude-code");
    expect(req.body).toEqual({
      checkoutId: "dsp_x",
      summary: "s",
      verificationCommands: ["a", "b"],
      rollback: "r",
      prUrl: "https://github.com/petralabx/PLX_MC/pull/9",
    });
  });

  it("refuses complete without at least one verify command or without a rollback", () => {
    const base = ["complete", "--checkout", "dsp_x", "--summary", "s"];
    expect(codeOf(() => buildRequest(parseArgs([...base, "--rollback", "r"]), ENV))).toBe(
      "verify_required"
    );
    expect(
      codeOf(() => buildRequest(parseArgs([...base, "--verify", "  ", "--rollback", "r"]), ENV))
    ).toBe("verify_required");
    expect(codeOf(() => buildRequest(parseArgs([...base, "--verify", "a"]), ENV))).toBe(
      "rollback_required"
    );
    expect(
      codeOf(() => buildRequest(parseArgs([...base, "--verify", "a", "--rollback", " "]), ENV))
    ).toBe("rollback_required");
  });

  it("builds status as a read of the task", () => {
    const req = buildRequest(parseArgs(["status", "--task", "TASK-123"]), ENV);
    expect(req).toMatchObject({
      method: "GET",
      url: `${DEFAULT_MC_BASE_URL}/api/cursor/tasks/TASK-123`,
    });
    expect(req.body).toBeUndefined();
  });

  it("fails closed on missing credentials, operator, or repo slug", () => {
    const status = parseArgs(["status", "--task", "TASK-1"]);
    expect(codeOf(() => buildRequest(status, { ...ENV, MC_MCP_API_KEY: "" }))).toBe(
      "missing_api_key"
    );
    expect(codeOf(() => buildRequest(status, { ...ENV, MC_OPERATOR_EMAIL: "" }))).toBe(
      "missing_operator"
    );
    expect(codeOf(() => buildRequest(status, { ...ENV, MC_REPO: "" }))).toBe("missing_repo");
    expect(codeOf(() => buildRequest(status, { ...ENV, MC_REPO: "PLX_MC" }))).toBe(
      "invalid_repo"
    );
  });
});

describe("run", () => {
  function fakeFetch(status: number, json: unknown) {
    return vi.fn(async () => new Response(JSON.stringify(json), { status }));
  }

  it("prints the server envelope and exits 0 on success", async () => {
    const fetch = fakeFetch(200, {
      data: { checkoutId: "dsp_1", taskId: "TASK-1", prBodyLine: "MC-Checkout: dsp_1", actor: { repo: "petralabx/PLX_MC" } },
      meta: {},
    });
    const result = await run(["checkout", "--task", "TASK-1"], { env: ENV, fetch });
    expect(result.exitCode).toBe(0);
    expect(result.output.data.prBodyLine).toBe("MC-Checkout: dsp_1");
    expect(fetch).toHaveBeenCalledWith(
      "https://mc.plxcustomer.io/api/cursor/checkout",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ taskId: "TASK-1", repo: "petralabx/PLX_MC" }) })
    );
  });

  it("never sends complete without verify + rollback", async () => {
    const fetch = vi.fn();
    const result = await run(
      ["complete", "--checkout", "dsp_1", "--summary", "s", "--rollback", "r"],
      { env: ENV, fetch }
    );
    expect(result.exitCode).toBe(1);
    expect(result.output.error.code).toBe("verify_required");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("exits 1 with the server error code", async () => {
    const fetch = fakeFetch(403, {
      error: { code: "repo_not_allowlisted", message: "repo 'x/y' is not on the MCP checkout allowlist." },
    });
    const result = await run(["checkout", "--task", "TASK-1", "--repo", "x/y"], { env: ENV, fetch });
    expect(result.exitCode).toBe(1);
    expect(result.output).toEqual({
      error: {
        code: "repo_not_allowlisted",
        message: "repo 'x/y' is not on the MCP checkout allowlist.",
        status: 403,
      },
    });
  });

  it("refuses a checkout receipt whose actor.repo is not the repo under edit", async () => {
    const fetch = fakeFetch(200, {
      data: { checkoutId: "dsp_1", taskId: "TASK-1", prBodyLine: "MC-Checkout: dsp_1", actor: { repo: "petralabx/PLX_MC" } },
    });
    const result = await run(
      ["checkout", "--task", "TASK-1", "--repo", "petralabx/local-inference"],
      { env: ENV, fetch }
    );
    expect(result.exitCode).toBe(1);
    expect(result.output.error.code).toBe("checkout_repo_mismatch");
  });

  it("reports a network failure as network_error", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const result = await run(["status", "--task", "TASK-1"], { env: ENV, fetch });
    expect(result.exitCode).toBe(1);
    expect(result.output.error.code).toBe("network_error");
  });
});
