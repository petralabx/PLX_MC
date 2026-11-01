// TASK-4005 (b): when a project's open task count reaches 0, its owner is asked to
// close it: a project.close_prompt event from the task change that closed the last
// open task, and a banner on the project screen (projectReadyToClose). Nothing ever
// closes the project on its own. The real patchTask, getEntity and updateEntity run
// against an in-memory entities table behind a fake @/lib/db.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  entity_type: string; id: string; data: Record<string, unknown>; sync_state: string;
  sp_item_id: string | null; dirty_fields: string[]; field_attribution: Record<string, unknown>;
  completed_at: string | null; cancellation: unknown;
};

const s = vi.hoisted(() => ({
  table: new Map<string, Row>(),
  events: [] as Record<string, unknown>[],
  buckets: [] as { id: string; name: string; project?: string | null; archivedAt?: string | null }[],
  projects: [] as { id: string; name: string; owner: string; status?: string; archivedAt?: string | null }[],
  failBuckets: false,
  sql: [] as string[],
}));

vi.mock("@/lib/db", () => {
  const key = (t: unknown, id: unknown) => `${String(t)}:${String(id)}`;
  const q = async (sql: string, p: unknown[] = []) => {
    const n = sql.replace(/\s+/g, " ").trim();
    if (n.includes("SAVEPOINT")) s.sql.push(n);
    if (n.startsWith("SELECT count(*) AS n FROM entities")) return [{ n: String(s.table.size) }];
    if (n.startsWith("SELECT entity_type, id, data") && n.includes("WHERE entity_type = $1 AND id = $2")) {
      const r = s.table.get(key(p[0], p[1]));
      return r ? [structuredClone(r)] : [];
    }
    if (n.startsWith("SELECT id, data->>'stage' AS stage, data->'labels' AS labels")) {
      const ids = p[0] as string[];
      return [...s.table.values()]
        .filter((r) => r.entity_type === "task" && ids.includes(String(r.data.bucket)))
        .map((r) => ({ id: r.id, stage: r.data.stage, labels: r.data.labels ?? null }));
    }
    if (n.startsWith("UPDATE entities SET data = $3")) {
      const r = s.table.get(key(p[0], p[1]));
      if (!r) return [];
      r.data = JSON.parse(String(p[2]));
      r.sync_state = String(p[3]);
      return [];
    }
    return [];
  };
  return { query: q, withTransaction: async (fn: (tx: typeof q) => Promise<unknown>) => fn((sql: string, p?: unknown[]) => q(sql, p)) };
});
vi.mock("@/lib/compliance/repo", () => ({
  appendEventTx: async (_q: unknown, e: Record<string, unknown>) => {
    s.events.push(e);
    return String(s.events.length);
  },
  appendEvent: async () => "1",
}));
vi.mock("@/lib/sync/repo", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  seedRepos: async () => undefined,
  getRepos: async () => [],
  getBuckets: async () => {
    if (s.failBuckets) throw new Error("db hiccup");
    return s.buckets;
  },
  getProjects: async () => s.projects,
  appendAudit: async () => undefined,
}));

import { projectReadyToClose, showProjectClosePrompt } from "@/lib/mc-data/policy";
import { patchTask } from "@/lib/sync/state";

const row = (id: string, data: Record<string, unknown>): Row => ({
  entity_type: "task", id, data, sync_state: "synced", sp_item_id: null, dirty_fields: [], field_attribution: {},
  completed_at: null, cancellation: null,
});
const MERGED_PR = [{ repo: "PLX_MC", num: 1, status: "merged", title: "fix", base: "main" }];
const putTask = (id: string, bucket: string, stage: string, labels: string[] = ["kind:code"]) =>
  s.table.set(`task:${id}`, row(id, { id, title: id, bucket, stage, priority: "medium", labels, accountableOwner: "vince", prs: MERGED_PR }));
// What the compliance projection sends when a task's PR merges.
const merge = (id: string) => patchTask(id, { stage: "merged" }, "compliance-projection", { complianceProjection: true });

beforeEach(() => {
  s.table.clear();
  s.events.length = 0;
  s.sql.length = 0;
  s.failBuckets = false;
  s.buckets = [
    { id: "BKT-A", name: "A", project: "PRJ-X" },
    { id: "BKT-B", name: "B", project: "PRJ-X" },
    { id: "BKT-OTHER", name: "Other", project: "PRJ-Y" },
  ];
  s.projects = [
    { id: "PRJ-X", name: "X", owner: "stephen" },
    { id: "PRJ-Y", name: "Y", owner: "ricardo" },
  ];
});

