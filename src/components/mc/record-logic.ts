import { isAgentId } from "@/lib/mc-data";
import type { FeedEvent, FileEntry, Repo, Task } from "@/lib/mc-data";

export function directionGlyph(direction: "two-way" | "push" | "pull"): string {
  if (direction === "push") return "→";
  if (direction === "pull") return "←";
  return "↔";
}

export function directionLabel(direction: "two-way" | "push" | "pull"): string {
  if (direction === "push") return "Push to SharePoint";
  if (direction === "pull") return "Pull from SharePoint";
  return "Two-way";
}

export function buildBreadcrumbPath(
  folderId: string | null,
  getById: (id: string) => FileEntry | undefined
): FileEntry[] {
  const out: FileEntry[] = [];
  const seen = new Set<string>();
  let cursor = folderId;
  while (cursor) {
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const entry = getById(cursor);
    if (!entry) break;
    out.unshift(entry);
    cursor = entry.parent;
  }
  return out;
}

export function sortFileEntries(entries: FileEntry[]): FileEntry[] {
  return [...entries].sort((a, b) => {
    if ((a.kind === "folder") !== (b.kind === "folder")) {
      return a.kind === "folder" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

export interface RepoPrRow {
  taskId: string;
  num: number;
  title: string;
  status: "open" | "merged" | "closed";
}

export interface RepoTaskRow {
  id: string;
  title: string;
  assignee: string | null;
  repoCount: number;
}

export interface RepoRowData {
  repo: Repo;
  openPrCount: number;
  prs: RepoPrRow[];
  tasks: RepoTaskRow[];
}

// Map a task-activity kind to a feed-event kind (the feed taxonomy is richer;
// most activity is a generic "run" entry, comments stay comments).
const FEED_KIND_FOR_ACTIVITY: Record<string, FeedEvent["kind"]> = {
  comment: "comment",
  move: "run",
};

const FEED_CHIP: Record<FeedEvent["kind"], string> = {
  run: "Activity",
  comment: "Comment",
  review: "Review",
  pr: "PR",
  shot: "Evidence",
  sync: "Sync",
  approve: "Approved",
  block: "Blocked",
};

// Derive the agent activity feed from REAL task events (EN-005 obs. #3): every
// task-activity entry authored by an agent becomes a feed event. Empty until
// agents actually pick up work — no fabricated feed.
export function deriveAgentFeed(tasks: Task[]): FeedEvent[] {
  const out: FeedEvent[] = [];
  for (const task of tasks) {
    for (const entry of task.activity) {
      if (!isAgentId(entry.who)) continue;
      const kind = FEED_KIND_FOR_ACTIVITY[entry.kind] ?? "run";
      out.push({
        age: entry.age,
        actor: entry.who,
        task: task.id,
        kind,
        text: entry.what,
        chip: FEED_CHIP[kind],
      });
    }
  }
  return out;
}

export function deriveRepoRows(repos: Record<string, Repo>, tasks: Task[]): RepoRowData[] {
  return Object.values(repos).map((repo) => {
    const taskRows = tasks
      .filter((task) => task.repos.includes(repo.id))
      .map((task) => ({
        id: task.id,
        title: task.title,
        assignee: task.assignee,
        repoCount: task.repos.length,
      }));

    const prs = tasks.flatMap((task) =>
      (task.prs ?? [])
        .filter((pr) => pr.repo === repo.id)
        .map((pr) => ({
          taskId: task.id,
          num: pr.num,
          title: pr.title,
          status: pr.status,
        }))
    );

    return {
      repo,
      openPrCount: prs.filter((pr) => pr.status === "open").length,
      prs,
      tasks: taskRows,
    };
  });
}
