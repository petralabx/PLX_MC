import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureQuery, type FixtureTask } from "./helpers/task-search-fixture";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
import { query } from "@/lib/db";
import { searchTaskPage, TASK_DISCUSSION_VECTOR } from "@/lib/sync/task-search";

let tasks: FixtureTask[];
const make = (n: number): FixtureTask => ({
  id: `TASK-${n}`, title: `Portal merged task ${n}`, bucket: "BKT-PROD", stage: "merged",
  description: "x".repeat(5000), assignee: "agent:runner", labels: [n % 2 ? "odd" : "even"],
  prs: [{ num: n, repo: "portal", title: "Fix", status: "merged" }],
  activity: [], createdAt: "2026-10-07T22:00:00.000000Z", updatedAt: "2026-10-07T22:00:00.000000Z",
} as unknown as FixtureTask);
beforeEach(() => {
  tasks = Array.from({ length: 400 }, (_, i) => make(200 + i));
  vi.mocked(query).mockReset();
  vi.mocked(query).mockImplementation(async (sql, params = []) => fixtureQuery(tasks, sql, params) as never);
});

describe("task search repository (offline bound-input fixtures + SQL contract)", () => {
  it("pages all 400 unique numeric IDs with exact total and no OFFSET", async () => {
    tasks.push(make(1000));
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const result = await searchTaskPage({ bucket: "BKT-PROD", stage: "merged", limit: 200, cursor });
      expect(result.total).toBe(tasks.length);
      ids.push(...result.tasks.map((t) => t.id));
      cursor = result.nextCursor ?? undefined;
    } while (cursor);
    expect(ids).toEqual(tasks.map((t) => t.id));
    expect(new Set(ids).size).toBe(401);
    const sql = vi.mocked(query).mock.calls.at(-1)![0];
    expect(sql).not.toMatch(/\bOFFSET\b/);
    expect(sql).toContain("WHERE (n, id COLLATE \"C\") >");
    expect(sql).toContain("count(*)::text FROM filtered");
    expect(sql).toContain("substring(id FROM '^TASK-([0-9]+)$')::numeric");
  });
  it("excludes tasks created mid-pagination including a lower ID", async () => {
    const first = await searchTaskPage({ limit: 200 });
    tasks.push({ ...make(199), createdAt: "2026-10-07T23:01:00.000000Z" }, make(1000));
    const second = await searchTaskPage({ limit: 200, cursor: first.nextCursor! });
    expect(second.total).toBe(400);
    expect(second.nextCursor).toBeNull();
    expect([...first.tasks, ...second.tasks].map((t) => t.id)).toEqual(Array.from({ length: 400 }, (_, i) => `TASK-${200 + i}`));
    expect(vi.mocked(query).mock.calls.at(-1)![0]).toContain("created_at <= horizon.at");
  });
  it.each([
    { bucket: "BKT-PROD", stage: "merged", expected: 400 },
    { label: "even", expected: 200 },
    { bucket: "missing", expected: 0 },
    { query: "task 200", label: "even", expected: 1 },
    { assignee: "AGENT:RUNNER", stage: "merged", expected: 400 },
  ])("counts the full filtered set: %j", async ({ expected, ...filters }) => {
    const result = await searchTaskPage({ ...filters, limit: 1 });
    expect(result.total).toBe(expected);
    expect(result.tasks).toHaveLength(Math.min(expected, 1));
  });
  it("finds CLOSED (obsolete in comments only when enabled, and marks comments/notes/activity", async () => {
    tasks = [{ ...make(1544), comments: [{ id: "mcp-note", body: "CLOSED (obsolete): superseded by replacement", author: "vince", ts: "now", mentions: [] }], activity: [{ what: "CLOSED (obsolete)", kind: "note", who: "vince", age: "now" }] }];
    expect((await searchTaskPage({ query: "CLOSED (obsolete", limit: 50 })).total).toBe(0);
    const result = await searchTaskPage({ query: "CLOSED (obsolete", searchComments: true, limit: 50 });
    expect(result.tasks[0]).toMatchObject({ id: "TASK-1544", matchFields: ["comments", "activity", "notes"] });
    const notes = await searchTaskPage({ query: "obsolete", in: ["notes"], limit: 50 });
    expect(notes.tasks[0].matchFields).toEqual(["notes"]);
    const sql = vi.mocked(query).mock.calls.at(-1)![0];
    expect(sql).toContain(TASK_DISCUSSION_VECTOR);
    expect(sql).toContain("@@ plainto_tsquery");
    tasks[0].comments![0].id = "human-comment";
    expect((await searchTaskPage({ query: "obsolete", in: ["notes"], limit: 50 })).total).toBe(0);
  });
  it("keeps default full rows, returns compact 200-row payload below 100 KB, and only copies existing completedAt", async () => {
    tasks[0].completedAt = "2026-10-07T22:00:00Z";
    const full = await searchTaskPage({ limit: 50 });
    expect(full.tasks).toHaveLength(50);
    expect(full.tasks[0]).toHaveProperty("description");
    const compact = await searchTaskPage({ limit: 200, fields: "compact" });
    expect(Buffer.byteLength(JSON.stringify(compact))).toBeLessThan(100_000);
    expect(compact.tasks[0]).toHaveProperty("completedAt");
    expect(compact.tasks[1]).not.toHaveProperty("completedAt");
    expect(compact.tasks[1]).not.toHaveProperty("description");
    expect(compact.tasks[1]).not.toHaveProperty("activity");
    expect(compact.tasks[1]).toHaveProperty("updatedAt");
  });
  it("applies ACL exclusions before count and pagination and binds cursors to filters/actor", async () => {
    const first = await searchTaskPage({ limit: 1 }, [], "caller-a");
    await expect(searchTaskPage({ limit: 1, cursor: first.nextCursor!, bucket: "other" }, [], "caller-a")).rejects.toThrow("Invalid search cursor");
    await expect(searchTaskPage({ limit: 1, cursor: first.nextCursor! }, [], "caller-b")).rejects.toThrow("Invalid search cursor");
    await expect(searchTaskPage({ limit: 1, cursor: "garbage" })).rejects.toThrow("Invalid search cursor");
    const hidden = await searchTaskPage({ limit: 1 }, ["BKT-PROD"]);
    expect(hidden).toEqual({ tasks: [], total: 0, nextCursor: null });
    expect(vi.mocked(query).mock.calls.at(-1)![0]).toContain("NOT (COALESCE(data->>'bucket'");
  });
  it("allows limit/projection changes and uses deterministic tie ordering for legacy IDs", async () => {
    tasks = [make(1000), make(200), { ...make(2), id: "TASK-02" }, make(2), { ...make(1), id: "TASK-LEGACY" }];
    const first = await searchTaskPage({ limit: 1 });
    const rest = await searchTaskPage({ fields: "compact", limit: 200, cursor: first.nextCursor! });
    expect([...first.tasks, ...rest.tasks].map((t) => t.id)).toEqual(["TASK-LEGACY", "TASK-02", "TASK-2", "TASK-200", "TASK-1000"]);
    expect(rest.nextCursor).toBeNull();
    expect(rest.total).toBe(5);
  });
  it("searches bodies without leaking matches from authors or activity metadata", async () => {
    tasks = [{ ...make(1544), comments: [{ id: "mcp-note", body: "ordinary content", author: "hidden-marker", ts: "now", mentions: [] }], activity: [{ what: "ordinary action", kind: "hidden-marker", who: "hidden-marker", age: "now" }] }];
    const result = await searchTaskPage({ query: "hidden-marker", searchComments: true, limit: 50 });
    expect(result.total).toBe(0);
    expect(vi.mocked(query).mock.calls.at(-1)![0]).not.toContain("$.comments[*].author");
  });
  it("keeps literal substring query text and filters in bound parameters, not SQL interpolation", async () => {
    const text = "%' OR 1=1 --";
    await searchTaskPage({ query: text, bucket: text, label: text, limit: 50 });
    const [sql, params] = vi.mocked(query).mock.calls.at(-1)!;
    expect(sql).not.toContain(text);
    expect(params).toContain(text.toLowerCase());
    expect(sql).toContain("strpos(lower(id)");
  });
  it("migration indexes the actual discussion expression and numeric IDs without destructive DDL", () => {
    const migration = readFileSync("db/migrations/032_task_search_indexes.sql", "utf8");
    const normalize = (text: string) => text.replace(/\s+/g, " ");
    expect(normalize(migration)).toContain(normalize(TASK_DISCUSSION_VECTOR));
    expect(migration).toContain("USING gin");
    expect(migration).not.toMatch(/DROP|ALTER|DELETE|UPDATE|INSERT|TRUNCATE/);
  });
});
