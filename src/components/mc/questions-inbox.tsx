"use client";

// Questions on the Approvals screen (TASK-3567, redesigned in TASK-3721). A bot
// asks one named person; GET /api/questions lists only the signed-in person's
// open questions (the server filters). The person picks an option or types an
// answer; POST /api/questions/answer stores it and posts it to the task as a
// comment. Only the addressee can answer — the server checks it. On My
// projects a colleague's question is read-only here: the viewer can open the
// task or send one reminder (POST /api/questions/remind).

import type { ReactNode, Ref } from "react";

import { api } from "@/lib/api";
import type { RemindQuestionRequest, TaskQuestion, TaskQuestionReminder } from "@/lib/mc-data";

import { answerSummary, type Draft, type PersonRef } from "./approvals-inbox.helpers";

export interface OpenQuestionRow {
  taskId: string;
  taskTitle: string;
  stage: string;
  question: TaskQuestion;
}

export function fetchOpenQuestions(): Promise<OpenQuestionRow[]> {
  return api<{ questions: OpenQuestionRow[] }>("/questions").then((data) => data.questions);
}

/** POST /api/questions/answer — the body the server validates (unchanged by TASK-3721). */
export function postAnswer(body: { taskId: string; questionId: string; choice?: number; text?: string }): Promise<unknown> {
  return api("/questions/answer", { method: "POST", body: JSON.stringify(body) });
}

/** POST /api/questions/remind. Resolves to the question with the new reminder. */
export function remindQuestion(body: RemindQuestionRequest): Promise<TaskQuestion> {
  return api<{ question: TaskQuestion }>("/questions/remind", { method: "POST", body: JSON.stringify(body) }).then(
    (data) => data.question
  );
}

/** A send needs an option, or typed text when there is no option. */
export function canSendAnswer(choice: number | undefined, text: string): boolean {
  return choice !== undefined || text.trim().length > 0;
}