describe("project.close_prompt event", () => {
  it("is recorded once, by the change that closes the project's last open task", async () => {
    putTask("TASK-1", "BKT-A", "merged");
    putTask("TASK-2", "BKT-B", "review");
    putTask("TASK-3", "BKT-OTHER", "progress"); // another project's open task does not count
    await merge("TASK-2");
    expect(s.events).toEqual([
      expect.objectContaining({
        kind: "project.close_prompt",
        actor: "compliance-projection",
        taskId: "TASK-2",
        payload: { projectId: "PRJ-X", owner: "stephen", closedBy: "TASK-2", stage: "merged" },
      }),
    ]);
    // Re-staging an already closed task asks nothing again.
    await merge("TASK-2");
    expect(s.events).toHaveLength(1);
    // The project is not closed by the event.
    expect(s.projects[0].status).toBeUndefined();
  });

  it("never undoes the task change when the check fails: it rolls back to its savepoint", async () => {
    putTask("TASK-2", "BKT-B", "review");
    s.failBuckets = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(merge("TASK-2")).resolves.toMatchObject({ stage: "merged" });
    expect(s.events).toHaveLength(0);
    expect(s.sql).toEqual(["SAVEPOINT project_close_prompt", "ROLLBACK TO SAVEPOINT project_close_prompt"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[project-close-prompt] skipped for TASK-2: db hiccup"));
    warn.mockRestore();
  });

  it("is recorded when a labels-only change closes the last open task (closeStale's uat:stale)", async () => {
    const UAT = ["kind:code", "uat:R5JD2K", "uat-attempt:1"];
    putTask("TASK-1", "BKT-A", "merged");
    putTask("TASK-2", "BKT-B", "merged", UAT); // a merged UAT ticket awaiting re-test is open
    await patchTask("TASK-2", { labels: [...UAT, "uat:stale"] }, "portal", { uatStaleClose: true });
    expect(s.events).toEqual([expect.objectContaining({ kind: "project.close_prompt", taskId: "TASK-2" })]);
  });

  it("leaves archived buckets out, as the project page and mc_list_projects do", async () => {
    s.buckets.push({ id: "BKT-OLD", name: "Old", project: "PRJ-X", archivedAt: "2026-10-01T00:00:00Z" });
    putTask("TASK-9", "BKT-OLD", "backlog"); // open, but in an archived bucket
    putTask("TASK-2", "BKT-B", "review");
    await merge("TASK-2");
    expect(s.events).toEqual([expect.objectContaining({ kind: "project.close_prompt", taskId: "TASK-2" })]);
  });

  it("is not recorded while another task of the project is open", async () => {
    putTask("TASK-1", "BKT-A", "progress");
    putTask("TASK-2", "BKT-B", "review");
    await merge("TASK-2");
    expect(s.events).toHaveLength(0);
  });

  it("is not recorded for a closed or archived project", async () => {
    for (const project of [
      { id: "PRJ-X", name: "X", owner: "stephen", status: "closed" },
      { id: "PRJ-X", name: "X", owner: "stephen", archivedAt: "2026-10-01T00:00:00Z" },
    ]) {
      s.projects = [project];
      putTask("TASK-2", "BKT-B", "review");
      await merge("TASK-2");
    }
    expect(s.events).toHaveLength(0);
  });

  it("is not recorded when a merged UAT ticket still awaits its re-test", async () => {
    putTask("TASK-2", "BKT-B", "review", ["kind:code", "uat:R5JD2K", "uat-attempt:1"]);
    await merge("TASK-2");
    expect(s.events).toHaveLength(0);
  });
});

describe("showProjectClosePrompt (the project screen's banner)", () => {
  it("shows only to the project's owner", () => {
    const project = { owner: "stephen", status: "active" as const };
    const done = [{ stage: "merged" as const }];
    expect(showProjectClosePrompt(project, done, "stephen")).toBe(true);
    expect(showProjectClosePrompt(project, done, "ricardo")).toBe(false);
    expect(showProjectClosePrompt(project, done, null)).toBe(false);
    expect(showProjectClosePrompt({ owner: null, status: "active" }, done, "stephen")).toBe(false);
    expect(showProjectClosePrompt(project, [{ stage: "review" }], "stephen")).toBe(false);
  });
});

describe("projectReadyToClose (the project screen's banner)", () => {
  const active = { status: "active" as const };
  it("asks only for an active project with tasks, none of them open", () => {
    expect(projectReadyToClose(active, [{ stage: "merged" }, { stage: "cancelled" }, { stage: "verified" }])).toBe(true);
    expect(projectReadyToClose(active, [{ stage: "merged" }, { stage: "review" }])).toBe(false);
    expect(projectReadyToClose(active, [])).toBe(false);
    expect(projectReadyToClose({ status: "closed" }, [{ stage: "merged" }])).toBe(false);
    expect(projectReadyToClose({ archivedAt: "2026-10-01" }, [{ stage: "merged" }])).toBe(false);
    expect(projectReadyToClose(null, [{ stage: "merged" }])).toBe(false);
    // A merged UAT ticket task (kind:code + uat:<id>) awaits its re-test, so it is open.
    expect(projectReadyToClose(active, [{ stage: "merged", labels: ["kind:code", "uat:R5JD2K"] }])).toBe(false);
  });
});
