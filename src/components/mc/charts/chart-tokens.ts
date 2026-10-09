// charts/chart-tokens.ts — per-category identity color maps (CLAUDE.md Pillar-3
// EXCEPTION: a category→token map, NOT raw color). Every value is an existing
// --p-* CSS var, so light/dark + brand theming under `.brand-plx` are automatic
// and there is no raw hex anywhere in the charts (SPEC §3.B.4 / doctrine).

import type { Band, PriorityKey } from "@/lib/mc-data";

// Status donut by band — the 9 stages collapse to 3 bands for legibility, and
// the band tones mirror the board's own status language (todo=info, doing=warn,
// done=ok). A band is N stages; the click maps back to those stages (no synthetic
// "band" facet — SPEC §3.B.5).
export const STATUS_COLOR_VAR: Record<Band, string> = {
  todo: "var(--p-info)",
  doing: "var(--p-warn)",
  done: "var(--p-ok)",
  cancelled: "var(--p-muted)",
};

// Priority bars — mirrors PRIORITY[*].cls so the chart speaks the same visual
// language as the priority chips (urgent=hot, high=warn, medium=info, low=muted).
export const PRIORITY_COLOR_VAR: Record<PriorityKey, string> = {
  urgent: "var(--p-hot)",
  high: "var(--p-warn)",
  medium: "var(--p-info)",
  low: "var(--p-muted)",
};

// Bucket/assignee distribution bars use ONE hue (the accent) with opacity steps
// applied per row — never N arbitrary colors (SPEC §3.B.4). A single token here;
// the CategoryBar component derives the per-row opacity.
export const BUCKET_COLOR_VAR = "var(--p-accent)";

// The "Unassigned" assignee slice reads as a neutral, not an accent, so it does
// not compete with the real assignees in the same bar list.
export const UNASSIGNED_COLOR_VAR = "var(--p-muted)";

// The empty/track fill for a zero-total donut or a placeholder bar — a neutral
// gridline, never a NaN arc (SPEC §3.B.4).
export const GRID_COLOR_VAR = "var(--p-grid)";
