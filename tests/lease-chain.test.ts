// TASK-3410: the pure lease-chain rules (src/lib/compliance/lease-chain.ts). The
// service wiring is proven in tests/compliance-server.test.ts.
import { afterEach, describe, expect, it } from "vitest";
import { chainVerdict, isLauncherPrincipal, namesLaunchLane, webhookExtendsChain } from "@/lib/compliance/lease-chain";
import type { DispatchHead } from "@/lib/compliance/repo";

const sha = (c: string) => c.repeat(40);
const head = (c: string, pr: number | null = 7): DispatchHead => ({
  headSha: sha(c), beforeSha: null, pr, source: "webhook", recordedBy: "github-webhook", recordedAt: "2026-10-20T00:00:00Z",
});

afterEach(() => {
  delete process.env.PLX_MC_LAUNCH_LANES;
  delete process.env.PLX_MC_LAUNCHER_PRINCIPALS;
});

describe("launcher lanes and principals", () => {
  it("names no lane and no launcher until they are configured", () => {
    expect(namesLaunchLane("claude-code/coding-1-l1")).toBe(false);
    expect(isLauncherPrincipal("sp_mcp_ledger")).toBe(false);
  });

  it("matches exact lanes and `*` prefixes, case-insensitively", () => {
    process.env.PLX_MC_LAUNCH_LANES = "codex/coding-1, Claude-Code/coding-1-*";
    process.env.PLX_MC_LAUNCHER_PRINCIPALS = "sp_mcp_ledger";
    expect(namesLaunchLane("codex/coding-1")).toBe(true);
    expect(namesLaunchLane("codex/coding-1-l2")).toBe(false);
    expect(namesLaunchLane("claude-code/coding-1-l3")).toBe(true);
    expect(namesLaunchLane("claude-code/claude")).toBe(false);
    expect(namesLaunchLane(null)).toBe(false);
    expect(isLauncherPrincipal("SP_MCP_LEDGER")).toBe(true);
    expect(isLauncherPrincipal("sp_mcp_claude_code")).toBe(false);
  });
});

describe("webhookExtendsChain", () => {
  const d = { baseSha: sha("0") };
  it("requires verified ancestry from a recorded head, or the base for the first head", () => {
    expect(webhookExtendsChain(d, [], { prNumber: 7, headSha: sha("a") }, sha("0"))).toBe(true);
    expect(webhookExtendsChain(d, [], { prNumber: 7, headSha: sha("a") })).toBe(false);
    expect(webhookExtendsChain(d, [head("a")], { prNumber: 7, headSha: sha("b") }, sha("a"))).toBe(true);
    expect(webhookExtendsChain(d, [head("a")], { prNumber: 7, headSha: sha("b") }, sha("0"))).toBe(false);
    expect(webhookExtendsChain(d, [head("a")], { prNumber: 8, headSha: sha("b") }, sha("a"))).toBe(false);
    expect(webhookExtendsChain(d, [head("a")], { prNumber: 7, headSha: sha("a") }, sha("a"))).toBe(false);
    expect(webhookExtendsChain(d, [], { prNumber: 7, headSha: "abc1234" }, sha("0"))).toBe(false);
  });
  it("never extends forced pushes or an unverified rewritten head", () => {
    expect(webhookExtendsChain(d, [head("a")], { prNumber: 7, headSha: sha("b"), forced: true }, sha("a"))).toBe(false);
    expect(webhookExtendsChain(d, [], { prNumber: 7, headSha: sha("b"), forced: true }, sha("0"))).toBe(false);
    expect(webhookExtendsChain(d, [head("a")], { prNumber: 7, headSha: sha("b") })).toBe(false);
  });
});

describe("chainVerdict", () => {
  const d = { id: "dsp_abcd1234", baseSha: null };
  const input = { prNumber: 7, headSha: sha("c") };
  it("accepts a recorded head, attaches to an empty chain, and records a descendant", () => {
    expect(chainVerdict(d, [head("c")], input, [])).toEqual({ ok: true, record: false });
    expect(chainVerdict(d, [], input, [])).toEqual({ ok: true, record: true });
    expect(chainVerdict(d, [head("a", null)], input, [sha("a"), sha("c")])).toEqual({ ok: true, record: true });
  });

  it("seeds an empty chain from a base SHA only with verified base ancestry", () => {
    const based = { id: "dsp_abcd1234", baseSha: sha("0") };
    expect(chainVerdict(based, [], input, [sha("c")])).toMatchObject({ ok: false, reason: expect.stringContaining("no verified ancestry from checkout dsp_…1234's base 0000000") });
    expect(chainVerdict(based, [], input, [sha("c")], true)).toEqual({ ok: true, record: true });
    expect(chainVerdict(based, [head("c")], input, [])).toEqual({ ok: true, record: false });
  });

  it("names a rewritten history and a chain bound to another PR", () => {
    expect(chainVerdict(d, [head("a")], input, [sha("b"), sha("c")])).toMatchObject({ ok: false, reason: expect.stringContaining("outside checkout dsp_…1234") });
    expect(chainVerdict(d, [head("a", 9)], input, [sha("a")])).toMatchObject({ ok: false, reason: expect.stringContaining("bound to PR #9, not #7") });
  });
});
