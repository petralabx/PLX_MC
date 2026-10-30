// TASK-3963: a UAT ticket task (kind:code plus uat:<feedbackId>) is verified
// only through the portal's mc_update_task verify (TASK-3697). The web PATCH
// runs through the real patchTask, which refuses stage verified on a UAT ticket
// task with the same 403 as MCP and writes nothing. Non-UAT tasks are unchanged.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; data: Record<string, unknown>; dirty_fields: string[]; field_attribution: Record<string, unknown>; sp_item_id: string | null };

const h = vi.hoisted(() => ({
  tasks: new Map<string, Row>(),
  writes: [] as { id: string; data: Record<string, unknown> }[],
}));

vi.mock("@/lib/db", () => ({
  query: vi.fn(async () => []),
  withTransaction: vi.fn(async (fn: (q: unknown) => unknown) => fn(vi.fn(async () => []))),
}));
vi.mock("@/lib/sync/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sync/engine")>()),
  ensureSeeded: vi.fn(async () => true),
  ensureReposSeeded: vi.fn(async () => {}),
}));
vi.mock("@/lib/sync/repo", () => ({
  stamp: () => "2026.10.26 · 12:00",
  getRepos: async () => [],
  getEntity: async (_type: string, id: string) => (h.tasks.has(id) ? structuredClone(h.tasks.get(id)) : null),
  getBuckets: async () => [],
  getProjects: async () => [],
  updateEntity: vi.fn(async (_type: string, id: string, opts: { patch?: Record<string, unknown> }) => {
    h.writes.push({ id, data: opts.patch ?? {} });
    const row = h.tasks.get(id)!;
    row.data = { ...row.data, ...opts.patch };
  }),
  appendAudit: vi.fn(async () => {}),
}));
vi.mock("@/lib/compliance/repo", () => ({ appendEvent: vi.fn(async () => "1"), appendEventTx: vi.fn(async () => "1") }));
vi.mock("@/lib/routing/mutations/actors", () => ({
  requireSessionActor: async () => ({ actor: {}, actorId: "oid-1", auditLabel: "vince@example.com" }),
  aclPrincipalFromAuthorized: () => ({ tokens: ["oid-1"] }),
}));
vi.mock("@/lib/permissions/project-acl-guard", () => ({
  assertBucketProjectAccess: async () => undefined,
  assertTaskProjectAccess: async () => undefined,
}));
vi.mock("@/lib/permissions/agent-assignee-guard", () => ({ assertAgentAssigneeAllowed: () => undefined }));
vi.mock("@/lib/api/route", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/route")>()),
  route: (handler: unknown) => handler,
}));

import { withTransaction } from "@/lib/db";
import { patchTask } from "@/lib/sync/state";
import { PATCH } from "@/app/api/tasks/[id]/route";
import { POST } from "@/app/api/tasks/route";

const UAT_LABELS = ["kind:code", "uat:R5JD2K", "uat-attempt:1"];

const putTask = (id: string, labels: string[]) =>
  h.tasks.set(id, {
    id,
    data: { id, title: id, bucket: "BKT-1", stage: "merged", labels, accountableOwner: "vince" },
    dirty_fields: [], field_attribution: {}, sp_item_id: "1",
  });

