// Honest nav counts (ADR-005 / spec shell.badges). One vocabulary for the
// sidebar, rail, bottom tabs and More sheet:
//   n       exact — every source has answered
//   n+      partial — a lower bound ("at least n")
//   —       unknown — still loading, never shown as 0
//   hidden  zero, but only once it is confirmed
// The visible glyph is aria-hidden and a visually hidden phrase carries the
// meaning, so a link reads "Home, at least 3" rather than "Home 3+".

export interface Count {
  /** null = unknown (loading or unavailable). */
  n: number | null;
  /** false = n is a lower bound. */
  exact: boolean;
  /** warn = needs attention (sync issues, spend alerts); acc otherwise. */
  tone?: "acc" | "warn";
  /** Suffix shown and spoken after the number ("live"). */
  unit?: string;
}

export const UNKNOWN_COUNT: Count = { n: null, exact: false };

export function CountBadge({ count }: { count: Count | undefined }) {
  if (!count) return null;
  if (count.n === 0 && count.exact) return null;
  const unit = count.unit ? ` ${count.unit}` : "";
  const known = count.n !== null;
  const text = !known ? "—" : `${count.n}${count.exact ? "" : "+"}${unit}`;
  const spoken = !known ? "count loading" : count.exact ? `${count.n}${unit}` : `at least ${count.n}${unit}`;
  const tone = !known || !count.exact ? "unk" : (count.tone ?? "acc");
  return (
    <span className={`badge ${tone}`}>
      <span aria-hidden="true">{text}</span>
      <span className="vh">, {spoken}</span>
    </span>
  );
}
