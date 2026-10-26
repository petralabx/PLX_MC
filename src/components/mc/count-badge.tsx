// Honest nav counts (ADR-005 / spec shell.badges). One vocabulary for the
// sidebar, rail, bottom tabs and More sheet:
//   n       exact — every source has answered
//   n+      partial — a lower bound ("at least n")
//   —       unknown — not loaded, or offline data; never shown as 0
//   hidden  zero, but only once it is confirmed (a lower bound of 0 reads —)
// The visible glyph is aria-hidden and a visually hidden phrase carries the
// meaning, so a link reads "Home, at least 3" rather than "Home 3+".
import type { Health } from "@/lib/mc-data/types";

export interface Count {
  /** null = unknown (not loaded yet, or only cached / demo data). */
  n: number | null;
  /** false = n is a lower bound. */
  exact: boolean;
  /** warn = needs attention (sync issues, spend alerts); acc otherwise. */
  tone?: "acc" | "warn";
  /** Suffix shown and spoken after the number ("live"). */
  unit?: string;
}

export const UNKNOWN_COUNT: Count = { n: null, exact: false };

/**
 * The zoned sidebar's count column (portal ADR-011 v2, Counts): a figure, not
 * a badge. Zero and unknown show nothing, never "—"; a lower bound keeps its
 * "+". Accent for an action count, warn for one that needs attention.
 */
export function CountFigure({ count }: { count: Count | undefined }) {
  if (!count || count.n === null || count.n === 0) return null;
  const unit = count.unit ? ` ${count.unit}` : "";
  return (
    <span className={`cnt ${count.tone ?? "acc"}`}>
      <span aria-hidden="true">{`${count.n}${count.exact ? "" : "+"}${unit}`}</span>
      <span className="vh">, {count.exact ? `${count.n}${unit}` : `at least ${count.n}${unit}`}</span>
    </span>
  );
}

/**
 * A project's or initiative's open tasks in the zoned sidebar's count column,
 * muted. At risk or off track, a warn square leads and the figure turns warn;
 * the row's name says so. Zero shows nothing but that square.
 */
export function OpenCount({ n, health }: { n: number; health?: Health }) {
  const flagged = health === "risk" || health === "off";
  if (n === 0 && !flagged) return null;
  const said = [flagged ? (health === "off" ? "off track" : "at risk") : "", n > 0 ? `${n} open task${n === 1 ? "" : "s"}` : ""]
    .filter(Boolean)
    .join(", ");
  return (
    <span className={`cnt tasks${flagged ? " risk" : ""}`}>
      {flagged ? <span className="sq" aria-hidden="true" /> : null}
      {n > 0 ? <span aria-hidden="true">{n}</span> : null}
      <span className="vh">, {said}</span>
    </span>
  );
}

export function CountBadge({ count }: { count: Count | undefined }) {
  if (!count) return null;
  if (count.n === 0 && count.exact) return null;
  const unit = count.unit ? ` ${count.unit}` : "";
  // A lower bound of zero says nothing: it reads as unknown, not "0+".
  const known = count.n !== null && (count.exact || count.n > 0);
  const text = !known ? "—" : `${count.n}${count.exact ? "" : "+"}${unit}`;
  const spoken = !known ? "count unknown" : count.exact ? `${count.n}${unit}` : `at least ${count.n}${unit}`;
  const tone = !known || !count.exact ? "unk" : (count.tone ?? "acc");
  return (
    <span className={`badge ${tone}`}>
      <span aria-hidden="true">{text}</span>
      <span className="vh">, {spoken}</span>
    </span>
  );
}
