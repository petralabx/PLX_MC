// TASK-3743 backfill: fixture-driven, no database. A tiny in-memory client
// stands in for pg so dry run / apply / idempotency are exercised end to end.
import { describe, expect, it } from "vitest";
import { formatReport, planLinks, runBackfill, runGuarded } from "../scripts/backfill-open-pr-links.mjs";
import { parseApprovedSpec } from "../scripts/lib/db-identity.mjs";

type Ev = { seq: number; ts: string; kind: string; repo: string; pr: string; task_id: string | null; payload: Record<string, unknown> };
type PrRow = { repo: string; num: number; status: string; title: string };
type TaskRow = { id: string; data: { stage: string; prs?: PrRow[] } };

// Event n is logged on 2026-10-n, so a candidate's newest event date is easy to read.
const ev = (seq: number, kind: string, repo: string, pr: number, taskId: string | null, payload: Record<string, unknown> = {}): Ev => ({
  seq,
  ts: new Date(Date.UTC(2026, 9, seq, 12)).toISOString(),
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
  { taskId: "TASK-1", repo: "PLX_MC", num: 10, status: "open", title: "Ten", lastEventAt: "2026-10-01" },
  { taskId: "TASK-2", repo: "plx-customer-portal", num: 10, status: "open", title: "Portal ten", lastEventAt: "2026-10-07" },
  { taskId: "TASK-5", repo: "plx-customer-portal", num: 10, status: "open", title: "Portal ten", lastEventAt: "2026-10-07" },
  { taskId: "TASK-5", repo: "PLX_MC", num: 18, status: "open", title: "Eighteen again", lastEventAt: "2026-10-14" },
];

describe("planLinks", () => {
  const plan = planLinks(fixtureTasks(), events);

  it("links each currently open PR to every task its open events name", () => {
    expect(plan.links).toEqual(EXPECTED_LINKS);
  });

  it("lists what it skips, with a reason, and counts unrouted open PRs", () => {
    expect(plan.skipped).toEqual([
      { taskId: "TASK-3", repo: "plx_mc", num: 14, reason: "already linked", lastEventAt: "2026-10-08" },
      { taskId: "TASK-4", repo: "PLX_MC", num: 15, reason: "task cancelled", lastEventAt: "2026-10-09" },
      { taskId: "TASK-404", repo: "PLX_MC", num: 16, reason: "task not found", lastEventAt: "2026-10-10" },
    ]);
    expect(plan.unrouted).toBe(1);
  });

  it("treats a PR marked ready for review as open, linked to the tasks that event names", () => {
    const ready = [
      ev(1, "pr.opened", "PLX_MC", 20, null, { title: "Draft", taskIds: [] }),
      ev(2, "pr.ready_for_review", "PLX_MC", 20, "TASK-1", { title: "Ready", taskIds: ["TASK-1"] }),
    ];
    expect(planLinks(fixtureTasks(), ready).links).toEqual([
      { taskId: "TASK-1", repo: "PLX_MC", num: 20, status: "open", title: "Ready", lastEventAt: "2026-10-02" },
    ]);
  });

  it("links only a PR GitHub still shows open; a closed or unreadable PR is skipped", () => {
    const live = new Map<string, boolean | null>([
      ["plx_mc#10", false],
      ["plx-customer-portal#10", null],
      ["plx_mc#18", true],
    ]);
    const checked = planLinks(fixtureTasks(), events, live);
    expect(checked.links).toEqual([EXPECTED_LINKS[3]]);
    expect(checked.skipped.slice(0, 3)).toEqual([
      { taskId: "TASK-1", repo: "PLX_MC", num: 10, reason: "closed on GitHub", lastEventAt: "2026-10-01" },
      { taskId: "TASK-2", repo: "plx-customer-portal", num: 10, reason: "live state unknown", lastEventAt: "2026-10-07" },
      { taskId: "TASK-5", repo: "plx-customer-portal", num: 10, reason: "live state unknown", lastEventAt: "2026-10-07" },
    ]);
  });
});

// GitHub as the gh CLI would answer, by full slug; every call is recorded.
function fakeGithub(closed: string[] = []) {
  const calls: string[] = [];
  return {
    calls,
    prIsOpen: (slug: string, num: number) => {
      calls.push(`${slug}#${num}`);
      return !closed.includes(`${slug}#${num}`);
    },
  };
}

const REGISTRY = [
  { name: "PLX_MC", owner: "petralabx" },
  { name: "plx-customer-portal", owner: "petralabx" },
];

function fakeDb(tasks: TaskRow[] = fixtureTasks(), repos: { name: string; owner: string }[] = REGISTRY) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const updates: { sql: string; params: unknown[] }[] = [];
  return {
    byId,
    updates,
    async query(sql: string, params: unknown[] = []) {
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [], rowCount: 0 };
      if (/current_database\(\)/.test(sql)) return { rows: [{ db: "plx_mc", addr: null }], rowCount: 1 };
      if (/FROM mc_events/.test(sql)) return { rows: events, rowCount: events.length };
      if (/SELECT name, owner FROM repos/.test(sql)) return { rows: repos, rowCount: repos.length };
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
    const gh = fakeGithub();
    const report = await runBackfill(db, { prIsOpen: gh.prIsOpen });
    expect(report.apply).toBe(false);
    expect(report.updated).toBe(0);
    expect(report.links).toEqual(EXPECTED_LINKS);
    expect(db.updates).toEqual([]);
    expect(db.byId.get("TASK-1")!.data.prs).toEqual([]);
    const text = formatReport(report, "uat");
    expect(text).toMatch(/DRY RUN/);
    expect(text).toMatch(/to link: 4/);
    expect(text).toMatch(/TASK-1 <- PLX_MC#10 \(open, last event 2026-10-01\) Ten/);
    expect(text).toMatch(/TASK-5 <- PLX_MC#18 \(open, last event 2026-10-14\) Eighteen again/);
    expect(text).toMatch(/TASK-404 <- PLX_MC#16: task not found \(last event 2026-10-10\)/);
    expect(text).toMatch(/no rows written \(pass --apply to write\)/);
    // One live read per PR that still has a task to link, by full slug. Already
    // linked (#14), cancelled (#15), unknown-task (#16) and unrouted (#17) PRs are not read.
    expect(gh.calls).toEqual(["petralabx/PLX_MC#10", "petralabx/plx-customer-portal#10", "petralabx/PLX_MC#18"]);
  });

  it("asks GitHub nothing on a second --apply, and never guesses the owner of a shared repo name", async () => {
    const db = fakeDb();
    const gh = fakeGithub();
    await runBackfill(db, { apply: true, prIsOpen: gh.prIsOpen });
    gh.calls.length = 0;
    await runBackfill(db, { apply: true, prIsOpen: gh.prIsOpen });
    expect(gh.calls).toEqual([]);

    const shared = fakeDb(fixtureTasks(), [
      { name: "PLX_MC", owner: "petralabx" },
      { name: "plx-customer-portal", owner: "petralabx" },
      { name: "plx-customer-portal", owner: "taylorvalton" },
    ]);
    const report = await runBackfill(shared, { prIsOpen: fakeGithub().prIsOpen });
    expect(report.skipped.filter((s) => s.reason === "live state unknown").map((s) => `${s.taskId} ${s.repo}#${s.num}`)).toEqual([
      "TASK-2 plx-customer-portal#10",
      "TASK-5 plx-customer-portal#10",
    ]);
  });

  it("skips a PR the event log calls open but GitHub shows closed, dry run and apply alike", async () => {
    const db = fakeDb();
    const gh = fakeGithub(["petralabx/PLX_MC#10"]);
    const dry = await runBackfill(db, { prIsOpen: gh.prIsOpen });
    expect(formatReport(dry, "uat")).toMatch(/TASK-1 <- PLX_MC#10: closed on GitHub \(last event 2026-10-01\)/);
    const applied = await runBackfill(db, { apply: true, prIsOpen: gh.prIsOpen });
    expect(applied.updated).toBe(3);
    expect(db.byId.get("TASK-1")!.data.prs).toEqual([]);
  });

  it("--apply links each PR once; a second --apply changes 0 rows", async () => {
    const db = fakeDb();
    const { prIsOpen } = fakeGithub();
    const first = await runBackfill(db, { apply: true, prIsOpen });
    expect(first.updated).toBe(4);
    expect(db.byId.get("TASK-5")!.data.prs).toEqual([
      { repo: "plx-customer-portal", num: 10, status: "open", title: "Portal ten" },
      { repo: "PLX_MC", num: 18, status: "open", title: "Eighteen again" },
    ]);
    expect(db.byId.get("TASK-3")!.data.prs).toEqual([{ repo: "PLX_MC", num: 14, status: "merged", title: "done" }]);
    const second = await runBackfill(db, { apply: true, prIsOpen });
    expect(second.links).toEqual([]);
    expect(second.updated).toBe(0);
  });

  it("writes one parameterized UPDATE per link, bounded to that task and re-checked in SQL", async () => {
    const db = fakeDb();
    await runBackfill(db, { apply: true, prIsOpen: fakeGithub().prIsOpen });
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
