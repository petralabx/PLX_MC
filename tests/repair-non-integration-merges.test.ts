// TASK-3797 repair: fixture-driven, no database. A tiny in-memory client stands
// in for pg, and a fake GitHub answers PR bases, so dry run / apply / idempotency
// are exercised end to end.
import { describe, expect, it } from "vitest";
import { formatReport, loadRegistry, planRepairs, runGuarded, runRepair } from "../scripts/repair-non-integration-merges.mjs";
import { parseApprovedSpec } from "../scripts/lib/db-identity.mjs";

type PrRow = { repo: string; num: number; status: string; title: string; base?: string };
type TaskRow = { id: string; data: { stage: string; prs?: PrRow[]; merge?: { sha: string; on: string }; activity?: { what: string }[] } };
type Ev = { seq: number; task_id: string | null; repo: string; pr: string };

const merged = (repo: string, num: number, base?: string): PrRow => ({ repo, num, status: "merged", title: `PR ${num}`, ...(base ? { base } : {}) });

function fixtureTasks(): TaskRow[] {
  return [
    // The two the 2026-10-23 UFL review found.
    { id: "TASK-3700", data: { stage: "merged", prs: [merged("plx-customer-portal", 2883)], merge: { sha: "a1", on: "2026-10-22" }, activity: [] } },
    { id: "TASK-3706", data: { stage: "merged", prs: [merged("PLX_MC", 406)], merge: { sha: "b2", on: "2026-10-23" } } },
    // One of its PRs reached staging: stays.
    { id: "TASK-3731", data: { stage: "merged", prs: [merged("plx-customer-portal", 2915), merged("plx-customer-portal", 2963)] } },
    // A TASK-3797 row that carries its base: stays, and GitHub is not asked.
    { id: "TASK-51", data: { stage: "merged", prs: [merged("PLX_MC", 500, "main")] } },
    // GitHub cannot read the base: stays.
    { id: "TASK-52", data: { stage: "merged", prs: [merged("PLX_MC", 501)] } },
    // Verified by the portal: never touched (the SELECT asks for merged only).
    { id: "TASK-53", data: { stage: "verified", prs: [merged("PLX_MC", 502)] } },
  ];
}

const events: Ev[] = [
  { seq: 1, task_id: "TASK-3700", repo: "plx-customer-portal", pr: "2883" },
  { seq: 2, task_id: "TASK-3706", repo: "PLX_MC", pr: "406" },
  { seq: 3, task_id: "TASK-3731", repo: "plx-customer-portal", pr: "2915" },
  { seq: 4, task_id: "TASK-51", repo: "PLX_MC", pr: "500" },
  { seq: 5, task_id: "TASK-52", repo: "PLX_MC", pr: "501" },
  { seq: 6, task_id: "TASK-53", repo: "PLX_MC", pr: "502" },
];

const BASES: Record<string, string | null> = {
  "petralabx/plx-customer-portal#2883": "task/TASK-3696",
  "petralabx/PLX_MC#406": "claude/ufl21-view",
  "petralabx/plx-customer-portal#2915": "staging",
  "petralabx/plx-customer-portal#2963": "staging",
  "petralabx/PLX_MC#501": null,
};

function fakeGithub() {
  const calls: string[] = [];
  return {
    calls,
    prBase(slug: string, num: number) {
      calls.push(`${slug}#${num}`);
      return BASES[`${slug}#${num}`] ?? null;
    },
  };
}

