// Approvals screen model (TASK-3721): the pure rules behind the decision desk.
// The screen (approvals-inbox.tsx) loads rows and renders; everything it
// decides — what is in the queue, in what order, what the headline says, which
// key does what, who may remind — is here, so tests/approvals-inbox-*.test.ts
// can pin it without a DOM. No React, no store reads, no clock: callers pass
// the viewer's tokens and `nowMs`.
import {
  QUESTION_REMIND_COOLDOWN_MS,
  type ApprovalEvidenceRef,
  type ApprovalGate,
  type ApprovalsProjectsResponse,
  type DecidedRow,
  type Human,
  type MyProject,
  type MyProjectReason,
  type TaskQuestion,
  type TaskQuestionReminder,
} from "@/lib/mc-data";

import type { PendingApprovalRow } from "./approvals-inbox";
import type { OpenQuestionRow } from "./questions-inbox";

// ─── Loads ───────────────────────────────────────────────────────────────────

/** One source's load. `idle` = not asked for yet (My projects and Decided load on first open). */
export type SourceLoad<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

export type QueueView = "loading" | "error" | "empty" | "list";

/**
 * Exactly one state for the sources a tab needs. A failed load is its own
 * state, never an empty list: with no rows and any failure the view is
 * "error", so the screen never says "All clear" over a load it could not make.
 */
export function queueView(loads: readonly SourceLoad<unknown>[], rowCount: number): QueueView {
  if (loads.some((l) => l.status === "loading" || l.status === "idle")) return "loading";
  if (rowCount > 0) return "list";
  return loads.some((l) => l.status === "error") ? "error" : "empty";
}

/** The distinct failure messages among these loads, in order. */
export function loadErrors(loads: readonly SourceLoad<unknown>[]): string[] {
  const out: string[] = [];
  for (const l of loads) if (l.status === "error" && !out.includes(l.message)) out.push(l.message);
  return out;
}

// ─── Queue items ─────────────────────────────────────────────────────────────

export type ApprovalScopeKey = "me" | "projects";
export type ApprovalTab = "all" | "questions" | "gates" | "decided";

interface ItemBase {
  /** q_* or apg_* id. */
  id: string;
  taskId: string;
  taskTitle: string;
  /** Stage key; null on a decided row (the record does not carry it). */
  stage: string | null;
  /** Set on My projects rows only. */
  projectId: string | null;
  /** ISO-8601: asked, raised or decided. Orders the queue. */
  at: string;
}

export type QueueItem =
  | (ItemBase & { kind: "question"; question: TaskQuestion; mine: boolean })
  | (ItemBase & { kind: "gate"; gate: ApprovalGate; evidence: ApprovalEvidenceRef | null })
  | (ItemBase & { kind: "decided"; record: DecidedRow });

/** For me: GET /api/questions (always the viewer's) plus GET /api/approvals. */
export function forMeItems(questions: readonly OpenQuestionRow[], gates: readonly PendingApprovalRow[]): QueueItem[] {
  return [
    ...questions.map(
      (r): QueueItem => ({
        kind: "question",
        id: r.question.id,
        taskId: r.taskId,
        taskTitle: r.taskTitle,
        stage: r.stage,
        projectId: null,
        at: r.question.askedAt,
        question: r.question,
        mine: true,
      })
    ),
    ...gates.map(
      (r): QueueItem => ({
        kind: "gate",
        id: r.gate.id,
        taskId: r.taskId,
        taskTitle: r.taskTitle,
        stage: r.stage,
        projectId: null,
        at: r.gate.requestedAt,
        gate: r.gate,
        evidence: r.evidence ?? null,
      })
    ),
  ];
}

