// TASK-3721 — the Approvals screen's rules, pinned without a DOM: what the
// queue lists and in what order, which row comes next after a decision, the
// keyboard map, the My projects filters, the headline words, the stats and the
// empty states. The screen renders what these return.
import { describe, expect, it } from "vitest";

import type { PendingApprovalRow } from "@/components/mc/approvals-inbox";
import {
  WAITING_ANYONE,
  WAITING_APPROVER,
  WAITING_YOU,
  ageLabel,
  approvalKeyAction,
  clearDraft,
  countWords,
  currentId,
  decidedSummary,
  decidedTodayCount,
  emptySheet,
  filterProjectItems,
  filterTab,
  forMeItems,
  forMeStats,
  groupByTask,
  hasDraft,
  headline,
  isTypingTarget,
  itemAge,
  nextAfterDecision,
  nextUpText,
  personRef,
  projectItems,
  projectOptionLabel,
  projectReasonText,
  projectStats,
  queueEmptyText,
  queueOrder,
  readDrafts,
  saveDraft,
  stepSelection,
  keyEffect,
  waitingOnPeople,
  waitingOnPerson,
  waitingOnViewer,
  gateBlockedForViewer,
  type KeyInput,
  type KeyState,
} from "@/components/mc/approvals-inbox.helpers";
import { viewerTokens } from "@/components/mc/needs-me";
import type { OpenQuestionRow } from "@/components/mc/questions-inbox";
import {
  HUMANS,
  type ApprovalGate,
  type ApprovalsProjectsResponse,
  type DecidedRow,
  type TaskQuestion,
} from "@/lib/mc-data";

