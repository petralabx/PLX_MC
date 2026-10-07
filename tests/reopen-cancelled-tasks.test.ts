// TASK-2529 rollback step 1: the reopen script is dry-run by default and
// idempotent. Fixture-driven; a tiny in-memory client stands in for pg, so
// nothing here touches a database.
import { describe, expect, it } from "vitest";
import { parseApprovedSpec } from "../scripts/lib/db-identity.mjs";
import { formatReport, planReopen, runGuarded, runReopen } from "../scripts/reopen-cancelled-tasks.mjs";

type Row = { id: string; data: { stage: string }; cancellation: Record<string, unknown> | null };

const rows = (): Row[] => [
  { id: "TASK-1544", data: { stage: "cancelled" }, cancellation: { reason: "obsolete" } },
  { id: "TASK-2360", data: { stage: "cancelled" }, cancellation: { reason: "duplicate" } },
  { id: "TASK-622", data: { stage: "cancelled" }, cancellation: { reason: "delivered_without_pr" } },
  { id: "TASK-9", data: { stage: "progress" }, cancellation: { reason: "obsolete" } }, // stray value
];
const events = [
  { seq: 1, task_id: "TASK-1544", payload: { previousStage: "qa" } },
  { seq: 2, task_id: "TASK-2360", payload: { previousStage: "review" } },
  { seq: 3, task_id: "TASK-2360", payload: { previousStage: "planned" } }, // cancelled twice: latest wins
  { seq: 4, task_id: "TASK-622", payload: { previousStage: "merged" } }, // a terminal "previous" is never restored
];

