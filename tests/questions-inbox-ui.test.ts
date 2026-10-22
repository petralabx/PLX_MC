// TASK-3567, redesigned in TASK-3721 — the decision sheet for a question shows
// the question, its context, every option with the bot's recommendation marked
// and why, and a box for a typed answer. A colleague's question (My projects)
// is read-only: no radios, no send, only Open task and Remind. No DOM
// environment (vitest runs in Node), so sheets render with renderToStaticMarkup.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ApprovalsInboxView } from "@/components/mc/approvals-inbox";
import { personRef, remindCoolingDown, type Draft } from "@/components/mc/approvals-inbox.helpers";
import { viewerTokens } from "@/components/mc/needs-me";
import {
  ColleagueQuestionSheet,
  MyQuestionSheet,
  canSendAnswer,
  questionAnchorId,
  type OpenQuestionRow,
} from "@/components/mc/questions-inbox";
import { HUMANS, QUESTION_REMIND_COOLDOWN_MS, type TaskQuestion } from "@/lib/mc-data";

const ROW: OpenQuestionRow = {
  taskId: "TASK-1418",
  taskTitle: "Posting setup in the new books",
  stage: "backlog",
  question: {
    id: "q_0123456789abcdef",
    addressee: "ricardo",
    text: "Do packaging items get their own posting group?",
    options: ["Yes, MFGPKG", "No, stay on RAW MAT"],
    recommended: 0,
    recommendationReason: "41499 is live in all three books",
    askedBy: "cos@petrasoap.com",
    askedByPrincipal: "sp_mcp_grok",
    askedRuntime: "grok",
    askedAt: "2026-10-21T16:00:00.000Z",
    status: "open",
    context: "Packaging is booked to RAW MAT today.",
  },
};

const nameOf = (id: string) => personRef(id, (x) => HUMANS[x]).name;

const mine = (question: TaskQuestion, draft: Draft = { text: "" }) =>
  renderToStaticMarkup(
    createElement(MyQuestionSheet, {
      question,
      taskId: ROW.taskId,
      draft,
      busy: false,
      error: null,
      nameOf,
      onChoice: () => {},
      onText: () => {},
      onSend: () => {},
      onSkip: () => {},
    })
  );

const NOW = Date.parse("2026-10-22T12:00:00.000Z");
const ME = viewerTokens({ id: "vince", email: "vince@petrasoap.com" });

const colleague = (question: TaskQuestion) =>
  renderToStaticMarkup(
    createElement(ColleagueQuestionSheet, {
      question,
      taskId: ROW.taskId,
      person: personRef(question.addressee, (x) => HUMANS[x]),
      reasonText: "You see it because you own Finance.",
      waitingFor: "20 h",
      stale: false,
      coolingDown: remindCoolingDown(question, ME, NOW),
      busy: false,
      error: null,
      nameOf,
      openTask: createElement("a", { className: "ap-btn", href: "/?screen=task&taskId=TASK-1418" }, "Open task"),
      onRemind: () => {},
    })
  );

describe("MyQuestionSheet", () => {
  it("shows the question, its context, each option, and marks only the recommended one with why", () => {
    const html = mine(ROW.question);
    expect(html).toContain('data-testid="question-card"');
    expect(html).toContain("Do packaging items get their own posting group?");
    expect(html).toContain("Packaging is booked to RAW MAT today.");
    expect(html).toContain("Yes, MFGPKG");
    expect(html).toContain("No, stay on RAW MAT");
    expect(html.match(/type="radio"/g)).toHaveLength(2);
    expect(html.match(/Recommended</g)).toHaveLength(1);
    expect(html.indexOf("Recommended<")).toBeLessThan(html.indexOf("No, stay on RAW MAT"));
    // The reason sits inside the recommended option, before the next one.
    expect(html).toContain("Why the bot recommends it.</strong> 41499 is live in all three books");
    expect(html.indexOf("Why the bot recommends it.")).toBeLessThan(html.indexOf("No, stay on RAW MAT"));
    expect(html).toContain(">1</kbd>");
    expect(html).toContain("Posts to TASK-1418 as a comment from you");
  });

  it("offers only a typed answer when the question has no options, and starts with Send disabled", () => {
    const html = mine({ ...ROW.question, options: [], recommended: undefined, recommendationReason: undefined });
    expect(html).not.toContain('type="radio"');
    expect(html).toMatch(/<label[^>]*>Your answer<\/label>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Send answer<\/button>/);
    expect(html).toContain("Type your answer to send it.");
  });

  it("enables Send once there is a choice, and says what it will post", () => {
    const html = mine(ROW.question, { choice: 1, text: "ask Sam" });
    expect(html).not.toMatch(/disabled=""[^>]*>Send answer</);
    expect(html).toContain("Your answer: No, stay on RAW MAT, with a note");
    expect(html).toMatch(/checked=""[^>]*\/?>(<span class="ap-option-text"><span>)No, stay on RAW MAT/);
  });

  it("shows who reminded the viewer and when", () => {
    const html = mine({
      ...ROW.question,
      reminders: [{ by: "ricardo", at: "2026-10-22T09:00:00.000Z", commentId: "c_1" }],
    });
    expect(html).toContain("Ricardo Savelli Fuzito reminded you");
  });
});

