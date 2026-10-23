// TASK-3743 backfill: fixture-driven, no database. A tiny in-memory client
// stands in for pg so dry run / apply / idempotency are exercised end to end.
import { describe, expect, it } from "vitest";
import { formatReport, planLinks, runBackfill, runGuarded } from "../scripts/backfill-open-pr-links.mjs";
import { parseApprovedSpec } from "../scripts/lib/db-identity.mjs";

type Ev = { seq: number; kind: string; repo: string; pr: string; task_id: string | null; payload: Record<string, unknown> };
type PrRow = { repo: string; num: number; status: string; title: string };
type TaskRow = { id: string; data: { stage: string; prs?: PrRow[] } };

const ev = (seq: number, kind: string, repo: string, pr: number, taskId: string | null, payload: Record<string, unknown> = {}): Ev => ({
  seq,
  kind,
  repo,
  pr: String(pr),
  task_id: taskId,
  payload,
});

function fixtureTasks(): TaskRow[] {
  return [
    { id: "TASK-1", data: { stage: "progress", prs: [] } },
    { id: "TASK-2", data: { stage: "planned" } }, // no prs key yet
    { id: "TASK-3", data: { stage: "progress", prs: [{ repo: "PLX_MC", num: 14, status: "merged", title: "done" }] } },
    { id: "TASK-4", data: { stage: "cancelled", prs: [] } },
    { id: "TASK-5", data: { stage: "progress", prs: [] } },
  ];
}

const events: Ev[] = [
  // Open PR, one task.
  ev(1, "pr.opened", "PLX_MC", 10, "TASK-1", { title: "Ten", taskIds: ["TASK-1"] }),
  // Merged, and closed without merge: neither is open any more.
  ev(2, "pr.opened", "PLX_MC", 11, "TASK-1", { title: "Eleven", taskIds: ["TASK-1"] }),
  ev(3, "pr.merged", "PLX_MC", 11, "TASK-1", { taskIds: ["TASK-1"] }),
  ev(4, "pr.opened", "PLX_MC", 12, "TASK-2", { title: "Twelve", taskIds: ["TASK-2"] }),
  ev(5, "pr.closed", "PLX_MC", 12, "TASK-2"),
  // Multi-task PR in another repo with the same number; the newest title wins.
  ev(6, "pr.opened", "plx-customer-portal", 10, "TASK-2", { title: "Portal old", taskIds: ["TASK-2", "TASK-5"] }),
  ev(7, "pr.synchronized", "plx-customer-portal", 10, "TASK-2", { title: "Portal ten", taskIds: ["TASK-2", "TASK-5"] }),
  // Already on the task (repo case differs): the merged entry wins.
  ev(8, "pr.opened", "plx_mc", 14, "TASK-3", { title: "Fourteen", taskIds: ["TASK-3"] }),
  // Cancelled task, unknown task, unrouted PR.
  ev(9, "pr.opened", "PLX_MC", 15, "TASK-4", { title: "Fifteen", taskIds: ["TASK-4"] }),
  ev(10, "pr.opened", "PLX_MC", 16, "TASK-404", { title: "Sixteen", taskIds: ["TASK-404"] }),
  ev(11, "pr.opened", "PLX_MC", 17, null, { title: "Seventeen", taskIds: [] }),
  // Reopened after a close: only the tasks named since the reopen count.
  ev(12, "pr.opened", "PLX_MC", 18, "TASK-1", { title: "Eighteen", taskIds: ["TASK-1"] }),
  ev(13, "pr.closed", "PLX_MC", 18, "TASK-1"),
  ev(14, "pr.opened", "PLX_MC", 18, "TASK-5", { title: "Eighteen again", taskIds: ["TASK-5"] }),
];

const EXPECTED_LINKS = [
  { taskId: "TASK-1", repo: "PLX_MC", num: 10, status: "open", title: "Ten" },
  { taskId: "TASK-2", repo: "plx-customer-portal", num: 10, status: "open", title: "Portal ten" },
  { taskId: "TASK-5", repo: "plx-customer-portal", num: 10, status: "open", title: "Portal ten" },
  { taskId: "TASK-5", repo: "PLX_MC", num: 18, status: "open", title: "Eighteen again" },
];

describe("planLinks", () => {
  const plan = planLinks(fixtureTasks(), events);

  it("links each currently open PR to every task its open events name", () => {
    expect(plan.links).toEqual(EXPECTED_LINKS);
  });

  it("lists what it skips, with a reason, and counts unrouted open PRs", () => {
    expect(plan.skipped).toEqual([
      { taskId: "TASK-3", repo: "plx_mc", num: 14, reason: "already linked" },
      { taskId: "TASK-4", repo: "PLX_MC", num: 15, reason: "task cancelled" },
      { taskId: "TASK-404", repo: "PLX_MC", num: 16, reason: "task not found" },
    ]);
    expect(plan.unrouted).toBe(1);
  });
});

