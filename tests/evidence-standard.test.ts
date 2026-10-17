// TASK-3165: the human-verification evidence standard. Agent text that a person
// must verify is held to STE-lite (a measurable part of ASD-STE100). The check
// is deterministic. It warns until 2026-10-24 (Toronto), then it blocks.
import { describe, expect, it } from "vitest";

import type { Evidence, Task } from "@/lib/mc-data";
import {
  EVIDENCE_STANDARD_ENFORCE_FROM,
  blockingFindings,
  evidenceStandardMode,
  evidenceStandardReport,
  requiresHumanVerification,
  steLiteFindings,
  verifyCompliance,
} from "@/lib/compliance";

const WARN = Date.parse("2026-10-20T12:00:00Z");
const BLOCK = Date.parse("2026-10-25T12:00:00Z");
const n = (count: number) => Array.from({ length: count }, (_, i) => `word${i + 1}`).join(" ");
const errors = (text: string) => steLiteFindings(text).filter((f) => f.severity === "error");

describe("steLiteFindings", () => {
  it("accepts short, active sentences", () => {
    expect(steLiteFindings("Open the Skills screen. Select a skill. The page shows its install command.")).toEqual([]);
  });

  it("flags a sentence over 25 words, with the count and the start of the sentence", () => {
    const [finding] = errors(`${n(26)}.`);
    expect(finding).toMatchObject({ rule: "sentence-length", severity: "error" });
    expect(finding.message).toBe('Sentence has 26 words. Limit: 25. "word1 word2 word3 word4 word5 word6 word7 word8 …"');
    expect(errors(`${n(25)}.`)).toEqual([]);
  });

  it("holds a numbered step to 20 words and a bullet to 25", () => {
    expect(errors(`1. ${n(21)}.`)).toMatchObject([{ rule: "step-length" }]);
    expect(errors(`1. ${n(20)}.`)).toEqual([]);
    expect(errors(`- ${n(21)}.`)).toEqual([]);
  });

  it("flags a prose paragraph of more than 6 sentences, but not a long list", () => {
    expect(errors("One. Two. Three. Four. Five. Six. Seven.")).toMatchObject([{ rule: "paragraph-length" }]);
    expect(errors("One. Two. Three. Four. Five. Six.")).toEqual([]);
    expect(errors(Array.from({ length: 8 }, (_, i) => `- Item ${i}.`).join("\n"))).toEqual([]);
    expect(errors("One. Two. Three.\n\nFour. Five. Six. Seven.")).toEqual([]);
  });

  it("counts code, links, URLs and paths as one word, and skips code blocks and tables", () => {
    const text = [
      "Run `npx vitest run tests/auth-session-ended.test.ts tests/middleware-routing.test.ts --reporter verbose` now.",
      "See [the long permissions README for every role and rule](https://example.test/a/b) first.",
      "Edit src/lib/compliance/evidence-standard.ts and https://example.test/very/long/url?with=many&query=params today.",
      "```",
      n(40),
      "```",
      `| ${n(30)} |`,
    ].join("\n");
    expect(errors(text)).toEqual([]);
  });

  it("does not end a sentence at e.g. or i.e.", () => {
    expect(errors("Use a short form, e.g. a list. It reads well, i.e. fast.")).toEqual([]);
  });

  it("gives passive voice as advice that never blocks, and does not flag adjectives", () => {
    const findings = steLiteFindings("The fix was released yesterday.");
    expect(findings).toMatchObject([{ rule: "passive-voice", severity: "advice" }]);
    expect(blockingFindings({ ...evidenceStandardReport("The fix was released yesterday.", true, BLOCK) })).toEqual([]);
    expect(steLiteFindings("The file is open. The badge is green. The row was red.")).toEqual([]);
  });

  it("ends a sentence after a URL or etc. that closes it", () => {
    expect(
      errors(
        "Open the order preview page for the first pending customer order at https://staging.plxcustomer.io/orders/123. " +
          "Click the Ship button and confirm that the shipping dialog closes without any error."
      )
    ).toEqual([]);
    expect(errors(`Check the forms, tables, lists, etc. ${n(20)}.`)).toEqual([]);
  });

  it("reads plain lines after a colon, and one-word lines, as list items", () => {
    const paths = Array.from({ length: 30 }, (_, i) => `src/file${i}.ts`);
    expect(errors(["Files changed:", ...paths].join("\n"))).toEqual([]);
    expect(errors(["Commands run:", ...Array.from({ length: 12 }, () => "npm run test -- --run")].join("\n"))).toEqual([]);
    expect(errors(paths.join("\n"))).toEqual([]);
  });

  it("checks a wrapped step as one step, and checks quoted text", () => {
    const wrapped =
      "1. Open the orders page and pick the first order that shows a pending status\n" +
      "   in the list, then click Ship and confirm the dialog closes and the status changes.";
    expect(errors(wrapped)).toMatchObject([{ rule: "step-length", message: expect.stringMatching(/^Step has 29 words/) }]);
    expect(errors(`> ${n(26)}.`)).toMatchObject([{ rule: "sentence-length" }]);
  });
});

