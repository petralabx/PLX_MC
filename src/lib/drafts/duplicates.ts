// Draft Projects (TASK-4059): likely duplicates of a draft's tasks among open
// tasks (PRD § Preflight). Submit adds each hit to the draft as a non-blocking
// finding raised by Mission Control, so reviewers see it. Pure and
// deterministic: a word-overlap score, not a search ranking.

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "into", "onto", "that", "this", "then", "than", "when", "what", "which",
  "add", "adds", "make", "use", "new", "via", "per", "all", "any", "not", "are", "its", "our", "your",
]);

/** Title words that carry meaning: lowercased, 3+ characters, no stop words. */
export function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
  );
}

/** Jaccard overlap of two token sets, 0 to 1. */
export function overlap(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** At or above this overlap, an open task is a likely duplicate. */
export const DUPLICATE_THRESHOLD = 0.6;
/** At most this many likely duplicates per draft task. */
export const MAX_DUPLICATES_PER_TASK = 3;

export interface OpenTaskTitle {
  id: string;
  title: string;
}

export interface DuplicateHit {
  key: string;
  taskId: string;
  title: string;
  score: number;
}

export function likelyDuplicates(
  draftTasks: readonly { key: string; title: string }[],
  openTasks: readonly OpenTaskTitle[]
): DuplicateHit[] {
  const open = openTasks.map((t) => ({ ...t, tokens: titleTokens(t.title) }));
  const hits: DuplicateHit[] = [];
  for (const task of draftTasks) {
    const tokens = titleTokens(task.title);
    if (tokens.size < 2) continue;
    const scored = open
      .map((t) => ({ key: task.key, taskId: t.id, title: t.title, score: overlap(tokens, t.tokens) }))
      .filter((h) => h.score >= DUPLICATE_THRESHOLD)
      .sort((x, y) => y.score - x.score || x.taskId.localeCompare(y.taskId))
      .slice(0, MAX_DUPLICATES_PER_TASK);
    hits.push(...scored);
  }
  return hits;
}
