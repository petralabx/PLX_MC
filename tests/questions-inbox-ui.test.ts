// TASK-3567 — a question card on the Approvals screen shows the linked task,
// the question, every option with the bot's recommendation marked, why it is
// recommended, and a box for a typed answer. No DOM environment (vitest runs in
// Node), so the card is rendered with renderToStaticMarkup.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { canSendAnswer, QuestionCard, questionAnchorId, type OpenQuestionRow } from "@/components/mc/questions-inbox";

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
  },
};

const card = (row: OpenQuestionRow, focused = false) =>
  renderToStaticMarkup(
    createElement(QuestionCard, { row, nav: () => {}, focused, busy: false, onSend: () => {} })
  );

describe("QuestionCard", () => {
  it("shows the task, the question, each option and marks only the recommended one", () => {
    const html = card(ROW);
    expect(html).toContain("TASK-1418 · Posting setup in the new books");
    expect(html).toContain("Do packaging items get their own posting group?");
    expect(html).toContain("Yes, MFGPKG");
    expect(html).toContain("No, stay on RAW MAT");
    expect(html.match(/Recommended</g)).toHaveLength(1);
    expect(html.indexOf("Recommended<")).toBeLessThan(html.indexOf("No, stay on RAW MAT"));
    expect(html).toContain("Why recommended: 41499 is live in all three books");
    expect(html).toContain("asked by cos@petrasoap.com via grok");
  });

  it("carries the anchor id and highlights the linked question", () => {
    expect(card(ROW)).toContain(`id="${questionAnchorId(ROW.question.id)}"`);
    expect(card(ROW, true)).toContain("aq-focus");
    expect(card(ROW, false)).not.toContain("aq-focus");
  });

  it("offers only a typed answer when the question has no options, and starts with Send disabled", () => {
    const html = card({ ...ROW, question: { ...ROW.question, options: [], recommended: undefined, recommendationReason: undefined } });
    expect(html).not.toContain('type="radio"');
    expect(html).toContain('aria-label="Your answer"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Send answer<\/button>/);
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
