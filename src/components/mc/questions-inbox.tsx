"use client";

// Questions for you (TASK-3567) — the top of the Approvals screen. Lists only
// the open questions a bot addressed to the signed-in person (GET
// /api/questions filters on the server). The person picks an option or types
// an answer; POST /api/questions/answer stores it and posts it to the task as
// a comment. Only the addressee can answer — the server checks it.

import { useCallback, useEffect, useRef, useState } from "react";

import { api, ApiClientError } from "@/lib/api";
import type { TaskQuestion } from "@/lib/mc-data";
import { refreshState } from "@/lib/mc-data/store";
import { isPlainLeftClick, navHref } from "@/components/mc/nav-model";
import type { Nav } from "@/components/mc/route";

export interface OpenQuestionRow {
  taskId: string;
  taskTitle: string;
  stage: string;
  question: TaskQuestion;
}

export function fetchOpenQuestions(): Promise<OpenQuestionRow[]> {
  return api<{ questions: OpenQuestionRow[] }>("/questions").then((data) => data.questions);
}

/** A send needs an option, or typed text when there is no option. */
export function canSendAnswer(choice: number | undefined, text: string): boolean {
  return choice !== undefined || text.trim().length > 0;
}

/** DOM id of a question card; the `question` route param scrolls to it. */
export function questionAnchorId(questionId: string): string {
  return `question-${questionId}`;
}

// Unsent answers survive the card unmounting (opening the task below 1600px
// replaces the screen), until they are sent.
interface Draft {
  choice?: number;
  text: string;
}
const drafts = new Map<string, Draft>();

export type QuestionsLoad =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; rows: OpenQuestionRow[] };

export function QuestionCard({
  row,
  nav,
  focused,
  busy,
  onSend,
}: {
  row: OpenQuestionRow;
  nav: Nav;
  focused: boolean;
  busy: boolean;
  onSend: (choice: number | undefined, text: string) => void;
}) {
  const q = row.question;
  const anchor = questionAnchorId(q.id);
  const [choice, setChoiceState] = useState<number | undefined>(() => drafts.get(q.id)?.choice);
  const [text, setTextState] = useState(() => drafts.get(q.id)?.text ?? "");
  const firstRadio = useRef<HTMLInputElement>(null);
  const hasOptions = q.options.length > 0;
  const setChoice = (next: number | undefined) => {
    setChoiceState(next);
    drafts.set(q.id, { choice: next, text });
  };
  const setText = (next: string) => {
    setTextState(next);
    drafts.set(q.id, { choice, text: next });
  };
  const taskTarget = { taskId: row.taskId };
  return (
    <li id={anchor} className={focused ? "ap-item aq-item aq-focus" : "ap-item aq-item"} data-testid="question-card">
      <div className="ap-item-main">
        <div className="ap-links">
          <a
            className="ap-task"
            href={navHref({ screen: "task", ...taskTarget })}
            onClick={(event) => {
              if (!isPlainLeftClick(event)) return;
              event.preventDefault();
              nav("task", taskTarget);
            }}
          >
            {row.taskId} · {row.taskTitle}
          </a>
        </div>
        <div className="ap-reason" id={`${anchor}-text`}>
          {q.text}
        </div>
        {hasOptions ? (
          <fieldset className="aq-options" disabled={busy} aria-describedby={`${anchor}-text`}>
            <legend className="aq-legend">Pick one</legend>
            {q.options.map((option, i) => (
              <label key={i} className="aq-option">
                <input
                  ref={i === 0 ? firstRadio : undefined}
                  type="radio"
                  name={`aq-${q.id}`}
                  checked={choice === i}
                  onChange={() => setChoice(i)}
                />
                <span>{option}</span>
                {i === q.recommended ? <span className="aq-rec">Recommended</span> : null}
              </label>
            ))}
            {choice !== undefined ? (
              <button
                type="button"
                className="aq-clear"
                onClick={() => {
                  setChoice(undefined);
                  firstRadio.current?.focus();
                }}
              >
                Clear choice
              </button>
            ) : null}
          </fieldset>
        ) : null}
        {q.recommendationReason ? <p className="aq-why">Why recommended: {q.recommendationReason}</p> : null}
        <textarea
          className="ap-note aq-text"
          aria-label={hasOptions ? "Note, or your own answer" : "Your answer"}
          aria-describedby={`${anchor}-text`}
          placeholder={hasOptions ? "Optional note — or leave the options blank and type your own answer" : "Type your answer"}
          maxLength={2000}
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="ap-meta">
          asked by {q.askedBy}
          {q.askedRuntime ? ` via ${q.askedRuntime}` : ""} · {new Date(q.askedAt).toLocaleString()} · stage {row.stage}
        </div>
      </div>
      <div className="ap-actions">
        <button
          type="button"
          className="ap-btn approve"
          disabled={busy || !canSendAnswer(choice, text)}
          onClick={() => onSend(choice, text)}
        >
          Send answer
        </button>
      </div>
    </li>
  );
}