/** DOM id of a question's queue row; the `question` route param scrolls to it. */
export function questionAnchorId(questionId: string): string {
  return `question-${questionId}`;
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Who reminded and when, oldest first. `about` names the addressee ("you" or a first name). */
export function QuestionReminders({
  reminders,
  about,
  nameOf,
}: {
  reminders: readonly TaskQuestionReminder[] | undefined;
  about: string;
  nameOf: (id: string) => string;
}) {
  if (!reminders || reminders.length === 0) return null;
  return (
    <div className="ap-block">
      <span className="ap-kicker">Reminders</span>
      <ul className="ap-reminders">
        {reminders.map((r) => (
          <li key={r.commentId || `${r.by}-${r.at}`}>
            {nameOf(r.by)} reminded {about} · {when(r.at)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The bot's reason, shown inside the recommended option. */
function WhyRecommended({ reason }: { reason: string }) {
  return (
    <span className="ap-why">
      <strong>Why the bot recommends it.</strong> {reason}
    </span>
  );
}

/** The decision sheet for an open question addressed to the viewer. */
export function MyQuestionSheet({
  question: q,
  taskId,
  draft,
  busy,
  error,
  nameOf,
  onChoice,
  onText,
  onSend,
  onSkip,
  textRef,
}: {
  question: TaskQuestion;
  taskId: string;
  draft: Draft;
  busy: boolean;
  error: string | null;
  nameOf: (id: string) => string;
  onChoice: (choice: number | undefined) => void;
  onText: (text: string) => void;
  onSend: () => void;
  onSkip: () => void;
  textRef?: Ref<HTMLTextAreaElement>;
}) {
  const hasOptions = q.options.length > 0;
  const recommended = q.recommended !== undefined && q.recommended < q.options.length ? q.recommended : undefined;
  const textId = `ap-answer-${q.id}`;
  return (
    <div className="ap-decide" data-testid="question-card">
      <div className="ap-sheet-body">
        <div className="ap-titleblock">
          <span className="ap-kicker">The question</span>
          <h2 id="ap-sheet-title" className="ap-sheet-title" tabIndex={-1}>
            {q.text}
          </h2>
        </div>
        {q.context ? <p className="ap-context">{q.context}</p> : null}
        <QuestionReminders reminders={q.reminders} about="you" nameOf={nameOf} />
        {hasOptions ? (
          <fieldset className="ap-options" disabled={busy}>
            <legend className="ap-kicker">Pick one</legend>
            {q.options.map((option, i) => {
              const on = draft.choice === i;
              const rec = i === recommended;
              return (
                <label key={i} className={`ap-option${on ? " is-on" : ""}`}>
                  <input
                    type="radio"
                    className="ap-radio"
                    name={`ap-q-${q.id}`}
                    checked={on}
                    onChange={() => onChoice(i)}
                  />
                  <span className="ap-option-text">
                    <span>{option}</span>
                    {rec && q.recommendationReason ? <WhyRecommended reason={q.recommendationReason} /> : null}
                  </span>
                  <span className="ap-option-side">
                    {rec ? <span className="ap-badge">Recommended</span> : null}
                    {i < 9 ? (
                      <kbd className="ap-kbd kbd-hint" aria-hidden="true">
                        {i + 1}
                      </kbd>
                    ) : null}
                  </span>
                </label>
              );
            })}
            {draft.choice !== undefined ? (
              <button type="button" className="ap-link" onClick={() => onChoice(undefined)}>
                Clear choice
              </button>
            ) : null}
          </fieldset>
        ) : null}
        {recommended === undefined && q.recommendationReason ? (
          <p className="ap-context">
            <WhyRecommended reason={q.recommendationReason} />
          </p>
        ) : null}
        <div className="ap-field">
          <label htmlFor={textId} className="ap-kicker">
            {hasOptions ? "Note, or your own answer" : "Your answer"}
          </label>
          <textarea
            ref={textRef}
            id={textId}
            className="ap-textarea"
            rows={3}
            maxLength={2000}
            placeholder={
              hasOptions
                ? "Optional. Add context for the bot, or leave the options blank and type your own answer."
                : "Type the answer. It posts to the task as a comment."
            }
            value={draft.text}
            disabled={busy}
            onChange={(e) => onText(e.target.value)}
          />
        </div>
        {error ? (
          <p className="ap-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div className="ap-bar">
        <div className="ap-bar-text">
          <span className="ap-bar-summary">{answerSummary(q.options, draft.choice, draft.text)}</span>
          <span className="ap-meta">Posts to {taskId} as a comment from you</span>
        </div>
        <button type="button" className="ap-btn" onClick={onSkip}>
          Skip for now
        </button>
        <button
          type="button"
          className="ap-btn ap-primary"
          disabled={busy || !canSendAnswer(draft.choice, draft.text)}
          onClick={onSend}
        >
          Send answer
        </button>
      </div>
    </div>
  );
}

/**
 * A colleague's open question (My projects). Read-only: no radios, no send.
 * The viewer can open the task or remind the addressee once per cooldown.
 */
export function ColleagueQuestionSheet({
  question: q,
  taskId,
  person,
  reasonText,
  waitingFor,
  stale,
  coolingDown,
  busy,
  error,
  nameOf,
  openTask,
  onRemind,
}: {
  question: TaskQuestion;
  taskId: string;
  person: PersonRef;
  /** "You see it because you own Finance." */
  reasonText: string;
  /** "3 d" */
  waitingFor: string;
  stale: boolean;
  coolingDown: boolean;
  busy: boolean;
  error: string | null;
  nameOf: (id: string) => string;
  /** The "Open task" link, built by the screen. */
  openTask: ReactNode;
  onRemind: () => void;
}) {
  const hasOptions = q.options.length > 0;
  return (
    <div className="ap-decide" data-testid="colleague-question">
      <div className="ap-sheet-body">
        <div className="ap-titleblock">
          <span className="ap-kicker">The question</span>
          <h2 id="ap-sheet-title" className="ap-sheet-title" tabIndex={-1}>
            {q.text}
          </h2>
        </div>
        {q.context ? <p className="ap-context">{q.context}</p> : null}
        <div className="ap-callout">
          <span className="ap-who is-lg" aria-hidden="true">
            {person.init}
          </span>
          <p>
            <strong>Only {person.name} can answer this.</strong> {reasonText}
          </p>
        </div>
        {hasOptions ? (
          <div className="ap-block">
            <span className="ap-kicker">The options {person.short} sees</span>
            <ol className="ap-readonly-options">
              {q.options.map((option, i) => {
                const rec = i === q.recommended;
                return (
                  <li key={i}>
                    <span className="ap-num" aria-hidden="true">
                      {i + 1}
                    </span>
                    <span className="ap-option-text">
                      <span>{option}</span>
                      {rec && q.recommendationReason ? <WhyRecommended reason={q.recommendationReason} /> : null}
                    </span>
                    {rec ? <span className="ap-badge">Recommended</span> : null}
                  </li>
                );
              })}
            </ol>
          </div>
        ) : (
          <p className="ap-context">This one has no options. {person.short} types the answer.</p>
        )}
        <QuestionReminders reminders={q.reminders} about={person.short} nameOf={nameOf} />
        {error ? (
          <p className="ap-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div className="ap-bar">
        <div className="ap-bar-text">
          <span className={`ap-bar-summary${stale && !coolingDown ? " is-warn" : ""}`}>
            {coolingDown
              ? `Reminder sent. Still waiting on ${person.short}.`
              : `Waiting on ${person.short} for ${waitingFor}.`}
          </span>
          <span className="ap-meta">
            A reminder posts to {taskId} as a comment that mentions {person.short}
          </span>
        </div>
        {openTask}
        <button type="button" className="ap-btn ap-primary" disabled={busy || coolingDown} onClick={onRemind}>
          {coolingDown ? "Reminder sent" : `Remind ${person.short}`}
        </button>
      </div>
    </div>
  );
}