function fakeDb() {
  const state = rows();
  const writes: string[] = [];
  return {
    state,
    writes,
    async query(sql: string, params: unknown[] = []) {
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [], rowCount: 0 };
      if (/FROM entities/.test(sql) && /^\s*SELECT/.test(sql)) {
        return { rows: state.filter((r) => r.data.stage === "cancelled" || r.cancellation != null), rowCount: 0 };
      }
      if (/FROM mc_events/.test(sql)) return { rows: events, rowCount: events.length };
      if (/^\s*UPDATE entities/.test(sql)) {
        const [id, stage] = params as [string, string | undefined];
        const r = state.find((x) => x.id === id)!;
        if (/data->>'stage' = 'cancelled'/.test(sql)) {
          if (r.data.stage !== "cancelled") return { rows: [], rowCount: 0 };
          r.data.stage = stage!;
        } else if (r.cancellation == null) {
          return { rows: [], rowCount: 0 };
        }
        r.cancellation = null;
        writes.push(id);
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
}

describe("planReopen", () => {
  const plan = planReopen(rows(), events);
  const byId = Object.fromEntries(plan.map((p: { id: string }) => [p.id, p]));

  it("restores the stage recorded by the latest cancel event", () => {
    expect(byId["TASK-1544"]).toMatchObject({ from: "cancelled", to: "qa", source: "cancel_event" });
    expect(byId["TASK-2360"]).toMatchObject({ to: "planned" });
  });

  it("never restores a terminal stage: falls back to backlog", () => {
    expect(byId["TASK-622"]).toMatchObject({ to: "backlog", source: "default" });
  });

  it("only nulls a stray cancellation on a task that is not cancelled", () => {
    expect(byId["TASK-9"]).toMatchObject({ clearOnly: true, from: "progress", to: "progress" });
  });
});

describe("runReopen", () => {
  it("dry run (default) writes nothing", async () => {
    const db = fakeDb();
    const report = await runReopen(db);
    expect(report.apply).toBe(false);
    expect(report.updated).toBe(0);
    expect(db.writes).toEqual([]);
    expect(formatReport(report, "uat")).toMatch(/DRY RUN[\s\S]*to reopen: 4[\s\S]*TASK-1544: cancelled -> qa[\s\S]*no rows written/);
  });

  it("--apply reopens and clears cancellation; a second --apply changes 0 rows", async () => {
    const db = fakeDb();
    const first = await runReopen(db, { apply: true });
    expect(first.updated).toBe(4);
    expect(db.state.map((r) => [r.id, r.data.stage, r.cancellation])).toEqual([
      ["TASK-1544", "qa", null],
      ["TASK-2360", "planned", null],
      ["TASK-622", "backlog", null],
      ["TASK-9", "progress", null],
    ]);
    const second = await runReopen(db, { apply: true });
    expect(second.plan).toEqual([]);
    expect(second.updated).toBe(0);
  });

  it("the SQL clears cancellation, re-queues the row, never touches completed_at, and is task-only", async () => {
    const seen: string[] = [];
    await runReopen({ query: async (sql: string) => { seen.push(sql); return { rows: rows().slice(0, 1), rowCount: 1 }; } }, { apply: true });
    const update = seen.find((s) => /^\s*UPDATE entities\s+SET data/.test(s))!;
    expect(update).toMatch(/cancellation = NULL/);
    expect(update).toMatch(/sync_state = 'pending'/);
    expect(update).toMatch(/entity_type = 'task'/);
    expect(update).not.toMatch(/completed_at/);
  });
});

// P1 (Astra): the label + URL-substring check passed the TOOLS.md runtime DB
// (plx_mc on plx-postgres-staging) for `--env staging`. Identity is now verified.
describe("runGuarded — positive non-production database identity", () => {
  const UAT_URL = "postgres://u:p@plx-uat-db.example.internal:5432/plx_mc_uat";
  const RUNTIME_URL = "postgres://u:p@plx-postgres-staging.abc.us-east-1.rds.amazonaws.com:5432/plx_mc";

  // fakeDb plus a server that reports current_database().
  function identityDb(name: string | null) {
    const db = fakeDb();
    const inner = db.query.bind(db);
    const seen: string[] = [];
    return Object.assign(db, {
      seen,
      query: async (sql: string, params: unknown[] = []) => {
        seen.push(sql);
        if (/current_database\(\)/.test(sql)) return { rows: name ? [{ db: name, addr: "10.0.0.5" }] : [], rowCount: 1 };
        return inner(sql, params);
      },
    });
  }

  it("refuses the runtime DB even though its URL has no 'prod' and the run is labelled staging", async () => {
    const db = identityDb("plx_mc");
    await expect(
      runGuarded(db, { url: RUNTIME_URL, approvedDb: parseApprovedSpec("plx_mc@plx-postgres-staging.abc.us-east-1.rds.amazonaws.com"), apply: true })
    ).rejects.toThrow(/runtime database/);
    expect(db.writes).toEqual([]);
    expect(db.seen.some((s) => /entities|mc_events|UPDATE/.test(s))).toBe(false);
  });

  it("refuses when the approved identity is missing or malformed", async () => {
    for (const approvedDb of [undefined, {}]) {
      const db = identityDb("plx_mc_uat");
      await expect(runGuarded(db, { url: UAT_URL, approvedDb, apply: true })).rejects.toThrow(/approved-db/);
      expect(db.writes).toEqual([]);
    }
    for (const raw of ["", "plx_mc_uat", "a@b@c"]) expect(() => parseApprovedSpec(raw)).toThrow(/approved-db/);
  });

  it("refuses when the URL host differs from the approved host", async () => {
    const db = identityDb("plx_mc_uat");
    await expect(
      runGuarded(db, { url: RUNTIME_URL, approvedDb: parseApprovedSpec("plx_mc_uat@plx-uat-db.example.internal"), apply: true })
    ).rejects.toThrow(/runtime database|not the approved/);
    expect(db.writes).toEqual([]);
  });

  it("refuses when the server reports a different database than approved", async () => {
    const db = identityDb("plx_mc");
    await expect(
      runGuarded(db, { url: UAT_URL, approvedDb: parseApprovedSpec("plx_mc_uat@plx-uat-db.example.internal"), apply: true })
    ).rejects.toThrow(/not the approved/);
    expect(db.writes).toEqual([]);
  });

  it("refuses when the identity cannot be read", async () => {
    const db = identityDb(null);
    await expect(
      runGuarded(db, { url: UAT_URL, approvedDb: parseApprovedSpec("plx_mc_uat@plx-uat-db.example.internal"), apply: true })
    ).rejects.toThrow(/Cannot establish DB identity/);
    expect(db.writes).toEqual([]);
  });

  it("accepts an approved identity; dry run stays the default and --apply writes", async () => {
    const approvedDb = parseApprovedSpec("plx_mc_uat@plx-uat-db.example.internal");
    const dry = identityDb("plx_mc_uat");
    const report = await runGuarded(dry, { url: UAT_URL, approvedDb });
    expect(report.apply).toBe(false);
    expect(dry.writes).toEqual([]);
    const live = identityDb("plx_mc_uat");
    expect((await runGuarded(live, { url: UAT_URL, approvedDb, apply: true })).updated).toBe(4);
  });
});