function fakeDb(tasks: TaskRow[] = fixtureTasks()) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const updates: { sql: string; params: unknown[] }[] = [];
  return {
    byId,
    updates,
    async query(sql: string, params: unknown[] = []) {
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [], rowCount: 0 };
      if (/current_database\(\)/.test(sql)) return { rows: [{ db: "plx_mc", addr: null }], rowCount: 1 };
      if (/FROM mc_events WHERE kind = 'task.promoted'/.test(sql)) return { rows: events, rowCount: events.length };
      if (/FROM entities WHERE entity_type = 'task' AND id = ANY\(\$1::text\[\]\) AND data->>'stage' = 'merged'/.test(sql)) {
        const rows = (params[0] as string[]).flatMap((id) => {
          const t = byId.get(id);
          return t && t.data.stage === "merged" ? [structuredClone(t)] : [];
        });
        return { rows, rowCount: rows.length };
      }
      if (/FROM entities WHERE entity_type = 'task' AND id = \$1 FOR UPDATE/.test(sql)) {
        const t = byId.get(params[0] as string);
        return t ? { rows: [structuredClone(t)], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (/^\s*UPDATE entities/.test(sql)) {
        updates.push({ sql, params });
        const [id, prsJson, activityJson] = params as [string, string, string];
        const task = byId.get(id);
        if (!task || task.data.stage !== "merged") return { rows: [], rowCount: 0 };
        const rest = { ...task.data };
        delete rest.merge; // the repair drops the DB-only merge field
        task.data = {
          ...rest,
          stage: "progress",
          prs: JSON.parse(prsJson) as PrRow[],
          activity: [...(task.data.activity ?? []), ...(JSON.parse(activityJson) as { what: string }[])],
        };
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
}

describe("loadRegistry", () => {
  it("maps each registry repo's bare name to its slug and integration branch", () => {
    const registry = loadRegistry();
    expect(registry.get("plx-customer-portal")).toEqual({ slug: "petralabx/plx-customer-portal", integrationBranch: "staging" });
    expect(registry.get("plx_mc")).toEqual({ slug: "petralabx/PLX_MC", integrationBranch: "main" });
  });

  it("never guesses between two owners of one repo name", () => {
    const registry = loadRegistry({ repos: [{ repo: "a/tool", integration_branch: "main" }, { repo: "b/tool", integration_branch: "dev" }] });
    expect(registry.get("tool")).toBeNull();
  });
});

describe("planRepairs", () => {
  it("plans only tasks whose merged PRs all went into another branch", () => {
    const plan = planRepairs(fixtureTasks().filter((t) => t.data.stage === "merged"), events, loadRegistry(), new Map([
      ["plx-customer-portal#2883", "task/TASK-3696"],
      ["plx_mc#406", "claude/ufl21-view"],
      ["plx-customer-portal#2915", "staging"],
      ["plx-customer-portal#2963", "staging"],
      ["plx_mc#501", null],
    ]));
    expect(plan.repairs.map((r) => r.taskId)).toEqual(["TASK-3700", "TASK-3706"]);
    expect(plan.kept).toEqual([
      { taskId: "TASK-51", reason: "PLX_MC#500 reached main" },
      { taskId: "TASK-52", reason: "base of PLX_MC#501 unknown" },
      { taskId: "TASK-3731", reason: "plx-customer-portal#2915 reached staging" },
    ]);
  });
});

describe("runRepair", () => {
  it("dry run (default) lists TASK-3700 and TASK-3706 and changes nothing", async () => {
    const db = fakeDb();
    const gh = fakeGithub();
    const report = await runRepair(db, { prBase: gh.prBase });
    expect(report.apply).toBe(false);
    expect(report.updated).toBe(0);
    expect(report.repairs.map((r) => r.taskId)).toEqual(["TASK-3700", "TASK-3706"]);
    expect(db.updates).toEqual([]);
    expect(db.byId.get("TASK-3700")!.data.stage).toBe("merged");
    const text = formatReport(report, "uat");
    expect(text).toMatch(/DRY RUN/);
    expect(text).toMatch(/to move back to In Progress: 2/);
    expect(text).toMatch(/TASK-3700: merged -> progress \(plx-customer-portal#2883 into task\/TASK-3696, not staging\)/);
    expect(text).toMatch(/TASK-3706: merged -> progress \(PLX_MC#406 into claude\/ufl21-view, not main\)/);
    expect(text).toMatch(/TASK-3731: plx-customer-portal#2915 reached staging/);
    expect(text).toMatch(/TASK-52: base of PLX_MC#501 unknown/);
    expect(text).toMatch(/no rows written \(pass --apply to write\)/);
    // GitHub is asked only for bases the rows lack; TASK-51's row carries "main".
    expect(gh.calls).not.toContain("petralabx/PLX_MC#500");
    expect(gh.calls).toContain("petralabx/plx-customer-portal#2883");
  });

  it("--apply moves each back to In Progress with its base recorded; a second --apply changes 0 rows", async () => {
    const db = fakeDb();
    const { prBase } = fakeGithub();
    const first = await runRepair(db, { apply: true, prBase });
    expect(first.updated).toBe(2);
    const t3700 = db.byId.get("TASK-3700")!.data;
    expect(t3700.stage).toBe("progress");
    expect(t3700.merge).toBeUndefined();
    expect(t3700.prs).toEqual([merged("plx-customer-portal", 2883, "task/TASK-3696")]);
    expect(t3700.activity?.at(-1)?.what).toBe(
      "Repair (TASK-3797): PR #2883 into task/TASK-3696, not the integration branch — moved back to In Progress"
    );
    expect(db.byId.get("TASK-3731")!.data.stage).toBe("merged");
    const second = await runRepair(db, { apply: true, prBase });
    expect(second.repairs).toEqual([]);
    expect(second.updated).toBe(0);
  });

  it("writes one parameterized UPDATE per task that re-checks the stage and re-queues it for SharePoint", async () => {
    const db = fakeDb();
    await runRepair(db, { apply: true, prBase: fakeGithub().prBase });
    expect(db.updates).toHaveLength(2);
    for (const { sql } of db.updates) {
      expect(sql).toMatch(/WHERE entity_type = 'task' AND id = \$1 AND data->>'stage' = 'merged'/);
      expect(sql).toMatch(/sync_state = 'pending'/);
      expect(sql).toMatch(/\["stage"\]/);
      expect(sql).not.toMatch(/completed_at/); // task 2528 write-once rule
      expect(sql).not.toMatch(/TASK-|PLX_MC|plx-customer-portal/);
    }
  });
});

describe("runRepair, against later changes", () => {
  it("writes the PR rows as they stand at write time, not as first read", async () => {
    const db = fakeDb();
    const { prBase } = fakeGithub();
    // A PR event lands on TASK-3700 between the plan read and the write.
    const slowBase = (slug: string, num: number) => {
      const t = db.byId.get("TASK-3700")!;
      t.data.prs = [...(t.data.prs ?? []).filter((p) => p.num !== 2999), { repo: "plx-customer-portal", num: 2999, status: "open", title: "New" }];
      return prBase(slug, num);
    };
    await runRepair(db, { apply: true, prBase: slowBase });
    expect(db.byId.get("TASK-3700")!.data.prs).toEqual([
      merged("plx-customer-portal", 2883, "task/TASK-3696"),
      { repo: "plx-customer-portal", num: 2999, status: "open", title: "New" },
    ]);
  });

  it("never repairs a task twice, so a person's later move back to Merged stands", async () => {
    const db = fakeDb();
    const { prBase } = fakeGithub();
    await runRepair(db, { apply: true, prBase });
    db.byId.get("TASK-3700")!.data.stage = "merged"; // moved back by a person
    const again = await runRepair(db, { apply: true, prBase });
    expect(again.repairs).toEqual([]);
    expect(again.kept).toContainEqual({ taskId: "TASK-3700", reason: "already repaired once" });
    expect(db.byId.get("TASK-3700")!.data.stage).toBe("merged");
  });
});

describe("runGuarded", () => {
  it("refuses the runtime database before reading anything", async () => {
    const db = fakeDb();
    const url = "postgres://u:p@plx-postgres-staging.abc.us-east-1.rds.amazonaws.com:5432/plx_mc";
    await expect(
      runGuarded(db, {
        url,
        approvedDb: parseApprovedSpec("plx_mc@plx-postgres-staging.abc.us-east-1.rds.amazonaws.com"),
        env: {} as NodeJS.ProcessEnv,
        prBase: fakeGithub().prBase,
      })
    ).rejects.toThrow(/runtime database/);
    expect(db.updates).toEqual([]);
  });
});
