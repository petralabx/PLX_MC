// Every create path defaults the kind (TASK-2634): the real actionCreateTask
// and createTask run; only database, seeding and ACL seams are faked.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpIdentity } from "@/lib/mcp/auth";
import { taskCreatePayloadHash } from "@/lib/mcp/task-create-idempotency";

const db = vi.hoisted(() => ({ tasks: [] as { labels: string[] }[] }));

vi.mock("@/lib/db", () => ({
  withTransaction: async <T>(fn: (q: unknown) => Promise<T>) =>
    fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("nextval")) return [{ next_id: 700 + db.tasks.length }];
      if (sql.includes("INSERT INTO entities")) {
        db.tasks.push(JSON.parse(String(params[1])));
        return [{ id: params[0] }];
      }
      return [];
    }),
}));
vi.mock("@/lib/sync/engine", () => ({
  ensureSeeded: vi.fn(async () => true),
  ensureReposSeeded: vi.fn(async () => true),
  ensureBucketsSeeded: vi.fn(async () => true),
}));
vi.mock("@/lib/sync/repo", () => ({
  stamp: () => "2026.10.11 · 00:00",
  getRepos: vi.fn(async () => []),
  getBuckets: vi.fn(async () => [{ id: "BKT-OPS", project: null, name: "Ops" }]),
  getProjects: vi.fn(async () => []),
  getEntity: vi.fn(async () => null),
}));
vi.mock("@/lib/mcp/sync-meta", () => ({ syncMetaForTask: vi.fn(async () => ({ status: "queued" })) }));
vi.mock("@/lib/permissions/project-acl-guard", () => ({
  assertBucketProjectAccess: async () => undefined,
  assertTaskProjectAccess: async () => undefined,
}));
vi.mock("@/lib/routing/mutations/actors", () => ({
  requireMcpActor: vi.fn(() => ({ actor: {}, actorId: "sp_mcp_cursor", actorKind: "service", auditLabel: "vince@petrasoap.com" })),
  aclPrincipalFromMcp: () => ({ tokens: ["sp_mcp_cursor"] }),
}));

import { actionCreateTask } from "@/lib/mcp/actions";
import { createTask } from "@/lib/sync";

const identity: McpIdentity = {
  operatorEmail: "vince@petrasoap.com", runtime: "cursor", workerId: "kind-test",
  repo: "petralabx/PLX_MC", servicePrincipalId: "sp_mcp_cursor",
  actor: { kind: "service", id: "sp_mcp_cursor", status: "active" },
};
const create = (extra: Record<string, unknown> = {}) =>
  actionCreateTask(identity, { title: "T", bucket: "BKT-OPS", reporter: "x", ...extra });

beforeEach(() => { db.tasks.length = 0; });

describe("actionCreateTask kind", () => {
  it("defaults a task with no labels to kind:needs-review and never rejects a missing kind", async () => {
    const { task } = await create();
    expect(task.labels).toEqual(["kind:needs-review"]);
    expect(db.tasks[0].labels).toEqual(["kind:needs-review"]);
  });

  it("applies kind:code from the kind param and keeps passed labels", async () => {
    expect((await create({ kind: "code" })).task.labels).toEqual(["kind:code"]);
    expect((await create({ labels: ["Lane:Dev"], kind: "decision" })).task.labels).toEqual(["lane:dev", "kind:decision"]);
  });

  it("accepts an agreeing kind label, and defaults when only other labels are passed", async () => {
    expect((await create({ labels: ["kind:code"], kind: "code" })).task.labels).toEqual(["kind:code"]);
    expect((await create({ labels: ["api"] })).task.labels).toEqual(["api", "kind:needs-review"]);
  });

  it("returns 400 when kind and a kind label disagree, and for two kinds or an unknown kind", async () => {
    await expect(create({ labels: ["kind:decision"], kind: "code" })).rejects.toMatchObject({ code: "invalid_request", status: 400 });
    await expect(create({ labels: ["kind:code", "kind:decision"] })).rejects.toMatchObject({ status: 400 });
    await expect(create({ labels: ["kind:banana"] })).rejects.toMatchObject({ status: 400 });
    expect(db.tasks).toEqual([]);
  });

  // TASK-4200: uat:stale comes only from the portal's closeStale on a merged
  // UAT ticket task, so no task is ever created with it.
  it("refuses a uat:stale label with 403, in any case and with spaces", async () => {
    for (const labels of [["kind:code", "uat:cmfb7q2xk0001", "uat:stale"], ["UAT:Stale"], [" uat:stale "]]) {
      await expect(create({ labels, kind: "code" })).rejects.toMatchObject({
        code: "forbidden",
        status: 403,
        message: expect.stringContaining("closeStale"),
      });
    }
    expect(db.tasks).toEqual([]);
  });

  // TASK-4286: a UAT ticket task starts before merged. Only its PR's merge moves it
  // to merged, and only the portal's verify to verified, so no create starts there:
  // not the MCP and REST door (actionCreateTask), nor the web door (createTask).
  it("refuses a UAT ticket task created at merged or verified with 403 and writes nothing", async () => {
    const cases: [{ labels: string[]; kind?: "code" }, "merged" | "verified"][] = [
      [{ labels: ["uat:cmfb7q2xk0001"], kind: "code" }, "verified"],
      [{ labels: ["kind:code", "uat:cmfb7q2xk0001"] }, "merged"],
    ];
    for (const [extra, stage] of cases) {
      await expect(create({ ...extra, stage })).rejects.toMatchObject({ code: "forbidden", status: 403 });
      await expect(createTask({ title: "T", bucket: "BKT-OPS", reporter: "vince@petrasoap.com", ...extra, stage }))
        .rejects.toMatchObject({ code: "forbidden", status: 403, message: expect.stringContaining("UAT ticket task") });
    }
    expect(db.tasks).toEqual([]);
  });

  it("still creates a UAT ticket task at a working stage, and any other task at verified", async () => {
    expect((await create({ labels: ["uat:cmfb7q2xk0001"], kind: "code", stage: "progress" })).task.stage).toBe("progress");
    expect((await create({ kind: "code", stage: "verified" })).task.stage).toBe("verified");
    expect(db.tasks).toHaveLength(2);
  });
});

describe("taskCreatePayloadHash", () => {
  // A replay whose hash differs gets 409 idempotency_key_reused (covered in
  // mcp-task-create-idempotency.test.ts); so kind and labels must change the hash.
  const base = { title: "T", bucket: "BKT-OPS" };
  it("differs when kind or labels differ, and is stable otherwise", () => {
    const none = taskCreatePayloadHash(base);
    const code = taskCreatePayloadHash({ ...base, kind: "code" });
    expect(code).not.toBe(none);
    expect(taskCreatePayloadHash({ ...base, kind: "decision" })).not.toBe(code);
    expect(taskCreatePayloadHash({ ...base, labels: ["kind:code"] })).not.toBe(none);
    expect(taskCreatePayloadHash({ kind: "code", ...base, reporter: "someone" })).toBe(code);
  });
});