describe("scope and timing", () => {
  it("applies to verify:human, kind:human-test and high-risk work only", () => {
    expect(requiresHumanVerification(["Verify:Human"])).toBe(true);
    expect(requiresHumanVerification(["kind:human-test"])).toBe(true);
    expect(requiresHumanVerification([], "high")).toBe(true);
    expect(requiresHumanVerification(["kind:code", "lane:ops"], "standard")).toBe(false);
    expect(requiresHumanVerification(undefined)).toBe(false);
  });

  it("warns for one week, then blocks from midnight 2026-10-24 Toronto", () => {
    expect(EVIDENCE_STANDARD_ENFORCE_FROM).toBe("2026-10-24T04:00:00.000Z");
    expect(evidenceStandardMode(Date.parse("2026-10-24T03:59:59Z"))).toBe("warn");
    expect(evidenceStandardMode(Date.parse("2026-10-24T04:00:00Z"))).toBe("block");
  });

  it("blocks only on errors, on work that needs human verification, once blocking starts", () => {
    const long = `${n(30)}.`;
    expect(blockingFindings(evidenceStandardReport(long, true, WARN))).toEqual([]);
    expect(blockingFindings(evidenceStandardReport(long, false, BLOCK))).toEqual([]);
    expect(blockingFindings(evidenceStandardReport(long, true, BLOCK))).toMatchObject([{ rule: "sentence-length" }]);
  });
});

describe("verifyCompliance with the evidence standard", () => {
  const taskish = (over: Partial<Task>): Task => ({
    id: "TASK-X", title: "t", bucket: "BKT-WMS", stage: "progress", priority: "medium", assignee: "vibes",
    coassignees: [], reporter: "vince", accountableOwner: "greg", reqs: [], repos: [], estimate: "M",
    labels: [], prs: [], due: "—", sync: { state: "pending", ts: "—", sp: "—" }, subtasks: [], activity: [],
    ...over,
  });
  const evidence = (summary: string): Evidence => ({
    summary,
    items: [{ key: "a", label: "a", done: true }],
    rollback: "Revert the PR.",
    qa: { pass: 1, fail: 0, total: 1, suite: "vitest", ran: "now", tests: [] },
  });
  const long = `${n(30)}.`;
  const verify = (task: Task, tier: "standard" | "high", now: number) =>
    verifyCompliance({ task, actor: "agent", tier, bucketPrd: "present", now });

  it("adds a warning note but passes during the warn-only week", () => {
    const r = verify(taskish({ labels: ["verify:human"], evidence: evidence(long) }), "standard", WARN);
    expect(r.verdict).toBe("pass");
    expect(r.reasons.join(" ")).toMatch(/evidence summary breaks STE-lite \(1\): Sentence has 30 words.*Warning only until 2026-10-24\./);
  });

  it("blocks after the week, for a labelled task and for any high-risk change", () => {
    const labelled = verify(taskish({ labels: ["verify:human"], evidence: evidence(long) }), "standard", BLOCK);
    expect(labelled.verdict).toBe("block");
    expect(labelled.reasons[0]).toMatch(/^evidence summary breaks STE-lite \(1\)/);
    expect(verify(taskish({ evidence: evidence(long) }), "high", BLOCK).verdict).toBe("block");
  });

  it("leaves work that needs no human verification, and operator PRs, alone", () => {
    const r = verify(taskish({ evidence: evidence(long) }), "standard", BLOCK);
    expect(r.verdict).toBe("pass");
    expect(r.reasons.join(" ")).not.toMatch(/STE-lite/);
    expect(
      verifyCompliance({ task: taskish({ labels: ["verify:human"], evidence: evidence(long) }), actor: "operator", tier: "high", bucketPrd: "unknown", now: BLOCK }).verdict
    ).toBe("pass");
  });

  it("passes a clean summary after the week", () => {
    const r = verify(taskish({ labels: ["verify:human"], evidence: evidence("API calls now get a 401. The browser goes to sign-in.") }), "standard", BLOCK);
    expect(r.verdict).toBe("pass");
  });
});
