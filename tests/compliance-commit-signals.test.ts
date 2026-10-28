// TASK-3336: agent signals and the trailer block on a PR's head commits (pure).
import { describe, expect, it } from "vitest";
import { agentSignals, commitTrailers } from "@/lib/compliance/commit-signals";
import type { PrCommit } from "@/lib/compliance/github-pr";

const human: PrCommit = {
  sha: "a".repeat(40),
  message: "fix",
  authorName: "Taylor Alton",
  authorEmail: "taylor@petralabx.com",
  authorLogin: "taylorvalton",
  committerName: "GitHub",
  committerEmail: "noreply@github.com",
  committerLogin: "web-flow",
  parents: ["b".repeat(40)],
};
const BLOCK = "Agent: claude/claude-uat\nOn-Behalf-Of: cos@petrasoap.com\nMC-Checkout: dsp_abc123";

describe("agentSignals", () => {
  it("finds nothing on a human commit, including a GitHub web-flow committer", () => {
    expect(agentSignals(human)).toEqual([]);
  });

  it.each([
    [{ authorLogin: "dependabot[bot]" }, "[bot] identity"],
    [{ committerLogin: "plx-agents-app" }, "plx-agents identity"],
    [{ authorName: "PLX Agent" }, "PLX Agent identity"],
    [{ authorEmail: "COS@petrasoap.com" }, "lane email cos@petrasoap.com"],
    [{ committerEmail: "uat@petrasoap.com" }, "lane email uat@petrasoap.com"],
    [{ message: "fix\n\nCo-Authored-By: Claude Opus <noreply@anthropic.com>" }, "agent Co-Authored-By trailer"],
    [{ message: "fix\n\nco-authored-by: Codex <codex@openai.com>" }, "agent Co-Authored-By trailer"],
    [{ message: "fix\n\nCo-Authored-By: Cursor Agent <cursoragent@cursor.com>" }, "agent Co-Authored-By trailer"],
    [{ message: "fix\n\nMC-Checkout: dsp_abc123" }, "MC-Checkout trailer"],
  ] as [Partial<PrCommit>, string][])("flags %o", (over, signal) => {
    expect(agentSignals({ ...human, ...over })).toContain(signal);
  });

  it("does not flag a human Co-Authored-By", () => {
    expect(agentSignals({ ...human, message: "fix\n\nCo-Authored-By: Vince <vince@petrasoap.com>" })).toEqual([]);
  });
});

describe("commitTrailers", () => {
  it("accepts the three trailers in order with MC-Checkout last, ignoring trailing newlines", () => {
    expect(commitTrailers(`fix\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n${BLOCK}\n\n`)).toEqual({
      agent: "claude/claude-uat",
      onBehalfOf: "cos@petrasoap.com",
      checkoutId: "dsp_abc123",
      problems: [],
    });
  });

  it("flags an MC-Checkout trailer that is not the last line", () => {
    expect(commitTrailers(`fix\n\n${BLOCK}\nCo-Authored-By: Claude <noreply@anthropic.com>`).problems).toEqual([
      "MC-Checkout trailer is not the last line",
    ]);
  });

  it("flags trailers out of order", () => {
    const message = "fix\n\nOn-Behalf-Of: cos@petrasoap.com\nAgent: claude/claude-uat\nMC-Checkout: dsp_abc123";
    expect(commitTrailers(message).problems).toEqual([
      "trailers are not the last three lines in order Agent, On-Behalf-Of, MC-Checkout",
    ]);
  });

  it("flags each missing trailer", () => {
    expect(commitTrailers("fix\n\nMC-Checkout: dsp_abc123").problems).toEqual([
      "missing Agent trailer",
      "missing On-Behalf-Of trailer",
    ]);
  });

  it("flags a repeated trailer and a malformed checkout id", () => {
    const repeated = commitTrailers(`fix\n\nMC-Checkout: dsp_old\n${BLOCK}`);
    expect(repeated.problems).toEqual(["more than one MC-Checkout trailer"]);
    const malformed = commitTrailers("fix\n\nAgent: claude/x\nOn-Behalf-Of: cos@petrasoap.com\nMC-Checkout: pending");
    expect(malformed).toMatchObject({ checkoutId: null, problems: ["MC-Checkout trailer is not a dsp_* id"] });
  });
});
