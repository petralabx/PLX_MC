// Opt-in meeting register (EN-004 / WS-4, v1 scope). Only designated meetings
// feed the bridge — not every transcribed meeting in the tenant. Pure predicate
// over the register entries; the mutable register lives in the triage store.

import type { MeetingRegisterEntry } from "./types";

// True when a meeting (by id or designated calendar tag) is opted in.
export function isMeetingOptedIn(
  meetingId: string,
  register: MeetingRegisterEntry[]
): boolean {
  const needle = String(meetingId ?? "").trim();
  if (!needle) return false;
  return register.some((e) => e.meetingId === needle);
}
