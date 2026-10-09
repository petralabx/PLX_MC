// Offline repository fixture. It evaluates bound search inputs; SQL structure
// is asserted separately. This is not a PostgreSQL integration test.
import type { Task } from "@/lib/mc-data";
import type { TaskSearchFilter } from "@/lib/sync/task-search";

export function legacySearchFixture(tasks: Task[], filter: TaskSearchFilter, hidden: string[] = []) {
  const q = filter.query?.toLowerCase();
  const matched = tasks.filter((t) => !hidden.includes(t.bucket)
    && (!filter.bucket || t.bucket === filter.bucket)
    && (!filter.stage || t.stage === filter.stage)
    && (!filter.label || t.labels?.includes(filter.label))
    && (!filter.assignee || t.assignee?.trim().toLowerCase() === filter.assignee.toLowerCase())
    && (!q || [t.id, t.title, t.description ?? ""].some((text) => text.toLowerCase().includes(q))));
  return { tasks: matched.slice(0, filter.limit), total: matched.length, nextCursor: null };
}

export type FixtureTask = Task & { createdAt: string; updatedAt: string; completedAt?: string | null };
const key = (task: Task): [string, string] => [task.id.match(/^TASK-(\d+)$/)?.[1] ?? "0", task.id];
const compare = (a: [string, string], b: [string, string]) => {
  const n = BigInt(a[0]) - BigInt(b[0]);
  return n === BigInt(0) ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : n < BigInt(0) ? -1 : 1;
};
export function fixtureQuery(tasks: FixtureTask[], sql: string, params: unknown[]) {
  const value = (pattern: RegExp) => {
    const match = sql.match(pattern);
    return match ? params[Number(match[1]) - 1] : undefined;
  };
  const at = value(/COALESCE\(\$(\d+)::timestamptz/) as string ?? "2026-10-07T23:00:00.000000Z";
  const hidden = value(/ANY\(\$(\d+)::text\[\]/) as string[] ?? [];
  const bucket = value(/data->>'bucket' = \$(\d+)/);
  const stage = value(/data->>'stage' = \$(\d+)/);
  const label = value(/'\[\]'::jsonb\) \? \$(\d+)/);
  const assignee = value(/= lower\(\$(\d+)\)/) as string | undefined;
  const q = value(/strpos\(lower\(id\), \$(\d+)\)/) as string | undefined;
  const upperMatch = sql.match(/<= \(\$(\d+)::numeric, \$(\d+)::text/);
  const afterMatch = sql.match(/> \(\$(\d+)::numeric, \$(\d+)::text/);
  const readKey = (m: RegExpMatchArray): [string, string] => [String(params[Number(m[1]) - 1]), String(params[Number(m[2]) - 1])];
  const tokens = (text: string): string[] => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const fullText = (texts: string[]) => {
    const words = tokens(texts.join(" "));
    const wanted = tokens(q ?? "");
    return wanted.length > 0 && wanted.every((word) => words.includes(word));
  };
  const filtered = tasks.flatMap((t) => {
    if (hidden.includes(t.bucket) || t.createdAt > at || bucket && t.bucket !== bucket
      || stage && t.stage !== stage || label && !t.labels.includes(String(label))
      || assignee && t.assignee?.trim().toLowerCase() !== assignee.toLowerCase()
      || upperMatch && compare(key(t), readKey(upperMatch)) > 0) return [];
    const matchFields: string[] = [];
    if (q) {
      if (t.id.toLowerCase().includes(q)) matchFields.push("id");
      for (const field of ["title", "description"] as const) {
        if (sql.includes(`THEN '${field}'`) && (t[field] ?? "").toLowerCase().includes(q)) matchFields.push(field);
      }
      if (sql.includes("THEN 'comments'") && fullText((t.comments ?? []).map((c) => c.body))) matchFields.push("comments");
      if (sql.includes("THEN 'activity'") && fullText((t.activity ?? []).map((a) => a.what))) matchFields.push("activity");
      if (sql.includes("THEN 'notes'") && fullText((t.comments ?? []).filter((c) => c.id.startsWith("mcp-")).map((c) => c.body))) matchFields.push("notes");
      if (!matchFields.length) return [];
    }
    const task = sql.includes("'updatedAt', to_char")
      ? { id: t.id, title: t.title, stage: t.stage, bucket: t.bucket, labels: t.labels, prs: t.prs, updatedAt: t.updatedAt, ...("completedAt" in t ? { completedAt: t.completedAt } : {}) }
      : { ...t };
    return [{ task: { ...task, ...(q ? { matchFields } : {}) }, key: key(t) }];
  }).sort((a, b) => compare(a.key, b.key));
  const pageLimit = Number(value(/LIMIT \$(\d+)/));
  const page = filtered.filter((r) => !afterMatch || compare(r.key, readKey(afterMatch)) > 0).slice(0, pageLimit);
  return [{ total: String(filtered.length), at, upper: filtered.at(-1)?.key ?? null, page }];
}