function fakeDb(tasks: TaskRow[] = fixtureTasks()) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const updates: { sql: string; params: unknown[] }[] = [];
  return {
    byId,
    updates,
    async query(sql: string, params: unknown[] = []) {
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [], rowCount: 0 };
      if (/current_database\(\)/.test(sql)) return { rows: [{ db: "plx_mc", addr: null }], rowCount: 1 };
      if (/FROM mc_events/.test(sql)) return { rows: events, rowCount: events.length };
      if (/FROM entities WHERE entity_type = 'task' AND id = ANY\(\$1::text\[\]\)/.test(sql)) {
        const ids = params[0] as string[];
        const rows = ids.flatMap((id) => (byId.has(id) ? [structuredClone(byId.get(id)!)] : []));
        return { rows, rowCount: rows.length };
      }
      if (/^\s*UPDATE entities/.test(sql)) {
        updates.push({ sql, params });
        const [id, linkJson, repo, num] = params as [string, string, string, string];
        const task = byId.get(id);
        const prs = task?.data.prs ?? [];
        const present = prs.some((p) => p.repo.toLowerCase() === repo.toLowerCase() && String(p.num) === num);
        if (!task || task.data.stage === "cancelled" || present) return { rows: [], rowCount: 0 };
        task.data.prs = [...prs, ...(JSON.parse(linkJson) as PrRow[])];
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
}

describe("runBackfill", () => {
  it("dry run (default) lists the PRs it would link and writes nothing", async () => {
    const db = fakeDb();
    const report = await runBackfill(db);
    expect(report.apply).toBe(false);
    expect(report.updated).toBe(0);
    expect(report.links).toEqual(EXPECTED_LINKS);
    expect(db.updates).toEqual([]);
    expect(db.byId.get("TASK-1")!.data.prs).toEqual([]);
    const text = formatReport(report, "uat");
    expect(text).toMatch(/DRY RUN/);
    expect(text).toMatch(/to link: 4/);
    expect(text).toMatch(/TASK-1 <- PLX_MC#10 \(open\) Ten/);
    expect(text).toMatch(/TASK-5 <- PLX_MC#18 \(open\) Eighteen again/);
    expect(text).toMatch(/no rows written \(pass --apply to write\)/);
  });

  it("--apply links each PR once; a second --apply changes 0 rows", async () => {
    const db = fakeDb();
    const first = await runBackfill(db, { apply: true });
    expect(first.updated).toBe(4);
    expect(db.byId.get("TASK-5")!.data.prs).toEqual([
      { repo: "plx-customer-portal", num: 10, status: "open", title: "Portal ten" },
      { repo: "PLX_MC", num: 18, status: "open", title: "Eighteen again" },
    ]);
    expect(db.byId.get("TASK-3")!.data.prs).toEqual([{ repo: "PLX_MC", num: 14, status: "merged", title: "done" }]);
    const second = await runBackfill(db, { apply: true });
    expect(second.links).toEqual([]);
    expect(second.updated).toBe(0);
  });

  it("writes one parameterized UPDATE per link, bounded to that task and re-checked in SQL", async () => {
    const db = fakeDb();
    await runBackfill(db, { apply: true });
    expect(db.updates).toHaveLength(4);
    for (const { sql } of db.updates) {
      expect(sql).toMatch(/WHERE entity_type = 'task' AND id = \$1/);
      expect(sql).toMatch(/IS DISTINCT FROM 'cancelled'/);
      expect(sql).toMatch(/NOT EXISTS/);
      expect(sql).not.toMatch(/TASK-|PLX_MC|plx-customer-portal/);
      expect(sql).not.toMatch(/sync_state|dirty_fields/); // prs[] is DB-only, never pushed
    }
  });
});

describe("runGuarded", () => {
  it("refuses the runtime database before reading anything", async () => {
    const db = fakeDb();
    const url = "postgres://u:p@plx-postgres-staging.abc.us-east-1.rds.amazonaws.com:5432/plx_mc";
    await expect(
      runGuarded(db, { url, approvedDb: parseApprovedSpec("plx_mc@plx-postgres-staging.abc.us-east-1.rds.amazonaws.com"), env: {} as NodeJS.ProcessEnv })
    ).rejects.toThrow(/runtime database/);
    expect(db.updates).toEqual([]);
  });
});
