// Meeting → Mission Control bridge (EN-004 / WS-4) — type contracts.
//
// Two capture tiers feed ONE pipeline (see docs/modules/meeting-intake):
//   Tier B — native Microsoft Graph Meeting AI Insights (Copilot-licensed):
//            GET /copilot/users/{id}/onlineMeetings/{id}/aiInsights → actionItems
//            with title / text / ownerDisplayName. No extraction to maintain.
//   Tier A — raw transcript (.vtt) fallback:
//            GET /users/{id}/onlineMeetings/{id}/transcripts/{id}/content → VTT,
//            run through an in-tenant (Azure OpenAI) extractor seam.
//
// Every captured item lands as a PROPOSED task in the triage queue — never an
// auto-entered governed task (Truth Before Action). A human PROMOTES it through
// the governed addTask path.

export type MeetingSource = "aiInsights" | "transcript";

// Identifies the meeting an artifact came from. `meetingId` doubles as the
// opt-in key in the register (a meeting id or a calendar tag we designate).
export interface MeetingRef {
  meetingId: string;
  title?: string;
  organizerId?: string;
}

// ─── Tier B: Microsoft Graph Meeting AI Insights payload (the subset we read) ──
// Shape per the aiInsights endpoint: a meetingAiInsight carries `actionItems`
// (title/text/ownerDisplayName) and `meetingNotes`. We only depend on the
// fields we consume; everything else is ignored, never fabricated.
export interface AiInsightActionItem {
  title?: string;
  text?: string;
  ownerDisplayName?: string;
}

export interface AiInsightsPayload {
  id?: string;
  actionItems?: AiInsightActionItem[];
  meetingNotes?: { title?: string; text?: string }[];
}

// ─── Tier A: transcript (.vtt) ────────────────────────────────────────────────
// A parsed WEBVTT cue. `speaker` comes from a `<v Name>…</v>` voice span when
// present; `timestamp` is the cue start ("HH:MM:SS.mmm").
export interface TranscriptCue {
  start: string;
  end: string;
  speaker?: string;
  text: string;
}

// What the extractor seam returns for the transcript tier. Mirrors the Tier B
// action-item shape plus the transcript evidence (snippet + timestamp).
export interface ExtractedActionItem {
  title: string;
  ownerDisplayName?: string;
  snippet?: string;
  timestamp?: string;
}

// The injectable extraction seam (default = in-tenant Azure OpenAI; mockable in
// tests). Pure DI: callers pass the extractor in, so transcripts never reach an
// external LLM and the path is unit-testable without live Azure.
export type ActionItemExtractor = (
  cues: TranscriptCue[],
  meeting: MeetingRef
) => Promise<ExtractedActionItem[]>;

// ─── Normalized internal action item (both tiers converge here) ───────────────
export interface MeetingActionItem {
  title: string;
  text?: string;
  ownerDisplayName?: string;
  snippet?: string;
  timestamp?: string;
  source: MeetingSource;
}

// ─── Proposed task (the triage-queue unit) ────────────────────────────────────
export type ProposedTaskStatus = "proposed" | "promoted" | "dismissed";

// The meeting source kept with a proposed (and promoted) task as a
// traceability artifact — the snippet + timestamp prove where the item came
// from, never an invented citation.
export interface ProposedTaskEvidence {
  source: MeetingSource;
  meetingId: string;
  meetingTitle?: string;
  snippet?: string;
  timestamp?: string;
}

export interface ProposedTask {
  id: string;
  meetingId: string;
  suggestedTitle: string;
  // The action-item body, carried into the governed task's description.
  text?: string;
  // The owner as named by the meeting artifact (displayName/@mention)…
  ownerDisplayName?: string;
  // …resolved against the real directory (EN-003); null when no confident
  // match — a human still confirms during promotion (never auto-assigned wrong).
  ownerId: string | null;
  candidateBucket: string | null;
  due?: string;
  evidence: ProposedTaskEvidence;
  status: ProposedTaskStatus;
  createdTs: string;
  // Set once promoted — the governed task id this proposal became.
  promotedTaskId?: string;
}

// The pure draft (store assigns id/status/createdTs).
export type ProposedTaskDraft = Omit<
  ProposedTask,
  "id" | "status" | "createdTs" | "promotedTaskId"
>;

// ─── Opt-in meeting register (v1 scope: only designated meetings feed in) ─────
export interface MeetingRegisterEntry {
  // A meeting id OR a calendar tag we designate as opted-in.
  meetingId: string;
  label?: string;
  addedBy: string;
  addedTs: string;
}
