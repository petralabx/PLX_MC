import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bucket, Project } from "@/lib/mc-data/types";
const h = vi.hoisted(() => ({ q: vi.fn(), projects: [] as Project[], buckets: [] as Bucket[], events: vi.fn() }));
vi.mock("@/lib/db", () => ({ withTransaction: async (fn: (q: typeof h.q) => unknown) => fn(h.q) }));
vi.mock("@/lib/sync/repo", () => ({ getProjects: async () => h.projects, getBuckets: async () => h.buckets }));
vi.mock("@/lib/compliance/repo", () => ({ appendEventTx: h.events }));
import { archiveContainer } from "@/lib/sync/archive";
import { isNavVisible } from "@/lib/mc-data/helpers";
import { bucketOutboundFields, projectOutboundFields } from "@/lib/sync/mapping";
const input = { entityType: "bucket" as const, id: "BKT-A", action: "archive" as const, reason: "retired", actor: "vince", repo: "petralabx/PLX_MC" };
beforeEach(() => {
  vi.clearAllMocks();
  h.projects = [{ id: "PRJ-A" } as Project];
  h.buckets = [{ id: "BKT-A", project: "PRJ-A" } as Bucket];
  h.q.mockResolvedValue([]);
});
describe("container archive", () => {
  it("archives a terminal-only bucket and audits its actor and reason without task writes", async () => {
    await archiveContainer(input);
    expect(h.events).toHaveBeenCalledWith(h.q, expect.objectContaining({ kind: "bucket.archived", actor: "vince", payload: expect.objectContaining({ bucketId: "BKT-A", reason: "retired" }) }));
    expect(h.q.mock.calls.some(([sql]) => /UPDATE entities/.test(sql))).toBe(false);
  });
  it("refuses open tasks unless force and a reason are supplied", async () => {
    h.q.mockImplementation(async (sql: string) => sql.includes("SELECT id FROM entities") ? [{ id: "TASK-1" }] : []);
    await expect(archiveContainer(input)).rejects.toMatchObject({ code: "open_tasks" });
    expect(h.events).not.toHaveBeenCalled();
    await archiveContainer({ ...input, force: true });
    expect(h.q.mock.calls.some(([sql]) => /UPDATE entities|DELETE|INSERT INTO entities/.test(sql))).toBe(false);
    await expect(archiveContainer({ ...input, force: true, reason: " " })).rejects.toMatchObject({ code: "invalid_request" });
  });
  it("cascades project archive and unarchive with a separate audited event per bucket", async () => {
    await archiveContainer({ ...input, entityType: "project", id: "PRJ-A" });
    expect(h.events.mock.calls.map(([, e]) => e.kind)).toEqual(["project.archived", "bucket.archived"]);
    h.events.mockClear();
    await archiveContainer({ ...input, entityType: "project", id: "PRJ-A", action: "unarchive" });
    expect(h.events.mock.calls.map(([, e]) => e.kind)).toEqual(["project.unarchived", "bucket.unarchived"]);
  });
  it("does not unarchive a bucket while its project is archived", async () => {
    h.projects[0].archivedAt = "2026-10-09";
    await expect(archiveContainer({ ...input, action: "unarchive" })).rejects.toMatchObject({ code: "project_archived" });
  });
  it("uses archive rather than health for nav and outbound Archived is independent of Health", () => {
    expect(isNavVisible({ health: "off" })).toBe(true);
    expect(isNavVisible({ health: "track", archivedAt: "2026-10-09" })).toBe(false);
    expect(bucketOutboundFields({ ...h.buckets[0], health: "off", archivedAt: "2026-10-09" })).toMatchObject({ Archived: true, Health: "Off track" });
    expect(projectOutboundFields({ ...h.projects[0], health: "off" })).toMatchObject({ Archived: false, Health: "Off track" });
  });
});
