// WEBVTT transcript parser (EN-004 / WS-4, Tier A). Pure + side-effect free so
// it is unit-testable against fixture .vtt payloads without live Graph. Parses
// the subset Teams transcripts emit: a `WEBVTT` header, blank-line-separated
// cues, an `HH:MM:SS.mmm --> HH:MM:SS.mmm` timing line, and one or more text
// lines. Speaker is read from a Teams `<v Name>…</v>` voice span when present.

import type { TranscriptCue } from "./types";

const TIMING = /^\s*([\d:.]+)\s*-->\s*([\d:.]+)/;
const VOICE_SPAN = /<v\s+([^>]+)>([\s\S]*?)<\/v>/i;

function stripTags(text: string): string {
  return text.replace(/<[^>]+>/g, "").trim();
}

export function parseVtt(vtt: string): TranscriptCue[] {
  const cues: TranscriptCue[] = [];
  // Normalize newlines, then split into blank-line-separated blocks.
  const blocks = String(vtt ?? "")
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length === 0) continue;
    // Skip the WEBVTT header block (and any NOTE/STYLE/REGION metadata blocks).
    if (/^(WEBVTT|NOTE|STYLE|REGION)\b/.test(lines[0]) && !TIMING.test(lines[0])) {
      if (!(lines[1] && TIMING.test(lines[1]))) continue;
    }
    // A leading cue identifier line (no `-->`) is optional — skip it.
    let i = 0;
    if (!TIMING.test(lines[0]) && lines[1] && TIMING.test(lines[1])) i = 1;
    const timing = TIMING.exec(lines[i]);
    if (!timing) continue;
    const start = timing[1];
    const end = timing[2];
    const payload = lines.slice(i + 1).join("\n").trim();
    if (!payload) continue;

    const voice = VOICE_SPAN.exec(payload);
    if (voice) {
      cues.push({ start, end, speaker: voice[1].trim(), text: stripTags(voice[2]) });
    } else {
      cues.push({ start, end, text: stripTags(payload) });
    }
  }
  return cues;
}