const webPatch = (id: string, body: Record<string, unknown>) =>
  (PATCH as unknown as (req: Request, ctx: unknown) => Promise<unknown>)(
    new Request(`http://localhost/api/tasks/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) }
  );

const forbidden = {
  code: "forbidden",
  status: 403,
  message: expect.stringContaining("only the portal's mc_update_task verify (task.uat_sync) moves it to verified"),
};

beforeEach(() => {
  h.tasks.clear();
  h.writes.length = 0;
});

describe("web PATCH stage verified on a UAT ticket task (TASK-3963)", () => {
  it("refuses with 403 and leaves the stage unchanged", async () => {
    putTask("TASK-1", UAT_LABELS);
    await expect(webPatch("TASK-1", { stage: "verified" })).rejects.toMatchObject(forbidden);
    expect(h.writes).toEqual([]);
    expect(h.tasks.get("TASK-1")!.data.stage).toBe("merged");
  });

  it("refuses a patch that adds the UAT ticket labels and verified together", async () => {
    putTask("TASK-1", []);
    await expect(webPatch("TASK-1", { stage: "verified", labels: UAT_LABELS })).rejects.toMatchObject(forbidden);
    expect(h.writes).toEqual([]);
  });

  it("refuses a patch that strips the UAT ticket labels and sets verified together", async () => {
    putTask("TASK-1", UAT_LABELS);
    await expect(webPatch("TASK-1", { stage: "verified", labels: [] })).rejects.toMatchObject(forbidden);
    expect(h.writes).toEqual([]);
  });

  it("still lets a web PATCH set verified on a non-UAT task", async () => {
    putTask("TASK-2", ["kind:code"]);
    await expect(webPatch("TASK-2", { stage: "verified" })).resolves.toMatchObject({ stage: "verified" });
    expect(h.tasks.get("TASK-2")!.data.stage).toBe("verified");
  });

  it("still lets a web PATCH move a UAT ticket task to any other stage", async () => {
    putTask("TASK-1", UAT_LABELS);
    await expect(webPatch("TASK-1", { stage: "review" })).resolves.toMatchObject({ stage: "review" });
  });
});

describe("patchTask stage verified on a UAT ticket task (TASK-3963)", () => {
  it("refuses every caller except the portal's verify door", async () => {
    putTask("TASK-1", UAT_LABELS);
    await expect(patchTask("TASK-1", { stage: "verified" }, "someone")).rejects.toMatchObject(forbidden);
    expect(h.writes).toEqual([]);
    await expect(patchTask("TASK-1", { stage: "verified" }, "portal", { uatVerify: true })).resolves.toMatchObject({ stage: "verified" });
  });
});

// TASK-4200: uat:stale closes a merged UAT ticket task as closed and
// unconfirmed. Only the portal's mc_update_task closeStale writes it
// (patchTask opts.uatStaleClose), so every other door is refused with 403 and
// writes nothing: the web PATCH, a direct patchTask and both task creates.
const staleForbidden = {
  code: "forbidden",
  status: 403,
  message: expect.stringContaining("uat:stale is set only by the portal's mc_update_task closeStale (task.uat_sync)"),
};

describe("uat:stale through the web (TASK-4200)", () => {
  it("refuses a web PATCH that adds uat:stale to a UAT ticket task", async () => {
    putTask("TASK-1", UAT_LABELS);
    await expect(webPatch("TASK-1", { labels: [...UAT_LABELS, "uat:stale"] })).rejects.toMatchObject(staleForbidden);
    expect(h.writes).toEqual([]);
    expect(h.tasks.get("TASK-1")!.data.labels).toEqual(UAT_LABELS);
  });

  it("refuses a web PATCH that removes uat:stale from a UAT ticket task", async () => {
    putTask("TASK-1", [...UAT_LABELS, "uat:stale"]);
    await expect(webPatch("TASK-1", { labels: UAT_LABELS })).rejects.toMatchObject(staleForbidden);
    await expect(webPatch("TASK-1", { labels: [] })).rejects.toMatchObject(staleForbidden);
    expect(h.writes).toEqual([]);
  });

  it("refuses uat:stale on a task that is not a UAT ticket task, so it cannot gain a ticket label later", async () => {
    putTask("TASK-2", ["kind:code"]);
    await expect(webPatch("TASK-2", { labels: ["kind:code", "uat:stale"] })).rejects.toMatchObject(staleForbidden);
    expect(h.writes).toEqual([]);
    // Other label edits on it are unchanged.
    await expect(webPatch("TASK-2", { labels: ["kind:code", "api"] })).resolves.toMatchObject({ labels: ["kind:code", "api"] });
  });

  it("keeps uat:stale through other edits of a STALE-closed task", async () => {
    putTask("TASK-1", [...UAT_LABELS, "uat:stale"]);
    await expect(webPatch("TASK-1", { labels: [...UAT_LABELS, "uat:stale", "api"] })).resolves.toMatchObject({
      labels: [...UAT_LABELS, "uat:stale", "api"],
    });
    await expect(webPatch("TASK-1", { title: "Renamed" })).resolves.toMatchObject({ title: "Renamed" });
  });

  it("patchTask lets only the portal's closeStale door add uat:stale, and nobody remove it", async () => {
    putTask("TASK-1", UAT_LABELS);
    await expect(patchTask("TASK-1", { labels: [...UAT_LABELS, "uat:stale"] }, "someone")).rejects.toMatchObject(staleForbidden);
    await expect(patchTask("TASK-1", { labels: [...UAT_LABELS, "uat:stale"] }, "someone", { uatVerify: true })).rejects.toMatchObject(staleForbidden);
    expect(h.writes).toEqual([]);
    await expect(patchTask("TASK-1", { labels: [...UAT_LABELS, "uat:stale"] }, "portal", { uatStaleClose: true })).resolves.toMatchObject({
      labels: [...UAT_LABELS, "uat:stale"],
    });
    // Removing it in a patch is refused for everyone, the closeStale door included.
    await expect(patchTask("TASK-1", { labels: UAT_LABELS }, "portal", { uatStaleClose: true })).rejects.toMatchObject(staleForbidden);
    expect(h.tasks.get("TASK-1")!.data.labels).toEqual([...UAT_LABELS, "uat:stale"]);
  });

  // S1-06: the web PATCH does not trim labels, so a near-copy would be stored,
  // then turn into the exact label when MCP trims it on a later edit.
  it("refuses a web PATCH that adds a near-copy of uat:stale", async () => {
    putTask("TASK-1", UAT_LABELS);
    for (const variant of [" uat:stale", "UAT:STALE"]) {
      await expect(webPatch("TASK-1", { labels: [...UAT_LABELS, variant] })).rejects.toMatchObject(staleForbidden);
    }
    expect(h.writes).toEqual([]);
  });

  // S1-05: a label edit cannot carry a STALE close to another ticket, or make it count as done.
  it("refuses a web PATCH that moves a STALE close's ticket label or kind:code", async () => {
    putTask("TASK-1", [...UAT_LABELS, "uat:stale"]);
    const identity = { code: "forbidden", status: 403, message: expect.stringContaining("keeps kind:code and its uat:<feedbackId> label") };
    for (const labels of [
      ["kind:code", "uat:OTHER1", "uat-attempt:1", "uat:stale"],
      ["kind:decision", "uat:R5JD2K", "uat-attempt:1", "uat:stale"],
      ["kind:code", "uat-attempt:1", "uat:stale"],
    ]) {
      await expect(webPatch("TASK-1", { labels })).rejects.toMatchObject(identity);
    }
    expect(h.writes).toEqual([]);
  });

  // The stage writes that end a STALE close run against the real updateEntity
  // in tests/uat-stale-stage-writes.test.ts.

  it("refuses POST /api/tasks with a uat:stale label, before any write", async () => {
    vi.mocked(withTransaction).mockClear();
    const create = (labels: string[]) =>
      (POST as unknown as (req: Request, ctx: unknown) => Promise<unknown>)(
        new Request("http://localhost/api/tasks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "UAT ticket", bucket: "BKT-UAT", stage: "merged", labels }),
        }),
        { params: Promise.resolve({}) }
      );
    await expect(create([...UAT_LABELS, "uat:stale"])).rejects.toMatchObject(staleForbidden);
    // createTask trims and lowercases labels, so these are uat:stale too.
    await expect(create(["kind:code", " UAT:Stale "])).rejects.toMatchObject(staleForbidden);
    expect(withTransaction).not.toHaveBeenCalled();
  });
});