describe("ColleagueQuestionSheet", () => {
  it("is read-only: no radios and no send, but Open task and Remind", () => {
    const html = colleague(ROW.question);
    expect(html).toContain('data-testid="colleague-question"');
    expect(html).not.toContain('type="radio"');
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("Send answer");
    expect(html).toContain("Only Ricardo Savelli Fuzito can answer this.</strong> You see it because you own Finance.");
    expect(html).toContain("The options Ricardo sees");
    expect(html.match(/Recommended</g)).toHaveLength(1);
    expect(html).toContain("Waiting on Ricardo for 20 h.");
    expect(html).toContain(">Open task</a>");
    expect(html).toMatch(/<button[^>]*>Remind Ricardo<\/button>/);
    expect(html).not.toMatch(/disabled=""[^>]*>Remind Ricardo</);
  });

  it("disables Remind as Reminder sent while the viewer's own last reminder is inside the cooldown", () => {
    const recent = new Date(NOW - 60 * 60 * 1000).toISOString();
    const html = colleague({
      ...ROW.question,
      reminders: [{ by: "vince", at: recent, commentId: "c_2" }],
    });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Reminder sent<\/button>/);
    expect(html).toContain("Reminder sent. Still waiting on Ricardo.");
    expect(html).toContain("Vince Alton reminded Ricardo");
  });

  it("counts only the viewer's own reminders, and only inside the window", () => {
    const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();
    const q = (by: string, msAgo: number): TaskQuestion => ({
      ...ROW.question,
      reminders: [{ by, at: at(msAgo), commentId: "c" }],
    });
    expect(remindCoolingDown(q("vince", 60_000), ME, NOW)).toBe(true);
    expect(remindCoolingDown(q("VINCE@petrasoap.com", 60_000), ME, NOW)).toBe(true);
    expect(remindCoolingDown(q("vince", QUESTION_REMIND_COOLDOWN_MS + 60_000), ME, NOW)).toBe(false);
    expect(remindCoolingDown(q("stephen", 60_000), ME, NOW)).toBe(false);
    expect(remindCoolingDown(ROW.question, ME, NOW)).toBe(false);
  });
});

describe("Approvals screen layout", () => {
  it("keeps questions and gates apart with their own tabs, before anything loads", () => {
    const html = renderToStaticMarkup(createElement(ApprovalsInboxView, { route: { screen: "approvals" }, nav: () => {} }));
    expect(html).toMatch(/aria-pressed="false"[^>]*>Questions</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Gates</);
    expect(html).toMatch(/aria-pressed="true"[^>]*>For me</);
    // Nothing renders a question or a gate until its list has loaded, so nothing flashes.
    expect(html).not.toContain("question-card");
    expect(html).not.toContain("approval-gate");
  });

  it("a deep link names the question's queue row", () => {
    expect(questionAnchorId(ROW.question.id)).toBe("question-q_0123456789abcdef");
  });
});

describe("canSendAnswer", () => {
  it("needs an option or typed text", () => {
    expect(canSendAnswer(undefined, "")).toBe(false);
    expect(canSendAnswer(undefined, "   ")).toBe(false);
    expect(canSendAnswer(0, "")).toBe(true);
    expect(canSendAnswer(undefined, "ask Sam")).toBe(true);
  });
});