/** My projects: every open question (any addressee) and gate in the viewer's projects. */
export function projectItems(data: ApprovalsProjectsResponse, me: ReadonlySet<string>): QueueItem[] {
  return [
    ...data.questions.map(
      (r): QueueItem => ({
        kind: "question",
        id: r.question.id,
        taskId: r.taskId,
        taskTitle: r.taskTitle,
        stage: r.stage,
        projectId: r.projectId,
        at: r.question.askedAt,
        question: r.question,
        mine: isViewer(r.question.addressee, me),
      })
    ),
    ...data.gates.map(
      (r): QueueItem => ({
        kind: "gate",
        id: r.gate.id,
        taskId: r.taskId,
        taskTitle: r.taskTitle,
        stage: r.stage,
        projectId: r.projectId,
        at: r.gate.requestedAt,
        gate: r.gate,
        evidence: r.evidence ?? null,
      })
    ),
  ];
}

export function decidedItems(rows: readonly DecidedRow[]): QueueItem[] {
  return rows.map(
    (r): QueueItem => ({
      kind: "decided",
      id: r.kind === "question" ? r.question.id : r.gate.id,
      taskId: r.taskId,
      taskTitle: r.taskTitle,
      stage: null,
      projectId: null,
      at: r.decidedAt,
      record: r,
    })
  );
}

/** The one-line ask a row shows: the question, the gate's reason, or what was decided. */
export function itemText(item: QueueItem): string {
  if (item.kind === "question") return item.question.text;
  if (item.kind === "gate") return item.gate.reason;
  return item.record.kind === "question" ? item.record.question.text : item.record.gate.reason;
}

const ts = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
};

// ─── Grouping and order ──────────────────────────────────────────────────────

export interface TaskGroup {
  taskId: string;
  taskTitle: string;
  projectId: string | null;
  items: QueueItem[];
}

/**
 * Newest first, grouped by task. A group sits where its newest item would, and
 * keeps its own items newest first; equal times keep the input order.
 */