export function QuestionsSection({ nav, focusId }: { nav: Nav; focusId?: string }) {
  const [load, setLoad] = useState<QuestionsLoad>({ status: "loading" });
  // Every card with a send in flight, so one card's send never re-enables another's.
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const scrolledTo = useRef<string | null>(null);

  const reload = useCallback((): Promise<void> => {
    return fetchOpenQuestions()
      .then((rows) => setLoad({ status: "ready", rows }))
      .catch((err: unknown) =>
        setLoad({ status: "error", message: err instanceof ApiClientError ? err.message : "Failed to load questions." })
      );
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Scroll to a linked question once; later reloads leave the page where it is.
  useEffect(() => {
    if (!focusId || scrolledTo.current === focusId || load.status !== "ready") return;
    if (!load.rows.some((r) => r.question.id === focusId)) return;
    scrolledTo.current = focusId;
    document.getElementById(questionAnchorId(focusId))?.scrollIntoView({ block: "center" });
  }, [focusId, load]);

  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  const send = useCallback(
    async (row: OpenQuestionRow, choice: number | undefined, text: string) => {
      const id = row.question.id;
      setBusy((prev) => new Set(prev).add(id));
      setNotice(null);
      try {
        await api("/questions/answer", {
          method: "POST",
          body: JSON.stringify({ taskId: row.taskId, questionId: id, choice, text: text.trim() || undefined }),
        });
        drafts.delete(id);
        setNotice({ tone: "ok", text: `Answer posted to ${row.taskId}.` });
        // The store refresh brings the answer comment and the nav badge up to date.
        await Promise.all([reload(), refreshState()]);
      } catch (err) {
        setNotice({ tone: "error", text: err instanceof ApiClientError ? err.message : "Sending the answer failed." });
        // The question may have been answered elsewhere; show the list as it is now.
        await reload();
      } finally {
        setBusy((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [reload]
  );

  const rows = load.status === "ready" ? load.rows : [];
  const missingLink = !!focusId && load.status === "ready" && !rows.some((r) => r.question.id === focusId);

  // Nothing to show while loading or when there are no questions: the gates keep the screen.
  if (load.status === "loading") return null;
  if (load.status === "ready" && rows.length === 0 && !notice && !missingLink) return null;

  return (
    <section className="aq-section" aria-labelledby="aq-title" data-testid="questions-section">
      <h2 id="aq-title" className="aq-title">
        Questions for you
      </h2>
      <p className="ap-sub">
        Bots asked you these. Only you can answer them; each answer is posted to its task as a comment.
      </p>
      {load.status === "error" ? (
        <div className="ap-error" role="alert">
          {load.message}{" "}
          <button type="button" className="ap-btn" onClick={() => void reload()}>
            Retry
          </button>
        </div>
      ) : null}
      {missingLink && !notice ? (
        <div className="ap-empty" role="status">
          The linked question is not open for you: it has an answer, or it was asked of someone else.
        </div>
      ) : null}
      {notice ? (
        <div ref={noticeRef} tabIndex={-1} className={notice.tone === "error" ? "ap-error" : "aq-ok"} role="status">
          {notice.text}
        </div>
      ) : null}
      {rows.length > 0 ? (
        <ul className="ap-list">
          {rows.map((row) => (
            <QuestionCard
              key={row.question.id}
              row={row}
              nav={nav}
              focused={row.question.id === focusId}
              busy={busy.has(row.question.id)}
              onSend={(choice, text) => void send(row, choice, text)}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
