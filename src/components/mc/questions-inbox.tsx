"use client";

// Questions for you (TASK-3567) — the top of the Approvals screen. Lists only
// the open questions a bot addressed to the signed-in person (GET
// /api/questions filters on the server). The person picks an option or types
// an answer; POST /api/questions/answer stores it and posts it to the task as
// a comment. Only the addressee can answer — the server checks it.

import { useCallback, useEffect, useState } from "react";

import { api, ApiClientError } from "@/lib/api";
import type { TaskQuestion } from "@/lib/mc-data";
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
  const [choice, setChoice] = useState<number | undefined>(undefined);
  const [text, setText] = useState("");
  const hasOptions = q.options.length > 0;
  return (
    <li id={questionAnchorId(q.id)} className={focused ? "ap-item aq-item aq-focus" : "ap-item aq-item"} data-testid="question-card">
      <div className="ap-item-main">
        <div className="ap-links">
          <button type="button" className="ap-task" onClick={() => nav("task", { taskId: row.taskId })}>
            {row.taskId} · {row.taskTitle}
          </button>
        </div>
        <div className="ap-reason">{q.text}</div>
        {hasOptions ? (
          <fieldset className="aq-options" disabled={busy}>
            <legend className="aq-legend">Pick one</legend>
            {q.options.map((option, i) => (
              <label key={i} className="aq-option">
                <input type="radio" name={`aq-${q.id}`} checked={choice === i} onChange={() => setChoice(i)} />
                <span>{option}</span>
                {i === q.recommended ? <span className="aq-rec">Recommended</span> : null}
              </label>
            ))}
            {choice !== undefined ? (
              <button type="button" className="aq-clear" onClick={() => setChoice(undefined)}>
                Clear choice
              </button>
            ) : null}
          </fieldset>
        ) : null}
        {q.recommendationReason ? <p className="aq-why">Why recommended: {q.recommendationReason}</p> : null}
        <textarea
          className="ap-note aq-text"
          aria-label={hasOptions ? "Note, or your own answer" : "Your answer"}
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
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

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

  useEffect(() => {
    if (!focusId || load.status !== "ready" || !load.rows.some((r) => r.question.id === focusId)) return;
    document.getElementById(questionAnchorId(focusId))?.scrollIntoView({ block: "center" });
  }, [focusId, load]);

  const rows = load.status === "ready" ? load.rows : [];

  const send = useCallback(
    async (row: OpenQuestionRow, choice: number | undefined, text: string) => {
      setBusy(row.question.id);
      setNotice(null);
      try {
        await api("/questions/answer", {
          method: "POST",
          body: JSON.stringify({
            taskId: row.taskId,
            questionId: row.question.id,
            choice,
            text: text.trim() || undefined,
          }),
        });
        setNotice({ tone: "ok", text: `Answer posted to ${row.taskId}.` });
        await reload();
      } catch (err) {
        setNotice({ tone: "error", text: err instanceof ApiClientError ? err.message : "Sending the answer failed." });
      } finally {
        setBusy(null);
      }
    },
    [reload]
  );

  // Nothing to say when there are no questions: the gates below keep the screen.
  if (load.status === "ready" && rows.length === 0 && !notice) return null;

  return (
    <section className="aq-section" aria-labelledby="aq-title" data-testid="questions-section">
      <h2 id="aq-title" className="aq-title">
        Questions for you
      </h2>
      <p className="ap-sub">
        Bots asked you these. Only you can answer them; each answer is posted to its task as a comment.
      </p>
      {load.status === "loading" ? <div className="ap-empty">Loading…</div> : null}
      {load.status === "error" ? (
        <div className="ap-error" role="alert">
          {load.message}{" "}
          <button type="button" className="ap-btn" onClick={() => void reload()}>
            Retry
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className={notice.tone === "error" ? "ap-error" : "aq-ok"} role="status">
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
              busy={busy === row.question.id}
              onSend={(choice, text) => void send(row, choice, text)}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