export function groupByTask(items: readonly QueueItem[]): TaskGroup[] {
  const sorted = items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => ts(b.item.at) - ts(a.item.at) || a.i - b.i)
    .map(({ item }) => item);
  const groups: TaskGroup[] = [];
  const byTask = new Map<string, TaskGroup>();
  for (const item of sorted) {
    let group = byTask.get(item.taskId);
    if (!group) {
      group = { taskId: item.taskId, taskTitle: item.taskTitle, projectId: item.projectId, items: [] };
      byTask.set(item.taskId, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

/** The ids in the order the queue shows them (N of M, J/K, next after a decision). */
export function queueOrder(groups: readonly TaskGroup[]): string[] {
  return groups.flatMap((g) => g.items.map((item) => item.id));
}

/** The picked id while it is still listed, else the first row. */
export function currentId(order: readonly string[], selected: string | null): string | null {
  return selected !== null && order.includes(selected) ? selected : (order[0] ?? null);
}

/** J/K and prev/next: one step through the queue, wrapping at both ends. */
export function stepSelection(order: readonly string[], id: string | null, delta: 1 | -1): string | null {
  if (order.length === 0) return null;
  const i = id === null ? -1 : order.indexOf(id);
  if (i < 0) return order[0];
  return order[(i + delta + order.length) % order.length];
}

/** After a decision removes `id`: the row after it, else the one before, else nothing. */
export function nextAfterDecision(order: readonly string[], id: string): string | null {
  const i = order.indexOf(id);
  if (i < 0) return order[0] ?? null;
  return order[i + 1] ?? order[i - 1] ?? null;
}

// ─── Filters ─────────────────────────────────────────────────────────────────

export function filterTab(items: readonly QueueItem[], tab: Exclude<ApprovalTab, "decided">): QueueItem[] {
  if (tab === "questions") return items.filter((i) => i.kind === "question");
  if (tab === "gates") return items.filter((i) => i.kind === "gate");
  return [...items];
}

/** "anyone", "you", "approver" (gates), or `person:<addressee>`. */
export type WaitingOn = string;
export const WAITING_ANYONE = "anyone";
export const WAITING_YOU = "you";
export const WAITING_APPROVER = "approver";
export const waitingOnPerson = (addressee: string): WaitingOn => `person:${addressee}`;

/** Who a My projects row waits on, in the Waiting on filter's terms. */
export function waitingOnOf(item: QueueItem): WaitingOn {
  if (item.kind === "gate") return WAITING_APPROVER;
  if (item.kind === "question") return item.mine ? WAITING_YOU : waitingOnPerson(item.question.addressee);
  return WAITING_ANYONE;
}

export function filterProjectItems(items: readonly QueueItem[], projectId: string, waitingOn: WaitingOn): QueueItem[] {
  return items.filter(
    (item) =>
      (projectId === "all" || item.projectId === projectId) &&
      (waitingOn === WAITING_ANYONE || waitingOnOf(item) === waitingOn)
  );
}

/** Colleagues the open questions wait on (never the viewer), by name. */
export function waitingOnPeople(
  items: readonly QueueItem[],
  nameOf: (addressee: string) => string
): { value: WaitingOn; label: string }[] {
  const seen = new Map<string, string>();
  for (const item of items) {
    if (item.kind !== "question" || item.mine || seen.has(item.question.addressee)) continue;
    seen.set(item.question.addressee, nameOf(item.question.addressee));
  }
  return [...seen]
    .map(([addressee, label]) => ({ value: waitingOnPerson(addressee), label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

const REASON_SHORT: Record<MyProjectReason, string> = {
  member: "member",
  owner: "owner",
  assignee: "assigned a task",
};

/** Project filter option: "PLX Portal Go-Live · owner". */
export function projectOptionLabel(project: MyProject): string {
  return `${project.name} · ${project.reasons.map((r) => REASON_SHORT[r]).join(", ")}`;
}

/** Why a colleague's question is on the viewer's screen: "You see it because you own Finance." */
export function projectReasonText(project: MyProject | undefined): string {
  if (!project || project.reasons.length === 0) return "You see it because it is in one of your projects.";
  const phrase: Record<MyProjectReason, string> = {
    member: `are on the ${project.name} member list`,
    owner: `own ${project.name}`,
    assignee: `are assigned a task in ${project.name}`,
  };
  return `You see it because you ${project.reasons.map((r) => phrase[r]).join(" and ")}.`;
}

// ─── Viewer ──────────────────────────────────────────────────────────────────

/** True when an id, email or audit label names the viewer (any case). */
export function isViewer(label: string | null | undefined, me: ReadonlySet<string>): boolean {
  const key = label?.trim().toLowerCase();
  return !!key && me.has(key);
}

/** Separation of duties: the viewer raised this gate, so someone else decides it. */
export function raisedByViewer(gate: Pick<ApprovalGate, "requestedBy">, me: ReadonlySet<string>): boolean {
  return isViewer(gate.requestedBy, me);
}

/** The viewer's newest reminder on this question, if any. */
export function myLatestReminder(question: TaskQuestion, me: ReadonlySet<string>): TaskQuestionReminder | null {
  let latest: TaskQuestionReminder | null = null;
  for (const r of question.reminders ?? []) {
    if (isViewer(r.by, me) && (!latest || ts(r.at) > ts(latest.at))) latest = r;
  }
  return latest;
}

/** One reminder per person per question per QUESTION_REMIND_COOLDOWN_MS (the server checks it too). */
export function remindCoolingDown(question: TaskQuestion, me: ReadonlySet<string>, nowMs: number): boolean {
  const latest = myLatestReminder(question, me);
  return !!latest && nowMs - ts(latest.at) < QUESTION_REMIND_COOLDOWN_MS;
}

export interface PersonRef {
  name: string;
  /** First name, or the whole label for someone outside the directory. */
  short: string;
  init: string;
}

/** A directory id or email as a person: the directory's name, never a raw id when it is listed. */
export function personRef(idOrEmail: string, lookup: (idOrEmail: string) => Human | undefined): PersonRef {
  const human = lookup(idOrEmail);
  if (human) return { name: human.name, short: human.name.split(" ")[0] || human.name, init: human.init };
  const label = idOrEmail.trim();
  const letters = label.replace(/@.*$/, "").replace(/[^a-z0-9]/gi, "");
  return { name: label, short: label, init: (letters.slice(0, 2) || "?").toUpperCase() };
}

// ─── Header ──────────────────────────────────────────────────────────────────

const WORDS = [
  "Nothing", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen", "Twenty",
];

/** 0 → "Nothing", 8 → "Eight decisions", 1 → "One decision", 21 → "21 decisions". */
export function countWords(n: number): string {
  if (n <= 0) return WORDS[0];
  const word = WORDS[n] ?? String(n);
  return `${word} ${n === 1 ? "decision" : "decisions"}`;
}

/** The h1 in three parts; `em` is the one italic accent word. Null count = still loading. */
export function headline(
  n: number | null,
  scope: ApprovalScopeKey,
  projectName?: string | null
): { lead: string; em: string; tail: string } {
  const lead = n === null ? "Decisions" : countWords(n);
  if (scope === "me") return { lead, em: "waiting", tail: "on you." };
  return { lead, em: "open", tail: projectName ? `in ${projectName}.` : "in your projects." };
}

// ─── Age ─────────────────────────────────────────────────────────────────────

/** Two days or older reads amber. */
export const STALE_MS = 2 * 24 * 60 * 60 * 1000;

/** "45 min", "18 h", "3 d". */
export function ageLabel(ms: number): string {
  const minutes = Math.floor(Math.max(ms, 0) / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

/** A row's age: `text` is "18 h", or "Waiting 3 d" once stale; `label` never has the prefix. */
export function itemAge(at: string, nowMs: number): { label: string; text: string; stale: boolean } {
  const ms = nowMs - ts(at);
  const stale = ms >= STALE_MS;
  const label = ageLabel(ms);
  return { label, text: stale ? `Waiting ${label}` : label, stale };
}

// ─── Stats ───────────────────────────────────────────────────────────────────

export interface Stat {
  label: string;
  value: string;
  warn?: boolean;
}

function oldestStat(items: readonly QueueItem[], nowMs: number): Stat[] {
  const open = items.filter((i) => i.kind !== "decided");
  if (open.length === 0) return [];
  const oldest = open.reduce((a, b) => (ts(b.at) < ts(a.at) ? b : a));
  const ms = nowMs - ts(oldest.at);
  return [{ label: "Oldest", value: ageLabel(ms), warn: ms >= STALE_MS }];
}

/** Decisions made on `now`'s local calendar day. */
export function decidedTodayCount(rows: readonly DecidedRow[], now: Date): number {
  const day = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const today = day(now);
  return rows.filter((r) => day(new Date(ts(r.decidedAt))) === today).length;
}

/** For me: Questions, Gates, Oldest, Decided today ("—" until the decided list loads). */
export function forMeStats(items: readonly QueueItem[], decidedToday: number | null, nowMs: number): Stat[] {
  return [
    { label: "Questions", value: String(items.filter((i) => i.kind === "question").length) },
    { label: "Gates", value: String(items.filter((i) => i.kind === "gate").length) },
    ...oldestStat(items, nowMs),
    { label: "Decided today", value: decidedToday === null ? "—" : String(decidedToday) },
  ];
}

/** My projects: On you, On colleagues, Gates, Oldest. */
export function projectStats(items: readonly QueueItem[], nowMs: number): Stat[] {
  const questions = items.filter((i): i is Extract<QueueItem, { kind: "question" }> => i.kind === "question");
  return [
    { label: "On you", value: String(questions.filter((q) => q.mine).length) },
    { label: "On colleagues", value: String(questions.filter((q) => !q.mine).length) },
    { label: "Gates", value: String(items.filter((i) => i.kind === "gate").length) },
    ...oldestStat(items, nowMs),
  ];
}

// ─── Deciding ────────────────────────────────────────────────────────────────

/** The action bar's summary of what Send will post. */
export function answerSummary(options: readonly string[], choice: number | undefined, text: string): string {
  const note = text.trim();
  if (choice !== undefined && options[choice] !== undefined) {
    return `Your answer: ${options[choice]}${note ? ", with a note" : ""}`;
  }
  if (note) return "Your answer: the text you typed";
  return options.length > 0 ? "Pick an option, or type your own answer." : "Type your answer to send it.";
}

export const REJECT_NOTE_REQUIRED = "Add a note to reject. The agent reads it to decide what to do next.";

/** Reject needs a note (client rule; the server accepts either). */
export function rejectNoteError(note: string): string | null {
  return note.trim() ? null : REJECT_NOTE_REQUIRED;
}

/** The success notice's tail: what the sheet moved to. */
export function nextUpText(next: QueueItem | null): string {
  if (!next) return "Nothing else is waiting here.";
  const what = next.kind === "gate" ? "a gate" : next.kind === "question" ? "a question" : "a decision";
  return `Next: ${what} on ${next.taskId}.`;
}

/** A reminder answer from the server, put into the My projects rows at once. */
export function replaceProjectQuestion(
  data: ApprovalsProjectsResponse,
  taskId: string,
  question: TaskQuestion
): ApprovalsProjectsResponse {
  return {
    ...data,
    questions: data.questions.map((r) =>
      r.taskId === taskId && r.question.id === question.id ? { ...r, question } : r
    ),
  };
}

/** A decided row as the read-only record shows it. */
export function decidedSummary(record: DecidedRow): {
  status: "Answered" | "Approved" | "Rejected";
  label: string;
  answer: string;
  note: string | null;
  recorded: string;
} {
  if (record.kind === "question") {
    const a = record.question.answer;
    const choice = a?.choice;
    const picked = choice !== undefined ? (record.question.options[choice] ?? `Option ${choice + 1}`) : null;
    const text = a?.text?.trim() || null;
    return {
      status: "Answered",
      label: "Your answer",
      answer: picked ?? text ?? "No answer recorded",
      note: picked ? text : null,
      recorded: `Posted to ${record.taskId} as a comment from you.`,
    };
  }
  const rejected = record.gate.status === "rejected";
  return {
    status: rejected ? "Rejected" : "Approved",
    label: "Decision",
    answer: rejected ? "Rejected" : "Approved",
    note: record.gate.note?.trim() || null,
    recorded: "Recorded on the gate.",
  };
}

/** The queue's one line when it has no rows. */
export function queueEmptyText(tab: ApprovalTab, filtered: boolean): string {
  if (tab === "decided") return "Nothing decided yet.";
  if (filtered) return "Nothing matches these filters.";
  if (tab === "questions") return "No open questions.";
  if (tab === "gates") return "No open gates.";
  return "No pending approvals.";
}

export type EmptyAction = "decided" | "all" | "reset" | null;

/**
 * What the sheet says when nothing is selected. "All clear" only when the
 * scope has nothing open at all; a tab or filter with nothing gets its own
 * message and a way back to everything open.
 */
export function emptySheet(input: {
  scope: ApprovalScopeKey;
  tab: ApprovalTab;
  /** Open items in the scope before the tab (and, on My projects, the filters) apply. */
  openCount: number;
  filtered: boolean;
}): { clear: boolean; title: string; body: string; action: EmptyAction } {
  const { scope, tab, openCount, filtered } = input;
  if (tab === "decided") {
    return {
      clear: false,
      title: "Nothing decided yet.",
      body: "Answers and gate decisions you make land here, newest first.",
      action: null,
    };
  }
  if (openCount === 0) {
    return {
      clear: true,
      title: "All clear.",
      body:
        scope === "me"
          ? "Bots ask here when they need a person, and agents raise a gate when a run needs a human decision."
          : "Nobody in these projects is waiting on a decision right now.",
      action: "decided",
    };
  }
  if (filtered) {
    return {
      clear: false,
      title: "Nothing matches these filters.",
      body: "Try another project or person, or show everything open.",
      action: "reset",
    };
  }
  if (tab === "questions") {
    return {
      clear: false,
      title: "No open questions.",
      body: "Gates may still need you. Bots ask here when they need a person.",
      action: "all",
    };
  }
  return {
    clear: false,
    title: "No open gates.",
    body: "Questions may still need you. Agents raise a gate here when a run needs a human decision.",
    action: "all",
  };
}

/** A row's meta line after any "On <name>" prefix: runtime, then options or risk. */
export function rowMeta(item: QueueItem): string {
  if (item.kind === "question") {
    const n = item.question.options.length;
    return [item.question.askedRuntime, n > 0 ? `${n} ${n === 1 ? "option" : "options"}` : "typed answer"]
      .filter(Boolean)
      .join(" · ");
  }
  if (item.kind === "gate") {
    const risk = item.gate.proposal?.risk;
    return [item.gate.requestedRuntime, risk ? `risk ${risk}` : null].filter(Boolean).join(" · ");
  }
  return new Date(ts(item.at)).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// ─── Keyboard ────────────────────────────────────────────────────────────────

export type KeyAction =
  | { type: "pick"; index: number }
  | { type: "next" }
  | { type: "prev" }
  | { type: "submit" }
  | { type: "open" };

export interface KeyInput {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

/**
 * The screen's keys: 1–9 pick an option, J/K next/previous, E open the task,
 * ⌘/Ctrl+Enter send or approve. Bare keys never fire while typing; other
 * modifier combos are left to the shell (⌘K, `g` chords) and the browser.
 */
export function approvalKeyAction(input: KeyInput, typing: boolean): KeyAction | null {
  if (input.key === "Enter" && (input.metaKey || input.ctrlKey) && !input.altKey) return { type: "submit" };
  if (typing || input.metaKey || input.ctrlKey || input.altKey) return null;
  if (/^[1-9]$/.test(input.key)) return { type: "pick", index: Number(input.key) - 1 };
  const key = input.key.toLowerCase();
  if (key === "j") return { type: "next" };
  if (key === "k") return { type: "prev" };
  if (key === "e") return { type: "open" };
  return null;
}

const NON_TEXT_INPUTS = new Set(["radio", "checkbox", "button", "submit", "reset", "range", "color", "file", "image"]);

/** A text field, select or contenteditable has the keyboard (a radio or button does not). */
export function isTypingTarget(
  target: { tagName?: string; type?: string; isContentEditable?: boolean } | null | undefined
): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName?.toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  return tag === "INPUT" && !NON_TEXT_INPUTS.has((target.type ?? "text").toLowerCase());
}

// ─── Drafts ──────────────────────────────────────────────────────────────────

/** An unsent answer (choice and/or text) or gate note. */
export interface Draft {
  choice?: number;
  text: string;
}

// Unsent drafts survive the screen unmounting (opening a task below 1600px
// replaces the screen) until they are sent.
const drafts = new Map<string, Draft>();

export function readDrafts(): Record<string, Draft> {
  return Object.fromEntries(drafts);
}

export function saveDraft(id: string, draft: Draft): void {
  if (draft.choice === undefined && draft.text === "") drafts.delete(id);
  else drafts.set(id, draft);
}

export function clearDraft(id: string): void {
  drafts.delete(id);
}

/** "· Draft kept" shows when a row has an unsent choice or text. */
export function hasDraft(draft: Draft | undefined): boolean {
  return !!draft && (draft.choice !== undefined || draft.text.trim() !== "");
}
