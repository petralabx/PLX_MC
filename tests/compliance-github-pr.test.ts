// mc_verify_pr input loader: reads a PR's head SHA, labels, MC-Checkout stamps
// and changed paths from GitHub (the same inputs the compliance-gate workflow
// sends to /api/compliance/verify). GitHub is stubbed; no network.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ resolveGithubToken: vi.fn() }));

vi.mock("@/lib/github-app", () => ({ resolveGithubToken: m.resolveGithubToken }));

import { loadPrVerifyInput } from "@/lib/compliance/github-pr";

const PR = {
  number: 7,
  body: "MC-Checkout: dsp_one\nMC-Checkout: dsp_two\nMC-Checkout: dsp_one\n",
  labels: [{ name: "db" }],
  head: { sha: "abc7", ref: "feature" },
  base: { ref: "main", repo: { id: 1, name: "plx-customer-portal", full_name: "petralabx/plx-customer-portal" } },
  user: { login: "agent" },
};

function files(count: number, prefix: string) {
  return Array.from({ length: count }, (_, i) => ({ filename: `${prefix}/${i}.ts` }));
}

beforeEach(() => {
  m.resolveGithubToken.mockResolvedValue("tok");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadPrVerifyInput", () => {
  it("pages through every changed file and parses every stamp", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/pulls/7")) return Response.json(PR);
      if (url.endsWith("page=1")) return Response.json(files(100, "a"));
      if (url.endsWith("page=2")) return Response.json(files(3, "b"));
      return new Response("unexpected", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const loaded = await loadPrVerifyInput("petralabx/plx-customer-portal", 7);

    expect(loaded.truncated).toBe(false);
    expect(loaded.input).toMatchObject({
      repo: "plx-customer-portal",
      repoFullName: "petralabx/plx-customer-portal",
      prNumber: 7,
      headSha: "abc7",
      labels: ["db"],
      checkoutIds: ["dsp_one", "dsp_two"],
      checkoutId: "dsp_one",
    });
    expect(loaded.input.changedPaths).toHaveLength(103);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[1][0])).toContain("/pulls/7/files?per_page=100&page=1");
  });

  it("maps a missing or unreadable PR to not_found", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    await expect(loadPrVerifyInput("petralabx/PLX_MC", 999)).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
  });

  it("maps other GitHub failures to github_error with the HTTP status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 403 })));
    await expect(loadPrVerifyInput("petralabx/PLX_MC", 1)).rejects.toMatchObject({
      code: "github_error",
      message: expect.stringContaining("403"),
    });
  });

  it("maps a network failure to github_unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );
    await expect(loadPrVerifyInput("petralabx/PLX_MC", 1)).rejects.toMatchObject({
      code: "github_unreachable",
    });
  });

  it("refuses to call GitHub without a credential", async () => {
    m.resolveGithubToken.mockResolvedValueOnce(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadPrVerifyInput("petralabx/PLX_MC", 1)).rejects.toMatchObject({
      code: "github_unavailable",
      status: 503,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
