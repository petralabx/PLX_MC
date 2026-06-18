// Capture adapters (EN-004 / WS-4): two tiers, one normalized output. Both
// produce `MeetingActionItem[]` so the drafting step (draft.ts) and the triage
// store treat the source uniformly.
//
//   Tier B — parseAiInsights: pure parse of the Graph aiInsights payload.
//   Tier A — transcriptToActionItems: parse .vtt then run the injectable
//            extractor seam (default = in-tenant Azure OpenAI; mock in tests).
//
// Neither adapter requires a live Graph/Copilot/Azure call — Tier B is pure and
// Tier A takes the extractor as an argument (explicit DI).

import { parseVtt } from "./vtt";
import type {
  ActionItemExtractor,
  AiInsightsPayload,
  MeetingActionItem,
  MeetingRef,
} from "./types";

// Tier B — native Meeting AI Insights. Keep only action items with a usable
// title; carry text + ownerDisplayName through verbatim (never invented).
export function parseAiInsights(payload: AiInsightsPayload): MeetingActionItem[] {
  const items = payload?.actionItems ?? [];
  const out: MeetingActionItem[] = [];
  for (const item of items) {
    const title = (item.title ?? item.text ?? "").trim();
    if (!title) continue;
    out.push({
      title,
      text: item.text?.trim() || undefined,
      ownerDisplayName: item.ownerDisplayName?.trim() || undefined,
      source: "aiInsights",
    });
  }
  return out;
}

// Tier A — raw transcript. Parse the VTT to cues, hand them to the extractor
// (in-tenant), and normalize the result. The extractor is the only place a
// transcript is reasoned over, and it stays in-tenant by contract.
export async function transcriptToActionItems(
  vtt: string,
  meeting: MeetingRef,
  extractor: ActionItemExtractor
): Promise<MeetingActionItem[]> {
  const cues = parseVtt(vtt);
  if (cues.length === 0) return [];
  const extracted = await extractor(cues, meeting);
  const out: MeetingActionItem[] = [];
  for (const item of extracted) {
    const title = (item.title ?? "").trim();
    if (!title) continue;
    out.push({
      title,
      ownerDisplayName: item.ownerDisplayName?.trim() || undefined,
      snippet: item.snippet?.trim() || undefined,
      timestamp: item.timestamp?.trim() || undefined,
      source: "transcript",
    });
  }
  return out;
}
