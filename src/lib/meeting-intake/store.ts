// Meeting Intake triage store (EN-004 / WS-4) — the reactive queue of PROPOSED
// tasks plus the opt-in meeting register. Mirrors the mc-data store's reactive
// shape (subscribe + version getter) so the triage UI binds with
// useSyncExternalStore, but stays a SEPARATE module store (boundary: this is
// the meeting-intake module, it depends on mc-data, not the reverse).
//
// Capture lands items as PROPOSED — never auto-entered. Promotion goes through
// the governed addTask path (mc-data store), which sets the accountable owner,
// clamps repos to the allow-list (WS-2), and queues the SharePoint mirror.
//
// Everything here is gated by the feature flag + opt-in register (governance:
// disabled by default, only designated meetings feed in).

import { CURRENT_USER } from "@/lib/mc-data";
import { addTask, bucketById, directory, pushNotice } from "@/lib/mc-data/store";
import type { Task } from "@/lib/mc-data";

import { parseAiInsights, transcriptToActionItems } from "./adapters";
import { draftProposedTask } from "./draft";
import { meetingIntakeEnabled, resetMeetingIntakeFlag } from "./flag";
import { isMeetingOptedIn } from "./register";
import type {
  ActionItemExtractor,
  AiInsightsPayload,
  MeetingActionItem,
  MeetingRef,
  MeetingRegisterEntry,
  ProposedTask,
} from "./types";

interface IntakeState {
  proposed: ProposedTask[];
  register: MeetingRegisterEntry[];
}

let state: IntakeState = { proposed: [], register: [] };
let version = 0;
let proposedSeq = 0;
const listeners = new Set<() => void>();

function emit() {
  version += 1;
  for (const l of listeners) l();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getIntakeVersion(): number {
  return version;
}

function stamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())} · ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

// ─── Getters ─────────────────────────────────────────────────────────────────

export const proposedTasks = (): ProposedTask[] => state.proposed;
export const pendingProposedTasks = (): ProposedTask[] =>
  state.proposed.filter((p) => p.status === "proposed");
export const meetingRegister = (): MeetingRegisterEntry[] => state.register;

// ─── Opt-in register ─────────────────────────────────────────────────────────

export function optInMeeting(
  meetingId: string,
  label?: string,
  actorId: string = CURRENT_USER
): MeetingRegisterEntry | null {
  const id = String(meetingId ?? "").trim();
  if (!id) return null;
  if (isMeetingOptedIn(id, state.register)) {
    return state.register.find((e) => e.meetingId === id) ?? null;
  }
  const entry: MeetingRegisterEntry = { meetingId: id, label, addedBy: actorId, addedTs: stamp() };
  state.register = [entry, ...state.register];
  emit();
  return entry;
}

export function optOutMeeting(meetingId: string): void {
  const next = state.register.filter((e) => e.meetingId !== meetingId);
  if (next.length === state.register.length) return;
  state.register = next;
  emit();
}

// ─── Capture (gated) ─────────────────────────────────────────────────────────

export interface CaptureOptions {
  // Initiative this meeting maps to, carried onto the proposed task as the
  // candidate bucket (a human still confirms on promotion).
  bucket?: string | null;
}

// Shared finalize: draft each normalized item, assign id/status/ts, enqueue.
function enqueue(
  items: MeetingActionItem[],
  meeting: MeetingRef,
  opts?: CaptureOptions
): ProposedTask[] {
  const humans = directory();
  const created = items.map((item): ProposedTask => {
    const draft = draftProposedTask(item, meeting, {
      humans,
      candidateBucket: opts?.bucket ?? null,
    });
    return { ...draft, id: `MI-${++proposedSeq}`, status: "proposed", createdTs: stamp() };
  });
  if (created.length > 0) {
    state.proposed = [...created, ...state.proposed];
    emit();
  }
  return created;
}

// True only when the feature is enabled AND the meeting is opted in.
function captureAllowed(meeting: MeetingRef): boolean {
  return meetingIntakeEnabled() && isMeetingOptedIn(meeting.meetingId, state.register);
}

