"use client";

// Approvals (TASK-631, TASK-3567; redesigned as the decision desk in
// TASK-3721). One queue of what waits on a person, grouped by task: questions
// bots asked them and runtime approval gates. My projects adds colleagues'
// questions (read-only, with a reminder) and gates in the viewer's projects;
// Decided is their record. A sheet beside the queue (wide) or over it (narrow:
// phones, tablets and the pinned live column) decides the selected item.
// Every rule that matters — who answers, who approves, the scope check,
// separation of duties, the reminder cooldown — is enforced by the server;
// this screen reflects it and fails closed where it cannot show something.

import { ArrowUpRight, Check, ChevronDown, ChevronLeft, ChevronUp, Lock, ShieldCheck, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { api, ApiClientError } from "@/lib/api";
import {
  STAGES,
  STAGE_IDX,
  type ApprovalEvidenceRef,
  type ApprovalGate,
  type ApprovalScope,
  type ApprovalsDecidedResponse,
  type ApprovalsProjectsResponse,
  type DecidedRow,
  type Human,
  type MyProject,
} from "@/lib/mc-data";
import { useMcVersion, useViewer } from "@/lib/mc-data/hooks";
import { actorById, personByEmail, refreshState } from "@/lib/mc-data/store";
import { isPlainLeftClick, navHref } from "@/components/mc/nav-model";
import type { Nav, ScreenProps } from "@/components/mc/route";

import {
  WAITING_ANYONE,
  approvalKeyAction,
  clearDraft,
  currentId,
  decidedItems,
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
  itemText,
  loadErrors,
  nextAfterDecision,
  nextUpText,
  personRef,
  projectItems,
  projectOptionLabel,
  projectReasonText,
  projectStats,
  queueEmptyText,
  queueOrder,
  queueView,
  raisedByViewer,
  readDrafts,
  rejectNoteError,
  remindCoolingDown,
  replaceProjectQuestion,
  rowMeta,
  saveDraft,
  stepSelection,
  waitingOnPeople,
  waitingOnViewer,
  keyEffect,
  type ApprovalScopeKey,
  type ApprovalTab,
  type Draft,
  type PersonRef,
  type QueueItem,
  type SourceLoad,
  type Stat,
  type TaskGroup,
  type WaitingOn,
} from "./approvals-inbox.helpers";
import { viewerTokens } from "./needs-me";
import {
  ColleagueQuestionSheet,
  MyQuestionSheet,
  canSendAnswer,
  fetchOpenQuestions,
  postAnswer,
  questionAnchorId,
  remindQuestion,
  type OpenQuestionRow,
} from "./questions-inbox";

export interface PendingApprovalRow {
  taskId: string;
  taskTitle: string;
  stage: string;
  gate: ApprovalGate;
  /** The task's existing evidence bundle, or null/absent when the task has none. */
  evidence?: ApprovalEvidenceRef | null;
}

/** Accessible name for a gate's evidence link. Uses the bundle summary when the task has one. */
export function approvalEvidenceLabel(row: Pick<PendingApprovalRow, "taskId" | "evidence">): string {
  const summary = row.evidence?.summary?.trim();
  return summary ? `Evidence: ${summary}` : `Evidence for ${row.taskId}`;
}

// ─── Approval scope (TASK-3408) ──────────────────────────────────────────────

/**
 * The scope text sent as `renderedScope`; the server approves only when it
 * equals its own JSON of the scope. Unknown future scope kinds fail closed.
 */
export function approvalScopeText(gate: ApprovalGate): string | null {
  if (!gate.scope || !["launch", "merge", "flags"].includes(gate.scope.kind)) return null;
  return JSON.stringify(gate.scope, null, 2);
}

export interface ScopeField {
  label: string;
  value: string;
}

const SCOPE_KEYS: Record<string, readonly string[]> = {
  launch: ["kind", "lane", "promptHash"],
  merge: ["kind", "repo", "pr", "headSha"],
  flags: ["kind", "flags"],
};

/**
 * The scope as the fields a person reads before approving. Null — approval
 * unavailable — for an unknown kind, a missing or mistyped field, or any field
 * this screen would not show: the server checks the whole scope text, so the
 * person must have seen every field of it.
 */
export function approvalScopeFields(scope: ApprovalScope): ScopeField[] | null {
  const keys = SCOPE_KEYS[scope.kind];
  if (!keys) return null;
  const own = Object.keys(scope);
  if (own.length !== keys.length || own.some((k) => !keys.includes(k))) return null;
  switch (scope.kind) {
    case "launch":
      if (typeof scope.lane !== "string" || typeof scope.promptHash !== "string") return null;
      return [
        { label: "Kind", value: "Launch" },
        { label: "Lane", value: scope.lane },
        { label: "Prompt hash", value: scope.promptHash },
      ];
    case "merge":
      if (typeof scope.repo !== "string" || typeof scope.pr !== "number" || typeof scope.headSha !== "string") {
        return null;
      }
      return [
        { label: "Kind", value: "Merge" },
        { label: "Repository", value: scope.repo },
        { label: "Pull request", value: `#${scope.pr}` },
        { label: "Head commit", value: scope.headSha },
      ];
    case "flags":
      if (!Array.isArray(scope.flags) || scope.flags.some((f) => typeof f !== "string")) return null;
      return [
        { label: "Kind", value: "Flags" },
        { label: "Flags", value: scope.flags.join(", ") },
      ];
    default:
      return null;
  }
}

/** Approve is possible only when the whole scope can be shown (or the gate has none). */
export function scopeDisplayable(gate: ApprovalGate): boolean {
  return !gate.scope || (approvalScopeText(gate) !== null && approvalScopeFields(gate.scope) !== null);
}

const SCOPE_NOTE: Record<ApprovalScope["kind"], string> = {
  merge: "Covers this head commit only. A new push needs a new approval.",
  launch: "Covers this lane and this exact prompt only. A changed prompt needs a new approval.",
  flags: "Covers these flags only.",
};

export function approveLabel(gate: ApprovalGate): string {
  if (gate.scope?.kind === "merge") return "Approve merge";
  if (gate.scope?.kind === "launch") return "Approve launch";
  return "Approve";
}

function approveEffect(gate: ApprovalGate): string {
  const scope = gate.scope;
  if (!scope) return "Approving lets the agent move past this gate.";
  if (!scopeDisplayable(gate)) return "Scope cannot be displayed. Approval is unavailable.";
  if (scope.kind === "merge") return `Approving lets the agent merge #${scope.pr} at ${scope.headSha.slice(0, 7)}.`;
  if (scope.kind === "launch") return `Approving lets ${scope.lane} start this prompt.`;
  return scope.flags.length === 1 ? "Approving allows this flag." : "Approving allows these flags.";
}

/** "What you are approving": every scope field, or fail closed. */
export function ApprovalDecisionScope({ gate }: { gate: ApprovalGate }) {
  const fields = gate.scope && approvalScopeText(gate) ? approvalScopeFields(gate.scope) : null;
  return (
    <div className="ap-block" data-testid="approval-scope">
      <span className="ap-kicker">What you are approving</span>
      {!gate.scope ? (
        <p className="ap-note">Unscoped approval. It does not cover a merge, a launch or a flag.</p>
      ) : fields ? (
        <>
          <dl className="ap-kv is-mono">
            {fields.map((f) => (
              <div key={f.label}>
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
          <p className="ap-note">{SCOPE_NOTE[gate.scope.kind]}</p>
        </>
      ) : (
        <p className="ap-error" role="alert">
          Scope cannot be displayed. Approval is unavailable.
        </p>
      )}
    </div>
  );
}

export function ApprovalApproveButton({
  gate,
  busy,
  blocked = false,
  onApprove,
}: {
  gate: ApprovalGate;
  busy: boolean;
  /** Separation of duties: the viewer raised this gate. */
  blocked?: boolean;
  onApprove: () => void;
}) {
  return (
    <button
      type="button"
      className="ap-btn ap-primary"
      disabled={busy || blocked || !scopeDisplayable(gate)}
      onClick={onApprove}
    >
      {approveLabel(gate)}
    </button>
  );
}

// ─── Sources ─────────────────────────────────────────────────────────────────

interface ApprovalsResponse {
  approvals: PendingApprovalRow[];
}

// The gate source (GET /api/approvals), shared with Home's "What needs me".
export function fetchPendingApprovals(): Promise<PendingApprovalRow[]> {
  return api<ApprovalsResponse>("/approvals").then((data) => data.approvals);
}

/** GET /api/approvals/projects — loaded when My projects is first opened. */
export function fetchProjectApprovals(): Promise<ApprovalsProjectsResponse> {
  return api<ApprovalsProjectsResponse>("/approvals/projects");
}

/** GET /api/approvals/decided — loaded when the Decided tab is first opened. */
export function fetchDecided(): Promise<DecidedRow[]> {
  return api<ApprovalsDecidedResponse>("/approvals/decided").then((data) => data.decided);
}

// Several surfaces can show the pending list at once (Home's section, this
// screen, the pinned live column ≥2200). A decision in one tells the others to
// reload, so no surface keeps offering something already decided.
type ApprovalsListener = () => unknown;
const approvalsListeners = new Set<ApprovalsListener>();

export function onApprovalsChanged(listener: ApprovalsListener): () => void {
  approvalsListeners.add(listener);
  return () => {
    approvalsListeners.delete(listener);
  };
}

function approvalsChanged(source: ApprovalsListener) {
  for (const listener of approvalsListeners) if (listener !== source) void listener();
}

export function approvalsLoadError(err: unknown): string {
  return err instanceof ApiClientError ? err.message : "Failed to load approvals.";
}

const loadError = (err: unknown, fallback: string) => (err instanceof ApiClientError ? err.message : fallback);

/** The gate load's outcome (GET /api/approvals). */
export type ApprovalsLoad = SourceLoad<PendingApprovalRow[]>;

/**
 * The load states above the queue: Loading, or each failure with Retry. A
 * failure never shows beside "All clear": with no rows the view is "error"
 * and the queue and sheet do not render (queueView).
 */
export function ApprovalsStatus({
  loads,
  rowCount,
  onRetry,
}: {
  loads: readonly SourceLoad<unknown>[];
  rowCount: number;
  onRetry: () => void;
}) {
  if (queueView(loads, rowCount) === "loading") return <div className="ap-empty">Loading…</div>;
  return (
    <>
      {loadErrors(loads).map((message) => (
        <div key={message} className="ap-error" role="alert">
          {message}{" "}
          <button type="button" className="ap-btn" onClick={onRetry}>
            Retry
          </button>
        </div>
      ))}
    </>
  );
}

// ─── Small pieces ────────────────────────────────────────────────────────────

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const stageName = (stage: string) => STAGES[STAGE_IDX[stage]]?.name ?? stage;
const rowDomId = (id: string) => `ap-row-${id}`;

function TaskLink({
  taskId,
  nav,
  className,
  focus,
  label,
  children,
}: {
  taskId: string;
  nav: Nav;
  className?: string;
  focus?: "evidence";
  label?: string;
  children: ReactNode;
}) {
  const target = focus ? { taskId, focus } : { taskId };
  return (
    <a
      className={className}
      href={navHref({ screen: "task", ...target })}
      aria-label={label}
      onClick={(event) => {
        if (!isPlainLeftClick(event)) return;
        event.preventDefault();
        nav("task", target);
      }}
    >
      {children}
    </a>
  );
}

function Pill({ tone, dot, children }: { tone?: "info" | "ok" | "hot" | "warn" | "ink"; dot?: boolean; children: ReactNode }) {
  return (
    <span className={`ap-pill${tone ? ` is-${tone}` : ""}`}>
      {dot ? <span className="ap-dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

const RISK_TONE = { low: undefined, medium: "warn", high: "warn", critical: "ink" } as const;

// ─── Header and controls ─────────────────────────────────────────────────────

function ApprovalsHeader({
  scope,
  count,
  projectName,
  stats,
}: {
  scope: ApprovalScopeKey;
  count: number | null;
  projectName: string | null;
  stats: Stat[] | null;
}) {
  const h = headline(count, scope, projectName);
  return (
    <header className="ph ap-head">
      <div className="ap-head-text">
        <span className="kk">{scope === "me" ? "/ My work · Approvals" : "/ My work · Approvals · My projects"}</span>
        <h1>
          {h.lead} <em>{h.em}</em> {h.tail}
        </h1>
        <p className="sub">
          {scope === "me"
            ? "Questions bots asked you, and runtime gates paused for a human decision. Each answer posts to its task as a comment. A gated task stays frozen until someone other than the requester decides."
            : "Everything waiting in your projects: the ones where you are on the member list, own the project, or are assigned a task. You answer only questions addressed to you and decide gates you did not raise. For a colleague’s question, open the task or send a reminder."}
        </p>
      </div>
      {stats ? (
        <dl className="ap-stats">
          {stats.map((s) => (
            <div key={s.label}>
              <dt>{s.label}</dt>
              <dd className={s.warn ? "is-warn" : undefined}>{s.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </header>
  );
}

function Count({ n }: { n: number | null }) {
  return n === null ? null : <span className="ap-count">{n}</span>;
}

// ─── Queue ───────────────────────────────────────────────────────────────────

export function ApprovalsQueue({
  groups,
  selectedId,
  title,
  emptyText,
  projectNameOf,
  who,
  drafts,
  nowMs,
  onSelect,
  queueRef,
}: {
  groups: TaskGroup[];
  selectedId: string | null;
  title: string;
  emptyText: string;
  /** Set when group headers show the project (My projects, all projects). */
  projectNameOf: ((projectId: string | null) => string | null) | null;
  /** My projects: who an open row waits on. */
  who: ((item: QueueItem) => { label: string; person: PersonRef | null; me: boolean }) | null;
  drafts: Record<string, Draft>;
  nowMs: number;
  onSelect: (id: string) => void;
  queueRef?: RefObject<HTMLElement | null>;
}) {
  return (
    <section ref={queueRef} className="ap-queue" aria-label="Decision queue" data-testid="decision-queue">
      <div className="ap-queue-head">
        <span className="ap-meta">{title}</span>
        <span className="ap-meta">Grouped by task</span>
      </div>
      {groups.length === 0 ? (
        <p className="ap-empty">{emptyText}</p>
      ) : (
        <ul className="ap-groups">
          {groups.map((g) => {
            const project = projectNameOf?.(g.projectId) ?? null;
            return (
              <li key={g.taskId} className="ap-group">
                <div className="ap-group-head">
                  {project ? <span className="ap-group-project">{project}</span> : null}
                  <span className="ap-group-task">{g.taskId}</span>
                  <span className="ap-group-title">{g.taskTitle}</span>
                  <span className="ap-group-count">{g.items.length}</span>
                </div>
                <ul className="ap-rows">
                  {g.items.map((item) => (
                    <QueueRow
                      key={item.id}
                      item={item}
                      selected={item.id === selectedId}
                      who={who && item.kind !== "decided" ? who(item) : null}
                      draft={hasDraft(drafts[item.id])}
                      nowMs={nowMs}
                      onSelect={onSelect}
                    />
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function QueueRow({
  item,
  selected,
  who,
  draft,
  nowMs,
  onSelect,
}: {
  item: QueueItem;
  selected: boolean;
  who: { label: string; person: PersonRef | null; me: boolean } | null;
  draft: boolean;
  nowMs: number;
  onSelect: (id: string) => void;
}) {
  let pill: ReactNode;
  if (item.kind === "question") pill = <Pill dot>Question</Pill>;
  else if (item.kind === "gate") pill = <Pill tone="info" dot>Gate</Pill>;
  else {
    const status = decidedSummary(item.record).status;
    pill = (
      <Pill tone={status === "Rejected" ? "hot" : "ok"} dot>
        {status}
      </Pill>
    );
  }
  const age = item.kind === "decided" ? null : itemAge(item.at, nowMs);
  const meta = rowMeta(item);
  return (
    <li
      className="ap-item"
      data-kind={item.kind}
      id={item.kind === "question" ? questionAnchorId(item.id) : undefined}
    >
      <button
        type="button"
        id={rowDomId(item.id)}
        className="ap-row"
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(item.id)}
      >
        <span className="ap-row-top">
          {pill}
          {age ? <span className={`ap-age${age.stale ? " is-warn" : ""}`}>{age.text}</span> : null}
        </span>
        <span className="ap-row-ask">{itemText(item)}</span>
        <span className="ap-row-meta">
          {who?.person ? (
            <span className={`ap-who${who.me ? " is-me" : ""}`} aria-hidden="true">
              {who.person.init}
            </span>
          ) : null}
          <span>{[who?.label, meta].filter(Boolean).join(" · ")}</span>
          {draft && item.kind !== "decided" ? <span className="ap-row-draft">· Draft kept</span> : null}
        </span>
      </button>
    </li>
  );
}

// ─── Sheet ───────────────────────────────────────────────────────────────────

/** The decision sheet for a pending gate. */
export function GateSheet({
  item,
  nav,
  raisedByMe,
  note,
  noteError,
  busy,
  error,
  noteRef,
  onNote,
  onApprove,
  onReject,
}: {
  item: Extract<QueueItem, { kind: "gate" }>;
  nav: Nav;
  /** Separation of duties: the viewer raised this gate. */
  raisedByMe: boolean;
  note: string;
  noteError: string | null;
  busy: boolean;
  error: string | null;
  noteRef?: RefObject<HTMLTextAreaElement | null>;
  onNote: (note: string) => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const { gate } = item;
  const risk = gate.proposal?.risk;
  const noteId = `ap-note-${gate.id}`;
  const errorId = `${noteId}-error`;
  const proposal = gate.proposal;
  const sourceIsUrl = !!gate.sourceRef && /^https?:\/\//i.test(gate.sourceRef);
  return (
    <div className="ap-decide" data-testid="approval-gate">
      <div className="ap-sheet-body">
        <div className="ap-titleblock">
          <span className="ap-pillrow">
            <span className="ap-kicker">The request</span>
            {risk ? (
              <Pill tone={RISK_TONE[risk]} dot>
                Risk {risk}
              </Pill>
            ) : null}
            {item.stage ? (
              <Pill>
                <Lock className="ap-ic-sm" aria-hidden="true" focusable="false" strokeWidth={2} />
                Frozen at {stageName(item.stage)}
              </Pill>
            ) : null}
          </span>
          <h2 id="ap-sheet-title" className="ap-sheet-title" tabIndex={-1}>
            {gate.reason}
          </h2>
        </div>
        {proposal?.summary ? <p className="ap-context">{proposal.summary}</p> : null}
        <ApprovalDecisionScope gate={gate} />
        <div className="ap-block">
          <span className="ap-kicker">Where it came from</span>
          <dl className="ap-kv">
            <div>
              <dt>Requested by</dt>
              <dd>
                {gate.requestedBy}
                {gate.requestedRuntime ? ` via ${gate.requestedRuntime}` : ""}
              </dd>
            </div>
            <div>
              <dt>Raised</dt>
              <dd>{when(gate.requestedAt)}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd className="is-mono">
                {sourceIsUrl ? (
                  <a href={gate.sourceRef} target="_blank" rel="noopener noreferrer">
                    {gate.sourceRef}
                  </a>
                ) : (
                  (gate.sourceRef ?? "None provided")
                )}
              </dd>
            </div>
            {gate.checkoutRef ? (
              <div>
                <dt>Checkout</dt>
                <dd className="is-mono">{gate.checkoutRef}</dd>
              </div>
            ) : null}
            <div>
              <dt>Evidence</dt>
              <dd>
                <TaskLink taskId={item.taskId} nav={nav} focus="evidence" label={approvalEvidenceLabel(item)}>
                  {item.evidence?.summary?.trim() || "Open the evidence bundle"}
                </TaskLink>
              </dd>
            </div>
          </dl>
        </div>
        {proposal && (proposal.action || proposal.plan || proposal.diff) ? (
          <details className="ap-details" data-testid="approval-proposal">
            <summary>{proposal.diff ? "Proposed plan and diff" : "Proposed plan"}</summary>
            {proposal.action ? <p>Action: {proposal.action}</p> : null}
            {proposal.plan ? <pre>{proposal.plan}</pre> : null}
            {proposal.diff ? <pre>{proposal.diff}</pre> : null}
          </details>
        ) : null}
        <div className={`ap-callout${raisedByMe ? " is-warn" : ""}`}>
          <ShieldCheck className="ap-ic" aria-hidden="true" focusable="false" strokeWidth={1.75} />
          <p>
            {raisedByMe
              ? "You raised this gate, so another person must decide it."
              : "Someone other than the requester must decide a gate. You did not raise this one."}
          </p>
        </div>
        <div className="ap-field">
          <label htmlFor={noteId} className="ap-kicker">
            Decision note
          </label>
          <textarea
            ref={noteRef}
            id={noteId}
            className={`ap-textarea${noteError ? " is-invalid" : ""}`}
            rows={2}
            maxLength={1000}
            placeholder="Required to reject. The requesting agent reads it."
            value={note}
            disabled={busy || raisedByMe}
            aria-invalid={noteError ? true : undefined}
            aria-describedby={noteError ? errorId : undefined}
            onChange={(e) => onNote(e.target.value)}
          />
          {noteError ? (
            <p id={errorId} className="ap-error ap-inline" role="alert">
              {noteError}
            </p>
          ) : null}
        </div>
        {error ? (
          <p className="ap-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div className="ap-bar">
        <div className="ap-bar-text">
          <span className="ap-bar-summary">{raisedByMe ? "Waiting on another approver." : approveEffect(gate)}</span>
          <span className="ap-meta">Recorded on the gate with your name</span>
        </div>
        <button type="button" className="ap-btn ap-reject" disabled={busy || raisedByMe} onClick={onReject}>
          Reject
        </button>
        <ApprovalApproveButton gate={gate} busy={busy} blocked={raisedByMe} onApprove={onApprove} />
      </div>
    </div>
  );
}

/** A decided item: the read-only record. */
export function DecidedSheet({ item, nav }: { item: Extract<QueueItem, { kind: "decided" }>; nav: Nav }) {
  const s = decidedSummary(item.record);
  return (
    <div className="ap-decide" data-testid="decided-record">
      <div className="ap-sheet-body">
        <div className="ap-titleblock">
          <span className="ap-pillrow">
            <Pill tone={s.status === "Rejected" ? "hot" : "ok"} dot>
              {s.status}
            </Pill>
            <span className="ap-meta">{when(item.record.decidedAt)}</span>
          </span>
          <h2 id="ap-sheet-title" className="ap-sheet-title" tabIndex={-1}>
            {itemText(item)}
          </h2>
        </div>
        <dl className="ap-kv">
          <div>
            <dt>{s.label}</dt>
            <dd>{s.answer}</dd>
          </div>
          {s.note ? (
            <div>
              <dt>Note</dt>
              <dd>{s.note}</dd>
            </div>
          ) : null}
          <div>
            <dt>Recorded</dt>
            <dd>{s.recorded}</dd>
          </div>
        </dl>
        <TaskLink taskId={item.taskId} nav={nav} className="ap-open">
          Open {item.taskId}
          <ArrowUpRight className="ap-ic-sm" aria-hidden="true" focusable="false" strokeWidth={1.75} />
        </TaskLink>
      </div>
    </div>
  );
}

function whoLine(item: QueueItem, addressee: PersonRef | null): string {
  const via = (runtime?: string) => (runtime ? ` via ${runtime}` : "");
  if (item.kind === "gate") {
    return `Raised by ${item.gate.requestedBy}${via(item.gate.requestedRuntime)} · ${when(item.gate.requestedAt)}`;
  }
  const q = item.kind === "question" ? item.question : item.record.kind === "question" ? item.record.question : null;
  if (!q) {
    const gate = item.kind === "decided" && item.record.kind === "gate" ? item.record.gate : null;
    return gate ? `Raised by ${gate.requestedBy}${via(gate.requestedRuntime)} · ${when(gate.requestedAt)}` : "";
  }
  const asked = addressee ? `Asked of ${addressee.name} by ` : "Asked by ";
  return `${asked}${q.askedBy}${via(q.askedRuntime)} · ${when(q.askedAt)}`;
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export function ApprovalsInboxView({ route, nav }: ScreenProps) {
  useMcVersion(); // directory names follow the live store
  const viewer = useViewer();

  const [scope, setScope] = useState<ApprovalScopeKey>("me");
  const [tab, setTab] = useState<ApprovalTab>("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [waitingOn, setWaitingOn] = useState<WaitingOn>(WAITING_ANYONE);
  const [questions, setQuestions] = useState<SourceLoad<OpenQuestionRow[]>>({ status: "loading" });
  const [gates, setGates] = useState<ApprovalsLoad>({ status: "loading" });
  const [projects, setProjects] = useState<SourceLoad<ApprovalsProjectsResponse>>({ status: "idle" });
  const [decided, setDecided] = useState<SourceLoad<DecidedRow[]>>({ status: "idle" });
  // A link opens one item: a question (TASK-3567) or a gate (TASK-3559).
  const linked = route.question ?? route.gate;
  const [selected, setSelected] = useState<string | null>(linked ?? null);
  const [sheetOpen, setSheetOpen] = useState(!!linked);
  const [linkFor, setLinkFor] = useState(linked);
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(null);
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);
  const [noteError, setNoteError] = useState<{ id: string; message: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [draftMap, setDraftMap] = useState<Record<string, Draft>>(() => readDrafts());
  // Answered or decided on this screen, so its link is not reported as not open.
  const [settledHere, setSettledHere] = useState<ReadonlySet<string>>(() => new Set());
  const [now, setNow] = useState(() => Date.now());

  const wantProjects = useRef(false);
  const wantDecided = useRef(false);
  const queueRef = useRef<HTMLElement | null>(null);
  const sheetRef = useRef<HTMLElement | null>(null);
  const noticeRef = useRef<HTMLDivElement | null>(null);
  const noteRef = useRef<HTMLTextAreaElement | null>(null);
  const focusRow = useRef<string | null>(null);
  const scrolledTo = useRef<string | null>(null);

  // A new link while the screen is already open selects that item.
  if (linked !== linkFor) {
    setLinkFor(linked);
    if (linked) {
      setScope("me");
      setTab("all");
      setSelected(linked);
      setSheetOpen(true);
    }
  }

  const loadForMe = useCallback(
    () =>
      Promise.all([
        fetchOpenQuestions().then(
          (rows) => setQuestions({ status: "ready", data: rows }),
          (err: unknown) => setQuestions({ status: "error", message: loadError(err, "Failed to load questions.") })
        ),
        fetchPendingApprovals().then(
          (rows) => setGates({ status: "ready", data: rows }),
          (err: unknown) => setGates({ status: "error", message: approvalsLoadError(err) })
        ),
      ]).then(() => setNow(Date.now())),
    []
  );
  const loadProjects = useCallback(
    () =>
      fetchProjectApprovals().then(
        (data) => setProjects({ status: "ready", data }),
        (err: unknown) => setProjects({ status: "error", message: loadError(err, "Failed to load your projects.") })
      ),
    []
  );
  const loadDecided = useCallback(
    () =>
      fetchDecided().then(
        (rows) => setDecided({ status: "ready", data: rows }),
        (err: unknown) => setDecided({ status: "error", message: loadError(err, "Failed to load your decisions.") })
      ),
    []
  );
  // Everything this screen has loaded so far. Never rejects: each load keeps its own error.
  const reloadAll = useCallback(
    (): Promise<void> =>
      Promise.all([
        loadForMe(),
        wantProjects.current ? loadProjects() : null,
        wantDecided.current ? loadDecided() : null,
      ]).then(() => undefined),
    [loadForMe, loadProjects, loadDecided]
  );

  useEffect(() => {
    void loadForMe();
  }, [loadForMe]);

  useEffect(() => onApprovalsChanged(reloadAll), [reloadAll]);

  // ── Who is looking ──
  const me = viewer ? viewerTokens(viewer) : new Set<string>();
  const directoryEmail = viewer ? (actorById(viewer.id) as Human | undefined)?.email : undefined;
  if (directoryEmail) me.add(directoryEmail.trim().toLowerCase());
  const lookup = (idOrEmail: string): Human | undefined => {
    const actor = actorById(idOrEmail);
    if (actor?.kind === "human") return actor;
    return idOrEmail.includes("@") ? personByEmail(idOrEmail) : undefined;
  };
  const person = (idOrEmail: string) => personRef(idOrEmail, lookup);
  const nameOf = (idOrEmail: string) => person(idOrEmail).name;

  // ── What is listed ──
  const forMe = forMeItems(
    questions.status === "ready" ? questions.data : [],
    gates.status === "ready" ? gates.data : []
  );
  const projectsData = projects.status === "ready" ? projects.data : null;
  const myProjects: MyProject[] = projectsData?.projects ?? [];
  const projItems = projectsData ? projectItems(projectsData, me) : [];
  const filtered = scope === "projects" && (projectFilter !== "all" || waitingOn !== WAITING_ANYONE);
  const scopedOpen = scope === "me" ? forMe : filterProjectItems(projItems, projectFilter, waitingOn);
  const decidedList = decided.status === "ready" ? decidedItems(decided.data) : [];
  const visible = tab === "decided" ? decidedList : filterTab(scopedOpen, tab);
  const groups = groupByTask(visible);
  const order = queueOrder(groups);
  const curId = currentId(order, selected);
  const cur = visible.find((item) => item.id === curId) ?? null;

  const sources: SourceLoad<unknown>[] =
    tab === "decided"
      ? [decided]
      : scope === "projects"
        ? [projects]
        : tab === "questions"
          ? [questions]
          : tab === "gates"
            ? [gates]
            : [questions, gates];
  const view = queueView(sources, visible.length);

  const forMeReady = questions.status === "ready" && gates.status === "ready";
  const scopeReady = scope === "me" ? forMeReady : !!projectsData;
  const projectName = projectFilter !== "all" ? (myProjects.find((p) => p.id === projectFilter)?.name ?? null) : null;
  const projectNameOf = (id: string | null) => (id ? (myProjects.find((p) => p.id === id)?.name ?? id) : null);
  const stats = !scopeReady
    ? null
    : scope === "me"
      ? forMeStats(
          waitingOnViewer(forMe, me),
          decided.status === "ready" ? decidedTodayCount(decided.data, new Date(now)) : null,
          now
        )
      : projectStats(scopedOpen, now);
  const countOf = (kind: "question" | "gate") => scopedOpen.filter((i) => i.kind === kind).length;
  const tabCounts: Record<ApprovalTab, number | null> = {
    all: scopeReady ? scopedOpen.length : null,
    questions: scope === "me" ? (questions.status === "ready" ? countOf("question") : null) : scopeReady ? countOf("question") : null,
    gates: scope === "me" ? (gates.status === "ready" ? countOf("gate") : null) : scopeReady ? countOf("gate") : null,
    decided: decided.status === "ready" ? decided.data.length : null,
  };

  const questionLinkGone =
    !!route.question &&
    questions.status === "ready" &&
    !questions.data.some((r) => r.question.id === route.question) &&
    !settledHere.has(route.question);
  const gateLinkGone =
    !route.question &&
    !!route.gate &&
    gates.status === "ready" &&
    !gates.data.some((r) => r.gate.id === route.gate) &&
    !settledHere.has(route.gate);
  const missingLink = questionLinkGone || gateLinkGone;

  // Ages and the reminder cooldown follow the clock while the screen stays open.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // ── Focus and scroll ──
  // Narrow layouts hide the queue while the sheet is open, so focus follows
  // into the sheet; on wide layouts both stay and focus stays put.
  useEffect(() => {
    if (!sheetOpen || !curId) return;
    const queue = queueRef.current;
    const sheet = sheetRef.current;
    if (!queue || !sheet || getComputedStyle(queue).display !== "none") return;
    if (sheet.contains(document.activeElement)) return;
    document.getElementById("ap-sheet-title")?.focus();
  }, [sheetOpen, curId]);

  useEffect(() => {
    const id = focusRow.current;
    if (!id) return;
    focusRow.current = null;
    document.getElementById(rowDomId(id))?.focus();
  });

  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  // Scroll to a linked question or gate once; later reloads leave the page where it is.
  useEffect(() => {
    const id = route.question ?? route.gate;
    if (!id || scrolledTo.current === id) return;
    const listed = route.question
      ? questions.status === "ready" && questions.data.some((r) => r.question.id === id)
      : gates.status === "ready" && gates.data.some((r) => r.gate.id === id);
    if (!listed) return;
    scrolledTo.current = id;
    document.getElementById(route.question ? questionAnchorId(id) : rowDomId(id))?.scrollIntoView({ block: "center" });
  }, [route.question, route.gate, questions, gates]);

  // ── Actions ──
  const clearMessages = () => {
    setNotice(null);
    setActionError(null);
    setNoteError(null);
  };
  const select = (id: string) => {
    setSelected(id);
    setSheetOpen(true);
    clearMessages();
  };
  const move = (delta: 1 | -1) => {
    const id = stepSelection(order, curId, delta);
    if (!id) return;
    if (queueRef.current?.contains(document.activeElement)) focusRow.current = id;
    setSelected(id);
    clearMessages();
  };
  const backToQueue = () => {
    focusRow.current = curId;
    setSheetOpen(false);
  };
  const pickScope = (next: ApprovalScopeKey) => {
    setScope(next);
    setTab("all");
    setSelected(null);
    clearMessages();
    if (next === "projects" && !wantProjects.current) {
      wantProjects.current = true;
      setProjects({ status: "loading" });
      void loadProjects();
    }
  };
  const pickTab = (next: ApprovalTab) => {
    setTab(next);
    setSelected(null);
    clearMessages();
    if (next === "decided" && !wantDecided.current) {
      wantDecided.current = true;
      setDecided({ status: "loading" });
      void loadDecided();
    }
  };
  const showEverything = () => {
    setProjectFilter("all");
    setWaitingOn(WAITING_ANYONE);
    pickTab("all");
  };
  const retry = () => {
    if (questions.status === "error") setQuestions({ status: "loading" });
    if (gates.status === "error") setGates({ status: "loading" });
    if (projects.status === "error") setProjects({ status: "loading" });
    if (decided.status === "error") setDecided({ status: "loading" });
    void reloadAll();
  };

  const draftOf = (id: string): Draft => draftMap[id] ?? { text: "" };
  const updateDraft = (id: string, draft: Draft) => {
    saveDraft(id, draft);
    setDraftMap((prev) => ({ ...prev, [id]: draft }));
  };
  const dropDraft = (id: string) => {
    clearDraft(id);
    setDraftMap((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  // After a decision: the next row, a notice naming it, fresh lists, and a
  // broadcast so Home and the live column drop the decided item too.
  const afterDecision = async (item: QueueItem, title: string, body: string) => {
    const nextId = nextAfterDecision(order, item.id);
    const nextItem = visible.find((i) => i.id === nextId) ?? null;
    setSettledHere((prev) => new Set(prev).add(item.id));
    setSelected(nextId);
    setNotice({ title, body: `${body} ${nextUpText(nextItem)}` });
    await Promise.all([reloadAll(), refreshState()]);
    approvalsChanged(reloadAll);
  };

  const sendAnswer = async (item: Extract<QueueItem, { kind: "question" }>) => {
    const draft = draftOf(item.id);
    if (busy || !item.mine || !canSendAnswer(draft.choice, draft.text)) return;
    setBusy(item.id);
    clearMessages();
    try {
      await postAnswer({
        taskId: item.taskId,
        questionId: item.id,
        choice: draft.choice,
        text: draft.text.trim() || undefined,
      });
    } catch (err) {
      setActionError({ id: item.id, message: loadError(err, "Sending the answer failed.") });
      setBusy(null);
      // The question may have been answered elsewhere; show the list as it is now.
      await reloadAll();
      return;
    }
    dropDraft(item.id);
    setBusy(null);
    await afterDecision(item, `Answer posted to ${item.taskId}.`, "It is on the task as a comment from you.");
  };

  const decideGate = async (item: Extract<QueueItem, { kind: "gate" }>, decision: "approved" | "rejected") => {
    if (busy || raisedByViewer(item.gate, me)) return;
    const note = draftOf(item.id).text.trim();
    if (decision === "rejected") {
      const message = rejectNoteError(note);
      if (message) {
        setNoteError({ id: item.id, message });
        noteRef.current?.focus();
        return;
      }
    }
    const renderedScope = approvalScopeText(item.gate);
    if (decision === "approved" && !scopeDisplayable(item.gate)) {
      setActionError({ id: item.id, message: "Scope cannot be displayed. Approval is unavailable." });
      return;
    }
    setBusy(item.id);
    clearMessages();
    try {
      await api("/approvals/decide", {
        method: "POST",
        body: JSON.stringify({
          taskId: item.taskId,
          gateId: item.gate.id,
          decision,
          renderedScope: renderedScope ?? undefined,
          renderedSourceRef: item.gate.sourceRef,
          note: note || undefined,
        }),
      });
    } catch (err) {
      setActionError({ id: item.id, message: loadError(err, "Decision failed.") });
      setBusy(null);
      return;
    }
    dropDraft(item.id);
    setBusy(null);
    await afterDecision(
      item,
      decision === "approved" ? `Gate approved on ${item.taskId}.` : `Gate rejected on ${item.taskId}.`,
      decision === "approved" ? "The agent can move past it." : "The agent has your note."
    );
  };

  const remind = async (item: Extract<QueueItem, { kind: "question" }>) => {
    if (busy || item.mine || remindCoolingDown(item.question, me, now)) return;
    setBusy(item.id);
    clearMessages();
    try {
      const question = await remindQuestion({ taskId: item.taskId, questionId: item.id });
      setProjects((prev) =>
        prev.status === "ready" ? { status: "ready", data: replaceProjectQuestion(prev.data, item.taskId, question) } : prev
      );
    } catch (err) {
      // 409 (cooldown, or answered meanwhile) and 403 (not your project) carry the server's reason.
      setActionError({ id: item.id, message: loadError(err, "Sending the reminder failed.") });
      setBusy(null);
      // The question may have been answered elsewhere; show the lists as they are now.
      await reloadAll();
      return;
    }
    setBusy(null);
    setNotice({
      title: `Reminder posted to ${item.taskId}.`,
      body: "It is on the task as a comment from you, and it shows on the question in their Approvals.",
    });
    await Promise.all([reloadAll(), refreshState()]);
    approvalsChanged(reloadAll);
  };

  // Keys work only while focus is inside the screen: the shell owns window-level ⌘K and `g` chords.
  // keyEffect decides what a key may do: never decide a gate, never act on a hidden sheet.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return;
    const action = approvalKeyAction(event, isTypingTarget(event.target as HTMLInputElement));
    if (!action) return;
    const sheet = sheetRef.current;
    const effect = keyEffect(action, {
      kind: cur?.kind ?? null,
      mine: cur?.kind === "question" && cur.mine,
      optionCount: cur?.kind === "question" ? cur.question.options.length : 0,
      sheetVisible: !!sheet && getComputedStyle(sheet).display !== "none",
      busy: !!busy,
      hasItems: order.length > 0,
    });
    if (!effect) return;
    if (effect.type === "move") move(effect.delta);
    else if (effect.type === "open" && cur) nav("task", { taskId: cur.taskId });
    else if (effect.type === "pick" && cur) updateDraft(cur.id, { ...draftOf(cur.id), choice: effect.index });
    else if (effect.type === "send" && cur?.kind === "question") void sendAnswer(cur);
    event.preventDefault();
  };

  // ── Render ──
  const whoFor = (item: QueueItem) => {
    if (item.kind === "gate") {
      return { label: raisedByViewer(item.gate, me) ? "Another approver" : "Any approver", person: null, me: false };
    }
    if (item.kind === "question" && item.mine) {
      return { label: "On you", person: viewer ? person(viewer.id) : null, me: true };
    }
    const addressee = item.kind === "question" ? person(item.question.addressee) : null;
    return { label: addressee ? `On ${addressee.short}` : "", person: addressee, me: false };
  };
  const people = waitingOnPeople(projItems, nameOf);
  const pos = curId ? order.indexOf(curId) + 1 : 0;
  // A linked question or gate that is not open stands in for nothing: while it is still
  // the selection, a narrow layout shows the queue with the notice, never another
  // item's sheet. Picking a row selects that row and opens its sheet as usual.
  const linkStandIn = missingLink && selected === linked;
  const narrowView = cur ? (sheetOpen && !linkStandIn ? "sheet" : "queue") : "both";
  const itemError = (id: string) => (actionError?.id === id ? actionError.message : null);
  const empty = emptySheet({
    scope,
    tab,
    openCount: scope === "me" ? (forMeReady ? forMe.length : null) : projItems.length,
    filtered: filtered && visible.length === 0 && projItems.length > 0,
  });

  let kindLabel = "";
  let addressee: PersonRef | null = null;
  if (cur?.kind === "question") {
    addressee = cur.mine ? null : person(cur.question.addressee);
    kindLabel = addressee ? `Question for ${addressee.short}` : "Question for you";
  } else if (cur?.kind === "gate") kindLabel = "Approval gate";
  else if (cur) kindLabel = "Decided";

  let body: ReactNode = null;
  if (cur?.kind === "question" && cur.mine) {
    body = (
      <MyQuestionSheet
        question={cur.question}
        taskId={cur.taskId}
        draft={draftOf(cur.id)}
        busy={busy === cur.id}
        error={itemError(cur.id)}
        nameOf={nameOf}
        onChoice={(choice) => updateDraft(cur.id, { ...draftOf(cur.id), choice })}
        onText={(text) => updateDraft(cur.id, { ...draftOf(cur.id), text })}
        onSend={() => void sendAnswer(cur)}
        onSkip={() => move(1)}
      />
    );
  } else if (cur?.kind === "question" && addressee) {
    const age = itemAge(cur.at, now);
    body = (
      <ColleagueQuestionSheet
        question={cur.question}
        taskId={cur.taskId}
        person={addressee}
        reasonText={projectReasonText(myProjects.find((p) => p.id === cur.projectId))}
        waitingFor={age.label}
        stale={age.stale}
        coolingDown={remindCoolingDown(cur.question, me, now)}
        busy={busy === cur.id}
        error={itemError(cur.id)}
        nameOf={nameOf}
        openTask={
          <TaskLink taskId={cur.taskId} nav={nav} className="ap-btn">
            Open task
          </TaskLink>
        }
        onRemind={() => void remind(cur)}
      />
    );
  } else if (cur?.kind === "gate") {
    body = (
      <GateSheet
        item={cur}
        nav={nav}
        raisedByMe={raisedByViewer(cur.gate, me)}
        note={draftOf(cur.id).text}
        noteError={noteError?.id === cur.id ? noteError.message : null}
        busy={busy === cur.id}
        error={itemError(cur.id)}
        noteRef={noteRef}
        onNote={(text) => {
          updateDraft(cur.id, { text });
          if (noteError) setNoteError(null);
        }}
        onApprove={() => void decideGate(cur, "approved")}
        onReject={() => void decideGate(cur, "rejected")}
      />
    );
  } else if (cur?.kind === "decided") {
    body = <DecidedSheet item={cur} nav={nav} />;
  }

  const tabs: { key: ApprovalTab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "questions", label: "Questions" },
    { key: "gates", label: "Gates" },
    { key: "decided", label: "Decided" },
  ];

  return (
    <div
      className="ap-page"
      data-testid="approvals-screen"
      data-view={narrowView}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <ApprovalsHeader
        scope={scope}
        count={scopeReady ? (scope === "me" ? waitingOnViewer(forMe, me).length : scopedOpen.length) : null}
        projectName={projectName}
        stats={stats}
      />
      <div className="ap-body">
        <div className="ap-controls">
          <div role="group" aria-label="Whose decisions" className="ap-seg">
            <button type="button" aria-pressed={scope === "me"} onClick={() => pickScope("me")}>
              For me
              <Count n={forMeReady ? forMe.length : null} />
            </button>
            <button type="button" aria-pressed={scope === "projects"} onClick={() => pickScope("projects")}>
              My projects
              <Count n={projectsData ? projItems.length : null} />
            </button>
          </div>
          {scope === "projects" && tab !== "decided" && projectsData ? (
            <>
              <label className="ap-filter">
                <span className="ap-meta">Project</span>
                <select
                  value={projectFilter}
                  onChange={(e) => {
                    setProjectFilter(e.target.value);
                    setSelected(null);
                    clearMessages();
                  }}
                >
                  <option value="all">All my projects</option>
                  {myProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {projectOptionLabel(p)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ap-filter">
                <span className="ap-meta">Waiting on</span>
                <select
                  value={waitingOn}
                  onChange={(e) => {
                    setWaitingOn(e.target.value);
                    setSelected(null);
                    clearMessages();
                  }}
                >
                  <option value={WAITING_ANYONE}>Anyone</option>
                  <option value="you">You</option>
                  <option value="approver">Any approver (gates)</option>
                  {people.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
        </div>
        <div className="ap-tabsrow">
          <div role="group" aria-label="Show" className="ap-tabs">
            {tabs.map((t) => (
              <button key={t.key} type="button" aria-pressed={tab === t.key} onClick={() => pickTab(t.key)}>
                {t.label}
                <Count n={tabCounts[t.key]} />
              </button>
            ))}
          </div>
          <span className="ap-keys kbd-hint">1–9 pick · ⌘↵ send · J / K move · E open task</span>
        </div>
        {missingLink ? (
          <div className="ap-empty" role="status">
            {gateLinkGone
              ? "The linked gate is not waiting for a decision: it was decided, or it is on a project you cannot open."
              : "The linked question is not open for you: it has an answer, or it was asked of someone else."}
          </div>
        ) : null}
        <ApprovalsStatus loads={sources} rowCount={visible.length} onRetry={retry} />
        {view === "list" || view === "empty" ? (
          <div className="ap-layout">
            <ApprovalsQueue
              groups={groups}
              selectedId={curId}
              title={
                tab === "decided"
                  ? `${visible.length} decided`
                  : `${visible.length} open · ${groups.length} ${groups.length === 1 ? "task" : "tasks"}`
              }
              emptyText={queueEmptyText(tab, filtered)}
              projectNameOf={scope === "projects" && projectFilter === "all" && tab !== "decided" ? projectNameOf : null}
              who={scope === "projects" ? whoFor : null}
              drafts={draftMap}
              nowMs={now}
              onSelect={select}
              queueRef={queueRef}
            />
            <section ref={sheetRef} className="ap-sheet" aria-labelledby="ap-sheet-title" data-testid="decision-sheet">
              {notice ? (
                <div ref={noticeRef} tabIndex={-1} role="status" className="ap-notice">
                  <Check className="ap-ic" aria-hidden="true" focusable="false" strokeWidth={2} />
                  <div>
                    <p className="ap-notice-title">{notice.title}</p>
                    <p>{notice.body}</p>
                  </div>
                  <button type="button" className="ap-icon-btn" aria-label="Dismiss" onClick={() => setNotice(null)}>
                    <X className="ap-ic" aria-hidden="true" focusable="false" strokeWidth={1.75} />
                  </button>
                </div>
              ) : null}
              {cur ? (
                <>
                  <div className="ap-run">
                    <button type="button" className="ap-back" onClick={backToQueue}>
                      <ChevronLeft className="ap-ic" aria-hidden="true" focusable="false" strokeWidth={1.75} />
                      Back to queue
                    </button>
                    <span className="ap-run-text">
                      <span className="ap-run-more">Decision </span>
                      {pos} of {order.length}
                      <span className="ap-run-more">
                        {" "}
                        · {kindLabel} · {cur.id}
                      </span>
                    </span>
                    <span className="ap-run-nav">
                      <button
                        type="button"
                        className="ap-icon-btn"
                        aria-label="Previous decision (K)"
                        onClick={() => move(-1)}
                      >
                        <ChevronUp className="ap-ic" aria-hidden="true" focusable="false" strokeWidth={1.75} />
                      </button>
                      <button type="button" className="ap-icon-btn" aria-label="Next decision (J)" onClick={() => move(1)}>
                        <ChevronDown className="ap-ic" aria-hidden="true" focusable="false" strokeWidth={1.75} />
                      </button>
                    </span>
                  </div>
                  <div className="ap-sheet-head">
                    <div className="ap-sheet-head-row">
                      <TaskLink taskId={cur.taskId} nav={nav} className="ap-taskid">
                        {cur.taskId}
                      </TaskLink>
                      {cur.stage ? <Pill>Stage · {stageName(cur.stage)}</Pill> : null}
                      {cur.projectId ? <Pill>{projectNameOf(cur.projectId)}</Pill> : null}
                      <TaskLink taskId={cur.taskId} nav={nav} className="ap-open">
                        Open task
                        <ArrowUpRight className="ap-ic-sm" aria-hidden="true" focusable="false" strokeWidth={1.75} />
                      </TaskLink>
                    </div>
                    <p className="ap-sheet-task">{cur.taskTitle}</p>
                    <p className="ap-meta">{whoLine(cur, addressee)}</p>
                  </div>
                  {body}
                </>
              ) : (
                <div className="ap-clear">
                  {empty.clear ? <span className="ap-kicker">/ Queue empty</span> : null}
                  <h2 id="ap-sheet-title" className={empty.clear ? "ap-clear-title" : "ap-sheet-title"}>
                    {empty.clear ? (
                      <>
                        All <em>clear.</em>
                      </>
                    ) : (
                      empty.title
                    )}
                  </h2>
                  <p>{empty.body}</p>
                  {empty.action === "decided" ? (
                    <button type="button" className="ap-btn" onClick={() => pickTab("decided")}>
                      See what you decided
                    </button>
                  ) : empty.action ? (
                    <button type="button" className="ap-btn" onClick={showEverything}>
                      Show everything open
                    </button>
                  ) : null}
                </div>
              )}
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
}
