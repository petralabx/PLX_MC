// Drafting step (EN-004 / WS-4): normalize a captured action item into a
// PROPOSED task. Pure + side-effect free (the triage store assigns id/status/
// timestamp). Owner is resolved against the REAL directory (EN-003) by display
// name — a confident match only, else null so a human confirms during promotion
// (never auto-assign the wrong person — Truth Before Action).

import type { Human } from "@/lib/mc-data";

import type {
  MeetingActionItem,
  MeetingRef,
  ProposedTaskDraft,
} from "./types";

const norm = (s: string | undefined): string => String(s ?? "").trim().toLowerCase();

// Resolve a meeting `ownerDisplayName` to a directory person id, or null.
// Match order: exact full-name, then a UNIQUE first-name match. An ambiguous or
// absent name resolves to null — we never guess between two people.
export function resolveOwnerByDisplayName(
  displayName: string | undefined,
  humans: Human[]
): string | null {
  const needle = norm(displayName);
  if (!needle) return null;

  const exact = humans.filter((h) => norm(h.name) === needle);
  if (exact.length === 1) return exact[0].id;

  const firstName = humans.filter((h) => norm(h.name.split(/\s+/)[0]) === needle);
  if (firstName.length === 1) return firstName[0].id;

  return null;
}

export interface DraftContext {
  humans: Human[];
  // Bucket the meeting is associated with, if any (e.g. an opted-in recurring
  // standup mapped to an initiative). Null when undecided — promotion requires a
  // human to pick one.
  candidateBucket?: string | null;
}

export function draftProposedTask(
  item: MeetingActionItem,
  meeting: MeetingRef,
  ctx: DraftContext
): ProposedTaskDraft {
  return {
    meetingId: meeting.meetingId,
    suggestedTitle: item.title,
    text: item.text,
    ownerDisplayName: item.ownerDisplayName,
    ownerId: resolveOwnerByDisplayName(item.ownerDisplayName, ctx.humans),
    candidateBucket: ctx.candidateBucket ?? null,
    evidence: {
      source: item.source,
      meetingId: meeting.meetingId,
      meetingTitle: meeting.title,
      snippet: item.snippet,
      timestamp: item.timestamp,
    },
  };
}