// Tier B — native Meeting AI Insights. Synchronous (pure parse).
export function captureFromAiInsights(
  meeting: MeetingRef,
  payload: AiInsightsPayload,
  opts?: CaptureOptions
): ProposedTask[] {
  if (!captureAllowed(meeting)) return [];
  return enqueue(parseAiInsights(payload), meeting, opts);
}

// Tier A — raw transcript + in-tenant extraction. The extractor is injected
// (default = azureOpenAiExtractor, server-wired; mock in tests).
export async function captureFromTranscript(
  meeting: MeetingRef,
  vtt: string,
  extractor: ActionItemExtractor,
  opts?: CaptureOptions
): Promise<ProposedTask[]> {
  if (!captureAllowed(meeting)) return [];
  const items = await transcriptToActionItems(vtt, meeting, extractor);
  return enqueue(items, meeting, opts);
}

// ─── Promote / dismiss ───────────────────────────────────────────────────────

export interface PromoteOptions {
  // Required if the proposal has no candidate bucket — addTask needs one.
  bucket?: string;
  accountableOwner?: string | null;
  assignee?: string | null;
  repos?: string[];
  humanOnly?: boolean;
  due?: string;
  actor?: string;
}

// Build the governed task's description: the action-item body plus a meeting
// source citation kept as a traceability artifact (mirrored via the Description
// column). Honest — only the captured snippet/timestamp, never invented.
function describeWithSource(p: ProposedTask): string {
  const lines: string[] = [];
  if (p.text && p.text !== p.suggestedTitle) lines.push(p.text);
  const where = p.evidence.meetingTitle || p.evidence.meetingId;
  const when = p.evidence.timestamp ? ` · ${p.evidence.timestamp}` : "";
  lines.push(`— Captured from meeting "${where}" (${p.evidence.source})${when}`);
  if (p.evidence.snippet) lines.push(`\u201c${p.evidence.snippet}\u201d`);
  return lines.join("\n").trim();
}

// Promote a proposed item into a governed Task (the human confirm step). Goes
// through addTask so the task is fully governed (allow-list repos, ToDos
// mirror). Returns the created task, or null when it can't be promoted.
export function promoteProposedTask(proposedId: string, opts: PromoteOptions = {}): Task | null {
  // Defense in depth: with the feature off (or killed) the triage surface is
  // hidden, but never let a stale handle promote into the governed plan.
  if (!meetingIntakeEnabled()) {
    pushNotice("Meeting intake is disabled — can't promote.");
    return null;
  }
  const p = state.proposed.find((x) => x.id === proposedId);
  if (!p || p.status !== "proposed") return null;

  const bucket = opts.bucket ?? p.candidateBucket;
  if (!bucket) {
    pushNotice("Pick an initiative before promoting this meeting item.");
    return null;
  }

  // Accountable owner is always human (EN-003): default to the resolved owner.
  const accountableOwner = opts.accountableOwner ?? p.ownerId;
  // Executor defaults to the same resolved human owner; a human can change it.
  const assignee = opts.assignee ?? p.ownerId;
  // Inherit the initiative's repos by default (WS-2 backfill convention);
  // addTask clamps to the allow-list regardless.
  const repos = opts.repos ?? bucketById(bucket)?.repos ?? [];

  const task = addTask({
    title: p.suggestedTitle,
    description: describeWithSource(p),
    bucket,
    assignee,
    accountableOwner,
    humanOnly: opts.humanOnly,
    repos,
    reporter: opts.actor ?? CURRENT_USER,
    due: opts.due ?? p.due,
    labels: ["from-meeting"],
  });

  p.status = "promoted";
  p.promotedTaskId = task.id;
  emit();
  return task;
}

export function dismissProposedTask(proposedId: string): boolean {
  const p = state.proposed.find((x) => x.id === proposedId);
  if (!p || p.status !== "proposed") return false;
  p.status = "dismissed";
  emit();
  return true;
}

// Test/operator reset: clear the queue + register and restore the flag default.
export function resetMeetingIntake() {
  state = { proposed: [], register: [] };
  version = 0;
  proposedSeq = 0;
  resetMeetingIntakeFlag();
  emit();
}