const NOW = Date.parse("2026-10-22T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

const question = (id: string, at: string, extra: Partial<TaskQuestion> = {}): TaskQuestion => ({
  id,
  addressee: "vince",
  text: `Question ${id}?`,
  options: ["Yes", "No"],
  askedBy: "cos@petrasoap.com",
  askedByPrincipal: "sp",
  askedRuntime: "claude-code",
  askedAt: at,
  status: "open",
  ...extra,
});
const gate = (id: string, at: string, extra: Partial<ApprovalGate> = {}): ApprovalGate => ({
  id,
  reason: `Gate ${id}`,
  requestedBy: "agent:router",
  requestedRuntime: "swarm",
  requestedAt: at,
  status: "pending",
  ...extra,
});
const qRow = (taskId: string, q: TaskQuestion): OpenQuestionRow => ({ taskId, taskTitle: `Title ${taskId}`, stage: "backlog", question: q });
const gRow = (taskId: string, g: ApprovalGate): PendingApprovalRow => ({ taskId, taskTitle: `Title ${taskId}`, stage: "review", gate: g, evidence: null });

const ME = viewerTokens({ id: "vince", email: "vince@petrasoap.com" });

describe("grouping by task", () => {
  const items = forMeItems(
    [
      qRow("TASK-1", question("q_old", hoursAgo(50))),
      qRow("TASK-2", question("q_new", hoursAgo(1))),
      qRow("TASK-1", question("q_mid", hoursAgo(5))),
      qRow("TASK-3", question("q_tie_a", hoursAgo(10))),
      qRow("TASK-3", question("q_tie_b", hoursAgo(10))),
    ],
    [gRow("TASK-1", gate("apg_1", hoursAgo(3)))]
  );

  it("orders groups by their newest item and items newest first; equal times keep their order", () => {
    const groups = groupByTask(items);
    expect(groups.map((g) => g.taskId)).toEqual(["TASK-2", "TASK-1", "TASK-3"]);
    expect(groups[1].items.map((i) => i.id)).toEqual(["apg_1", "q_mid", "q_old"]);
    expect(groups[2].items.map((i) => i.id)).toEqual(["q_tie_a", "q_tie_b"]);
    expect(queueOrder(groups)).toEqual(["q_new", "apg_1", "q_mid", "q_old", "q_tie_a", "q_tie_b"]);
  });

  it("keeps the group's task title and splits questions from gates by tab", () => {
    expect(groupByTask(items)[0].taskTitle).toBe("Title TASK-2");
    expect(filterTab(items, "gates").map((i) => i.id)).toEqual(["apg_1"]);
    expect(filterTab(items, "questions")).toHaveLength(5);
    expect(filterTab(items, "all")).toHaveLength(6);
  });
});

describe("selection", () => {
  const order = ["a", "b", "c"];

  it("keeps the pick while it is listed, else the first row", () => {
    expect(currentId(order, "b")).toBe("b");
    expect(currentId(order, "gone")).toBe("a");
    expect(currentId(order, null)).toBe("a");
    expect(currentId([], "b")).toBeNull();
  });

  it("J/K step through the queue and wrap at both ends", () => {
    expect(stepSelection(order, "a", 1)).toBe("b");
    expect(stepSelection(order, "c", 1)).toBe("a");
    expect(stepSelection(order, "a", -1)).toBe("c");
    expect(stepSelection([], "a", 1)).toBeNull();
  });

  it("after a decision selects the row after it, else the one before, else nothing", () => {
    expect(nextAfterDecision(order, "b")).toBe("c");
    expect(nextAfterDecision(order, "c")).toBe("b");
    expect(nextAfterDecision(["only"], "only")).toBeNull();
    expect(nextAfterDecision(order, "gone")).toBe("a");
  });

  it("names the next item in the success notice", () => {
    const [next] = forMeItems([], [gRow("TASK-7", gate("apg_7", hoursAgo(1)))]);
    expect(nextUpText(next)).toBe("Next: a gate on TASK-7.");
    expect(nextUpText(null)).toBe("Nothing else is waiting here.");
  });
});

describe("keyboard map", () => {
  const key = (k: string, mods: Partial<KeyInput> = {}): KeyInput => ({
    key: k,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...mods,
  });

  it("maps 1–9, J/K and E when nothing is being typed", () => {
    expect(approvalKeyAction(key("1"), false)).toEqual({ type: "pick", index: 0 });
    expect(approvalKeyAction(key("9"), false)).toEqual({ type: "pick", index: 8 });
    expect(approvalKeyAction(key("0"), false)).toBeNull();
    expect(approvalKeyAction(key("j"), false)).toEqual({ type: "next" });
    expect(approvalKeyAction(key("J"), false)).toEqual({ type: "next" });
    expect(approvalKeyAction(key("k"), false)).toEqual({ type: "prev" });
    expect(approvalKeyAction(key("e"), false)).toEqual({ type: "open" });
    expect(approvalKeyAction(key("x"), false)).toBeNull();
  });

  it("sends with ⌘ or Ctrl+Enter, even while typing", () => {
    expect(approvalKeyAction(key("Enter", { metaKey: true }), true)).toEqual({ type: "submit" });
    expect(approvalKeyAction(key("Enter", { ctrlKey: true }), false)).toEqual({ type: "submit" });
    expect(approvalKeyAction(key("Enter"), false)).toBeNull();
  });

  it("ignores bare keys while typing and leaves modifier combos to the shell (⌘K, g chords)", () => {
    expect(approvalKeyAction(key("1"), true)).toBeNull();
    expect(approvalKeyAction(key("j"), true)).toBeNull();
    expect(approvalKeyAction(key("e"), true)).toBeNull();
    expect(approvalKeyAction(key("k", { metaKey: true }), false)).toBeNull();
    expect(approvalKeyAction(key("k", { ctrlKey: true }), false)).toBeNull();
    expect(approvalKeyAction(key("1", { altKey: true }), false)).toBeNull();
  });

  // Review B1/S1: a key acts only on the item the person can see, and a key
  // never approves a gate (21 Oct: 47 gates approved in a minute, LESSONS TASK-3567).
  const state = (over: Partial<KeyState> = {}): KeyState => ({
    kind: "question",
    mine: true,
    optionCount: 3,
    sheetVisible: true,
    busy: false,
    hasItems: true,
    ...over,
  });

  it("never approves a gate from the keyboard, visible or not", () => {
    expect(keyEffect({ type: "submit" }, state({ kind: "gate", mine: false }))).toBeNull();
    expect(keyEffect({ type: "submit" }, state({ kind: "gate", mine: false, sheetVisible: false }))).toBeNull();
  });

  it("sends, picks and opens only while the sheet is visible", () => {
    expect(keyEffect({ type: "submit" }, state())).toEqual({ type: "send" });
    expect(keyEffect({ type: "pick", index: 1 }, state())).toEqual({ type: "pick", index: 1 });
    expect(keyEffect({ type: "open" }, state({ kind: "gate", mine: false }))).toEqual({ type: "open" });
    const hidden = state({ sheetVisible: false });
    expect(keyEffect({ type: "submit" }, hidden)).toBeNull();
    expect(keyEffect({ type: "pick", index: 0 }, hidden)).toBeNull();
    expect(keyEffect({ type: "open" }, hidden)).toBeNull();
    // J/K still move through the queue while it is the visible pane.
    expect(keyEffect({ type: "next" }, hidden)).toEqual({ type: "move", delta: 1 });
    expect(keyEffect({ type: "prev" }, hidden)).toEqual({ type: "move", delta: -1 });
  });

  it("never sends or picks on a colleague's question, while busy, or past the last option", () => {
    expect(keyEffect({ type: "submit" }, state({ mine: false }))).toBeNull();
    expect(keyEffect({ type: "pick", index: 0 }, state({ mine: false }))).toBeNull();
    expect(keyEffect({ type: "submit" }, state({ busy: true }))).toBeNull();
    expect(keyEffect({ type: "pick", index: 3 }, state())).toBeNull();
    expect(keyEffect({ type: "next" }, state({ hasItems: false }))).toBeNull();
    expect(keyEffect({ type: "submit" }, state({ kind: "decided", mine: false }))).toBeNull();
  });

  it("treats text fields, selects and contenteditable as typing — not radios or buttons", () => {
    expect(isTypingTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTypingTarget({ tagName: "SELECT" })).toBe(true);
    expect(isTypingTarget({ tagName: "INPUT", type: "text" })).toBe(true);
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: "INPUT", type: "radio" })).toBe(false);
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("My projects: waiting on and project filters", () => {
  const data: ApprovalsProjectsResponse = {
    projects: [
      { id: "p_fin", name: "Finance", reasons: ["member"] },
      { id: "p_go", name: "PLX Portal Go-Live", reasons: ["owner", "assignee"] },
    ],
    questions: [
      { taskId: "TASK-1", taskTitle: "A", stage: "backlog", projectId: "p_fin", question: question("q_me", hoursAgo(2)) },
      {
        taskId: "TASK-2",
        taskTitle: "B",
        stage: "backlog",
        projectId: "p_go",
        question: question("q_ross", hoursAgo(30), { addressee: "ross" }),
      },
      {
        taskId: "TASK-3",
        taskTitle: "C",
        stage: "backlog",
        projectId: "p_fin",
        question: question("q_greg", hoursAgo(4), { addressee: "greg" }),
      },
    ],
    gates: [{ taskId: "TASK-4", taskTitle: "D", stage: "review", projectId: "p_go", gate: gate("apg_go", hoursAgo(3)), evidence: null }],
  };
  const items = projectItems(data, ME);
  const ids = (list: { id: string }[]) => list.map((i) => i.id).sort();

  it("marks only the viewer's own questions as theirs", () => {
    expect(items.filter((i) => i.kind === "question" && i.mine).map((i) => i.id)).toEqual(["q_me"]);
  });

  it("filters by project and by who it waits on", () => {
    expect(ids(filterProjectItems(items, "p_fin", WAITING_ANYONE))).toEqual(["q_greg", "q_me"]);
    expect(ids(filterProjectItems(items, "all", WAITING_YOU))).toEqual(["q_me"]);
    expect(ids(filterProjectItems(items, "all", WAITING_APPROVER))).toEqual(["apg_go"]);
    expect(ids(filterProjectItems(items, "all", waitingOnPerson("ross")))).toEqual(["q_ross"]);
    expect(ids(filterProjectItems(items, "p_fin", waitingOnPerson("ross")))).toEqual([]);
    expect(filterProjectItems(items, "all", WAITING_ANYONE)).toHaveLength(4);
  });

  it("offers each colleague in the rows by directory name — never the viewer, never a raw id", () => {
    const nameOf = (id: string) => personRef(id, (x) => HUMANS[x]).name;
    expect(waitingOnPeople(items, nameOf)).toEqual([
      { value: "person:greg", label: "Greg Mitchell" },
      { value: "person:ross", label: "Ross Pennino" },
    ]);
  });

  it("labels each project with why it is the viewer's", () => {
    expect(projectOptionLabel(data.projects[0])).toBe("Finance · member");
    expect(projectOptionLabel(data.projects[1])).toBe("PLX Portal Go-Live · owner, assigned a task");
    expect(projectReasonText(data.projects[0])).toBe("You see it because you are on the Finance member list.");
    expect(projectReasonText(data.projects[1])).toBe(
      "You see it because you own PLX Portal Go-Live and are assigned a task in PLX Portal Go-Live."
    );
  });

  it("counts on you, on colleagues, gates and the oldest", () => {
    expect(projectStats(items, NOW)).toEqual([
      { label: "On you", value: "1" },
      { label: "On colleagues", value: "2" },
      { label: "Gates", value: "1" },
      { label: "Oldest", value: "1 d", warn: false },
    ]);
  });
});

describe("people", () => {
  it("shows a directory id or email as the person's name, and an outsider as their email", () => {
    const lookup = (x: string) => HUMANS[x] ?? Object.values(HUMANS).find((h) => h.email === x);
    expect(personRef("ricardo", lookup)).toEqual({ name: "Ricardo Savelli Fuzito", short: "Ricardo", init: "RS" });
    expect(personRef("ross@petrasoap.com", lookup).name).toBe("Ross Pennino");
    expect(personRef("sam@example.com", lookup)).toEqual({ name: "sam@example.com", short: "sam@example.com", init: "SA" });
  });
});

describe("headline count words", () => {
  it("spells the count, singular for one, digits past twenty", () => {
    expect(countWords(0)).toBe("Nothing");
    expect(countWords(1)).toBe("One decision");
    expect(countWords(8)).toBe("Eight decisions");
    expect(countWords(20)).toBe("Twenty decisions");
    expect(countWords(21)).toBe("21 decisions");
  });

  it("puts the accent word in its own part, per scope", () => {
    expect(headline(8, "me")).toEqual({ lead: "Eight decisions", em: "waiting", tail: "on you." });
    expect(headline(0, "me")).toEqual({ lead: "Nothing", em: "waiting", tail: "on you." });
    expect(headline(3, "projects")).toEqual({ lead: "Three decisions", em: "open", tail: "in your projects." });
    expect(headline(1, "projects", "Finance")).toEqual({ lead: "One decision", em: "open", tail: "in Finance." });
    expect(headline(null, "me").lead).toBe("Decisions");
  });
});

describe("waiting on the viewer (review S3)", () => {
  it("leaves out gates the viewer raised, as Home's What needs me does", () => {
    const items = forMeItems(
      [qRow("TASK-1", question("q1", hoursAgo(1)))],
      [
        gRow("TASK-2", gate("g-mine", hoursAgo(2), { requestedBy: "Vince@PetraSoap.com" })),
        gRow("TASK-3", gate("g-other", hoursAgo(3))),
      ]
    );
    expect(waitingOnViewer(items, ME).map((i) => i.id)).toEqual(["q1", "g-other"]);
    expect(waitingOnViewer(items, new Set<string>()).map((i) => i.id)).toEqual(["q1", "g-mine", "g-other"]);
  });

  // TASK-4168 (Vince, 2026-10-31): the owner decides a gate an agent raised in the owner's name.
  it("keeps the owner's own gate when an agent raised it, and only then", () => {
    const agentRaised = gate("g-agent", hoursAgo(2), { requestedBy: "vince@petrasoap.com", requestedByPrincipal: "sp_mcp_cursor" });
    const noPrincipal = gate("g-bare", hoursAgo(3), { requestedBy: "vince@petrasoap.com" });
    const items = forMeItems([], [gRow("TASK-2", agentRaised), gRow("TASK-3", noPrincipal)]);
    expect(waitingOnViewer(items, ME, true).map((i) => i.id)).toEqual(["g-agent"]);
    expect(waitingOnViewer(items, ME, false).map((i) => i.id)).toEqual([]);
    expect(gateBlockedForViewer(agentRaised, ME, true)).toBe(false);
    expect(gateBlockedForViewer(agentRaised, ME, false)).toBe(true);
    expect(gateBlockedForViewer(noPrincipal, ME, true)).toBe(true);
    expect(gateBlockedForViewer(gate("g-x", hoursAgo(1)), ME, false)).toBe(false);
  });
});

describe("ages and For me stats", () => {
  it("reads minutes, hours, days, and amber from two days", () => {
    expect(ageLabel(30_000)).toBe("1 min");
    expect(ageLabel(45 * 60_000)).toBe("45 min");
    expect(ageLabel(18 * 3_600_000)).toBe("18 h");
    expect(ageLabel(3 * 86_400_000)).toBe("3 d");
    expect(itemAge(hoursAgo(47), NOW)).toEqual({ label: "1 d", text: "1 d", stale: false });
    expect(itemAge(hoursAgo(48), NOW)).toEqual({ label: "2 d", text: "Waiting 2 d", stale: true });
  });

  it("counts questions and gates, the oldest (amber when stale) and decided today", () => {
    const items = forMeItems([qRow("TASK-1", question("q1", hoursAgo(60)))], [gRow("TASK-2", gate("g1", hoursAgo(1)))]);
    expect(forMeStats(items, 4, NOW)).toEqual([
      { label: "Questions", value: "1" },
      { label: "Gates", value: "1" },
      { label: "Oldest", value: "2 d", warn: true },
      { label: "Decided today", value: "4" },
    ]);
    // Until the Decided tab loads its list, the count is unknown, not zero, so the stat is left out
    // (an empty field drops its row; never a "—" placeholder).
    expect(forMeStats([], null, NOW)).toEqual([
      { label: "Questions", value: "0" },
      { label: "Gates", value: "0" },
    ]);
  });

  it("decided today means the viewer's local calendar day", () => {
    const now = new Date(2026, 9, 22, 15, 0);
    const row = (at: Date): DecidedRow => ({
      kind: "gate",
      taskId: "TASK-1",
      taskTitle: "A",
      decidedAt: at.toISOString(),
      gate: gate("g", at.toISOString(), { status: "approved" }),
    });
    expect(decidedTodayCount([row(new Date(2026, 9, 22, 0, 5)), row(new Date(2026, 9, 21, 23, 55))], now)).toBe(1);
  });
});

describe("decided records and empty states", () => {
  it("summarizes an answer, with the note only beside a chosen option", () => {
    const answered = question("q", hoursAgo(5), {
      status: "answered",
      answer: { choice: 1, text: "ask Sam", answeredBy: "vince", answeredAt: hoursAgo(1), commentId: "c" },
    });
    expect(decidedSummary({ kind: "question", taskId: "TASK-1", taskTitle: "A", decidedAt: hoursAgo(1), question: answered })).toEqual({
      status: "Answered",
      label: "Your answer",
      answer: "No",
      note: "ask Sam",
      recorded: "Posted to TASK-1 as a comment from you.",
    });
    const rejected = decidedSummary({
      kind: "gate",
      taskId: "TASK-2",
      taskTitle: "B",
      decidedAt: hoursAgo(1),
      gate: gate("g", hoursAgo(2), { status: "rejected", note: "not yet" }),
    });
    expect([rejected.status, rejected.answer, rejected.note]).toEqual(["Rejected", "Rejected", "not yet"]);
  });

  it("says All clear only when the scope has nothing open", () => {
    expect(emptySheet({ scope: "me", tab: "all", openCount: 0, filtered: false })).toMatchObject({ clear: true, action: "decided" });
    expect(emptySheet({ scope: "me", tab: "questions", openCount: 0, filtered: false }).clear).toBe(true);
    expect(emptySheet({ scope: "me", tab: "questions", openCount: 2, filtered: false })).toMatchObject({
      clear: false,
      title: "No open questions.",
      action: "all",
    });
    expect(emptySheet({ scope: "projects", tab: "all", openCount: 3, filtered: true })).toMatchObject({
      title: "Nothing matches these filters.",
      action: "reset",
    });
    expect(emptySheet({ scope: "me", tab: "decided", openCount: 3, filtered: false }).title).toBe("Nothing decided yet.");
    // Review S2: an unknown count (a For me list failed or is loading) is never "All clear".
    expect(emptySheet({ scope: "me", tab: "questions", openCount: null, filtered: false })).toMatchObject({
      clear: false,
      title: "No open questions.",
    });
    expect(emptySheet({ scope: "me", tab: "gates", openCount: null, filtered: false }).clear).toBe(false);
    expect(queueEmptyText("all", false)).toBe("No pending approvals.");
    expect(queueEmptyText("gates", false)).toBe("No open gates.");
  });
});

describe("drafts", () => {
  it("survive until cleared, and an empty draft is no draft", () => {
    saveDraft("q_draft", { choice: 0, text: "" });
    expect(readDrafts().q_draft).toEqual({ choice: 0, text: "" });
    expect(hasDraft(readDrafts().q_draft)).toBe(true);
    saveDraft("q_draft", { text: "" });
    expect(readDrafts().q_draft).toBeUndefined();
    saveDraft("apg_draft", { text: "  " });
    expect(hasDraft(readDrafts().apg_draft)).toBe(false);
    clearDraft("apg_draft");
    expect(readDrafts().apg_draft).toBeUndefined();
  });
});
