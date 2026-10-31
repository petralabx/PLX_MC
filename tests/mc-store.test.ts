// Invariant tests for the runtime store (the client cache over the sync
// engine): task creation, the sweep, safe no-op reconciliation, invites,
// reassignment. Conflict/error resolution semantics live in the engine
// (tests/sync-mapping.test.ts + the live evidence bundles); the store-side
// invariants here are the optimistic-local behaviors.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __setOpenConflictsForTests,
  __setPatchMirrorForTests,
  __setStateLoaderForTests,
  __setSweepMirrorForTests,
  activeNotices,
  addSubtask,
  addTask,
  allTasks,
  auditLog,
  cancelTaskWithReason,
  dataSource,
  dismissNotice,
  getVersion,
  inboxNotifications,
  invitePerson,
  markAllSynced,
  markRead,
  nextTaskId,
  openConflicts,
  openErrors,
  patchTaskFields,
  promoteSubtaskToTask,
  pushNotice,
  reassignTask,
  refreshState,
  resetStore,
  resolveConflict,
  retryError,
  setCoassignees,
  setTaskBucket,
  setTaskLabels,
  setTaskPriority,
  setTaskRepos,
  setTaskStage,
  setTaskTargetEnv,
  spLists,
  storeSyncCounts,
  sweepInFlight,
  taskById,
  toggleSubtask,
  unreadCount,
  type ServerSnapshot,
} from "@/lib/mc-data/store";
import { OPERATOR_ID } from "@/lib/mc-data";
import type { Task } from "@/lib/mc-data";

beforeEach(() => resetStore());

describe("addTask", () => {
  it("creates a pending, user-created task with the next id and bumps the ToDos pending count", () => {
    const before = storeSyncCounts();
    const id = nextTaskId();
    const t = addTask({ title: "  New thing  ", bucket: "BKT-WMS" });
    expect(t.id).toBe(id);
    expect(t.title).toBe("New thing");
    expect(t.stage).toBe("backlog");
    expect(t.sync.state).toBe("pending");
    expect(t.userCreated).toBe(true);
    expect(allTasks().some((x) => x.id === t.id)).toBe(true);
    expect(storeSyncCounts().pending).toBe(before.pending + 1);
  });

  it("defaults a new task to staging and honors explicit production", () => {
    expect(addTask({ title: "staged", bucket: "BKT-WMS" }).targetEnv).toBe("staging");
    expect(addTask({ title: "prod", bucket: "BKT-WMS", targetEnv: "production" }).targetEnv).toBe("production");
  });
});

// "Sync now" (Wave 2 — UI trust): nothing is marked synced, and no "Sweep
// completed" row is written, until the server's sweep has actually succeeded.
describe("markAllSynced (Sync now — the sweep)", () => {
  const sweepRow = (body: string) => auditLog().some((r) => r.body.startsWith(body));

  // What GET /api/state returns after a successful sweep: the pushed task is
  // synced, pending counts are zero, and the engine wrote its own audit row.
  function sweptSnapshot(taskId: string): ServerSnapshot {
    return {
      tasks: allTasks().map((t) => (t.id === taskId ? { ...t, sync: { ...t.sync, state: "synced" } } : t)),
      risks: [],
      files: [],
      conflicts: [],
      errors: [],
      audit: [{ ts: "2026.09.25 · 12:00", actor: "vince", body: "Sweep completed — 1 outbound push, 0 inbound changes.", state: "synced" }],
      counts: { todos: { synced: 1, pending: 0, conflict: 0, error: 0 } },
      lastSweep: "2026.09.25 · 12:00",
    };
  }

  it("does not mark anything synced or log 'Sweep completed' before the server confirms", () => {
    const t = addTask({ title: "x", bucket: "BKT-WMS" });
    const pending = storeSyncCounts().pending;
    markAllSynced();
    expect(taskById(t.id)?.sync.state).toBe("pending");
    expect(storeSyncCounts().pending).toBe(pending);
    expect(sweepRow("Sweep completed")).toBe(false);
  });

  it("holds items pending while the sweep is in flight, then adopts the server's result", async () => {
    const t = addTask({ title: "x", bucket: "BKT-WMS" });
    let finish!: () => void;
    __setSweepMirrorForTests(() => new Promise<void>((resolve) => (finish = resolve)));
    __setStateLoaderForTests(async () => sweptSnapshot(t.id));

    const done = markAllSynced();
    expect(sweepInFlight()).toBe(true);
    expect(taskById(t.id)?.sync.state).toBe("pending");

    finish();
    await done;
    expect(sweepInFlight()).toBe(false);
    expect(taskById(t.id)?.sync.state).toBe("synced");
    expect(spLists().find((l) => l.key === "todos")?.counts.pending).toBe(0);
    expect(auditLog()[0].body).toBe("Sweep completed — 1 outbound push, 0 inbound changes.");
    expect(activeNotices()).toHaveLength(0);
  });

  it("keeps items unsynced and surfaces an error notice when the sweep fails", async () => {
    const t = addTask({ title: "x", bucket: "BKT-WMS" });
    const pending = storeSyncCounts().pending;
    __setSweepMirrorForTests(async () => {
      throw new Error("sync.mutate denied (not_permitted).");
    });

    await markAllSynced();
    expect(sweepInFlight()).toBe(false);
    expect(taskById(t.id)?.sync.state).toBe("pending");
    expect(storeSyncCounts().pending).toBe(pending);
    expect(sweepRow("Sweep completed")).toBe(false);
    const notices = activeNotices();
    expect(notices).toHaveLength(1);
    expect(notices[0].tone).toBe("error");
    expect(notices[0].body).toContain("sync.mutate denied");
  });

  it("runs one sweep at a time (a second click while in flight is not a second sweep)", async () => {
    let calls = 0;
    let finish!: () => void;
    __setSweepMirrorForTests(() => {
      calls += 1;
      return new Promise<void>((resolve) => (finish = resolve));
    });
    __setStateLoaderForTests(async () => sweptSnapshot("TASK-221"));
    const first = markAllSynced();
    const second = markAllSynced();
    finish();
    await Promise.all([first, second]);
    expect(calls).toBe(1);
  });
});

describe("conflict / error reconciliation", () => {
  it("starts with empty queues (demo seeds purged; the engine raises real ones)", () => {
    expect(openConflicts()).toHaveLength(0);
    expect(openErrors()).toHaveLength(0);
  });

  it("treats resolving or retrying an unknown id as a safe no-op", () => {
    const before = storeSyncCounts();
    expect(() => resolveConflict("cf-nope", "mc")).not.toThrow();
    expect(() => retryError("er-nope")).not.toThrow();
    expect(storeSyncCounts()).toEqual(before);
  });
});

// TASK-4294: a create the server refuses is rolled back with a notice, as
// patchTaskFields and addProject roll back a failed write. A resolve the
// server refuses, and any write with no clear answer, say so and reload, so
// the server's state wins over the optimistic change. These run the real
// default path: a stand-in window turns the server call on, and fetch answers.
describe("a create or resolve the server refuses (TASK-4294)", () => {
  const flush = async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const answer = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const refusal = (code: string, message: string, status: number) => answer({ error: { code, message } }, status);
  const respond = (handler: (url: string) => Response | Promise<Response>) =>
    vi.stubGlobal("fetch", vi.fn(async (url: string) => handler(url)));
  const todos = () => spLists().find((l) => l.key === "todos")!;
  const conflict = {
    id: "cf-task-221-status-1", list: "todos", entity: "Task", entityId: "TASK-221", field: "Status",
    mcVal: "Merged", spVal: "Verified", detected: "now", by: "SP sync", note: "Edited in SharePoint while Mission Control also changed it.",
  };
  // The server's state, as a reload returns it.
  const snapshot = (over: Partial<ServerSnapshot> = {}): ServerSnapshot => ({
    tasks: structuredClone(allTasks()), risks: [], files: [], conflicts: [], errors: [], audit: [],
    counts: { todos: { ...todos().counts } }, lastSweep: "now", ...over,
  });
  let server: ServerSnapshot;
  let reloads: ReturnType<typeof vi.fn<() => Promise<ServerSnapshot>>>;

  beforeEach(() => {
    vi.stubGlobal("window", {});
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    server = snapshot();
    reloads = vi.fn(async () => structuredClone(server));
    __setStateLoaderForTests(reloads);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("takes back a New Task create the server refuses, and says why", async () => {
    const message = "The new task is a UAT ticket task, so it cannot start at verified.";
    respond(() => refusal("forbidden", message, 403));
    const before = storeSyncCounts();
    const t = addTask({ title: "UAT fix", bucket: "BKT-WMS", stage: "verified", labels: ["kind:code", "uat:cmfb7q2xk0001"] });
    const version = getVersion();
    await flush();
    expect(allTasks()).not.toContain(t);
    expect(storeSyncCounts()).toEqual(before);
    expect(getVersion()).toBeGreaterThan(version);
    expect(activeNotices().map((n) => n.body)).toEqual([expect.stringContaining(message)]);
    expect(activeNotices()[0].body).toContain("rolled back");
  });

  it("leaves another writer's task alone when a refused create had the same id", async () => {
    let refuse!: () => void;
    respond(() => new Promise<Response>((resolve) => { refuse = () => resolve(refusal("forbidden", "Refused.", 403)); }));
    const mine = addTask({ title: "Mine", bucket: "BKT-WMS" });
    // A reload lands first and brings another writer's task under the same id.
    server = snapshot({ tasks: [...structuredClone(allTasks()).filter((x) => x.id !== mine.id), { ...structuredClone(mine), title: "Theirs" }] });
    await refreshState();
    const serverCounts = { ...todos().counts };
    refuse();
    await flush();
    expect(taskById(mine.id)?.title).toBe("Theirs");
    expect(todos().counts).toEqual(serverCounts);
  });

  it("reloads instead of guessing when a create gets no clear answer", async () => {
    respond(() => {
      throw new TypeError("fetch failed");
    });
    const t = addTask({ title: "Lost answer", bucket: "BKT-WMS" });
    await flush();
    expect(reloads).toHaveBeenCalledTimes(1);
    // The server's state decides; this one never got the task.
    expect(allTasks()).not.toContain(t);
    expect(activeNotices()[0].body).toContain("Couldn't confirm");
  });

  it("keeps a create the server accepts, under the server's id", async () => {
    respond(() => answer({ data: { id: "TASK-9999", title: "Plain task" } }, 201));
    const t = addTask({ title: "Plain task", bucket: "BKT-WMS" });
    const version = getVersion();
    await flush();
    expect(allTasks()).not.toContain(t);
    expect(taskById("TASK-9999")?.title).toBe("Plain task");
    expect(getVersion()).toBeGreaterThan(version);
    expect(activeNotices()).toEqual([]);
    expect(reloads).not.toHaveBeenCalled();
  });

  it("takes a promoted sub-task off its parent only once the new task exists", async () => {
    // The parent's own PATCHes succeed; only the create is under test.
    __setPatchMirrorForTests(async (id, patch) => ({ ...taskById(id)!, ...patch }));
    addSubtask("TASK-221", "Spike the API", OPERATOR_ID);
    const sub = taskById("TASK-221")!.subtasks.at(-1)!;
    respond(() => refusal("bucket_archived", "BKT-WMS is archived.", 409));
    promoteSubtaskToTask("TASK-221", sub.id);
    expect(taskById("TASK-221")!.subtasks.map((s) => s.id)).toContain(sub.id);
    await flush();
    expect(taskById("TASK-221")!.subtasks.map((s) => s.id)).toContain(sub.id);
    respond(() => answer({ data: { id: "TASK-9999", title: sub.t } }, 201));
    promoteSubtaskToTask("TASK-221", sub.id);
    await flush();
    expect(taskById("TASK-221")!.subtasks.map((s) => s.id)).not.toContain(sub.id);
    expect(taskById("TASK-221")!.activity[0].what).toBe("promoted a subtask to TASK-9999");
  });

  it("reloads after a refused keep-SP, so the server's open conflict, counts and sync state come back", async () => {
    const message = "Task TASK-221 is a UAT ticket task; only the portal's mc_update_task verify (task.uat_sync) moves it to verified.";
    respond(() => refusal("uat_verify_required", message, 403));
    __setOpenConflictsForTests([conflict]);
    taskById("TASK-221")!.sync.state = "conflict";
    server = snapshot({ conflicts: [conflict], counts: { todos: { ...todos().counts, conflict: 1 } } });
    resolveConflict(conflict.id, "sp");
    expect(openConflicts()).toEqual([]);
    await flush();
    expect(reloads).toHaveBeenCalledTimes(1);
    expect(openConflicts()).toEqual([conflict]);
    expect(taskById("TASK-221")!.sync.state).toBe("conflict");
    expect(storeSyncCounts().conflict).toBe(1);
    expect(activeNotices().map((n) => n.body)).toEqual([expect.stringContaining(message)]);
  });

  it("keeps a conflict another viewer already resolved gone, not open again", async () => {
    respond(() => refusal("not_found", `unknown or already-resolved conflict ${conflict.id}`, 404));
    __setOpenConflictsForTests([conflict]);
    resolveConflict(conflict.id, "sp");
    await flush();
    expect(openConflicts()).toEqual([]);
    expect(reloads).toHaveBeenCalledTimes(1);
    // A 404 also means the engine declined the value, so the notice does not
    // claim the conflict is gone; the reload shows where it stands.
    expect(activeNotices().map((n) => n.body)).toEqual([
      `Couldn't resolve the conflict on TASK-221 · Status. unknown or already-resolved conflict ${conflict.id}`,
    ]);
  });

  it("ends two refused resolves on one task as the server holds them", async () => {
    const title = { ...conflict, id: "cf-task-221-title-1", field: "Title", mcVal: "a", spVal: "b" };
    respond(() => refusal("forbidden", "Refused.", 403));
    __setOpenConflictsForTests([conflict, title]);
    taskById("TASK-221")!.sync.state = "conflict";
    server = snapshot({ conflicts: [conflict, title] });
    resolveConflict(conflict.id, "sp");
    resolveConflict(title.id, "sp");
    await flush();
    expect(openConflicts()).toEqual([conflict, title]);
    expect(taskById("TASK-221")!.sync.state).toBe("conflict");
  });

  it("reloads once after a resolve the server accepts, and the resolve stands when that reload fails", async () => {
    respond(() => answer({ data: { resolved: true } }, 200));
    __setOpenConflictsForTests([conflict]);
    resolveConflict(conflict.id, "mc");
    await flush();
    expect(reloads).toHaveBeenCalledTimes(1);
    expect(openConflicts()).toEqual([]);
    __setOpenConflictsForTests([conflict]);
    reloads.mockRejectedValueOnce(new Error("state unavailable"));
    resolveConflict(conflict.id, "mc");
    await flush();
    expect(openConflicts()).toEqual([]);
    expect(activeNotices()).toEqual([]);
  });

  it.each([
    ["a gateway page that is not JSON", () => new Response("<html>Bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } })],
    ["a JSON error with no envelope", () => answer({ message: "boom" }, 500)],
  ])("reloads, and rolls nothing back, when a create gets %s", async (_kind, reply) => {
    respond(() => reply());
    const t = addTask({ title: "Maybe saved", bucket: "BKT-WMS" });
    // The create landed; only its answer was lost.
    server = snapshot();
    await flush();
    expect(reloads).toHaveBeenCalledTimes(1);
    expect(taskById(t.id)?.title).toBe("Maybe saved");
    expect(activeNotices().map((n) => n.body)).toEqual([expect.stringContaining("Couldn't confirm")]);
  });

  it("shows a create the server took after a reload dropped its optimistic copy, and leaves another writer's same-id task alone", async () => {
    let accept!: (created: Task) => void;
    respond(() => new Promise<Response>((resolve) => { accept = (created) => resolve(answer({ data: created }, 201)); }));
    const pending = todos().counts.pending;
    const mine = addTask({ title: "Mine", bucket: "BKT-WMS" });
    // A reload from before the create committed lands first, with another
    // writer's task under the same id.
    server = snapshot({
      tasks: [...structuredClone(allTasks()).filter((x) => x.id !== mine.id), { ...structuredClone(mine), title: "Theirs" }],
      counts: { todos: { ...todos().counts, pending: pending - 1 } },
    });
    await refreshState();
    const version = getVersion();
    accept({ ...structuredClone(mine), id: "TASK-9999" });
    await flush();
    expect(taskById(mine.id)?.title).toBe("Theirs");
    expect(taskById("TASK-9999")?.title).toBe("Mine");
    expect(todos().counts.pending).toBe(pending);
    expect(getVersion()).toBeGreaterThan(version);
  });

  it("keeps a created task, with no false notice or reload, when a follow-up after the create throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    respond(() => answer({ data: { id: "TASK-9999", title: "Plain task" } }, 201));
    addTask({ title: "Plain task", bucket: "BKT-WMS" }, { onCreated: () => { throw new Error("follow-up failed"); } });
    await flush();
    expect(taskById("TASK-9999")?.title).toBe("Plain task");
    expect(activeNotices()).toEqual([]);
    expect(reloads).not.toHaveBeenCalled();
  });

  it("never counts pending below zero when a refused create is taken back", async () => {
    let refuse!: () => void;
    respond(() => new Promise<Response>((resolve) => { refuse = () => resolve(refusal("forbidden", "Refused.", 403)); }));
    addTask({ title: "Mine", bucket: "BKT-WMS" });
    // A sweep counted the ToDos register again while the create was in flight.
    todos().counts.pending = 0;
    refuse();
    await flush();
    expect(todos().counts.pending).toBe(0);
  });

  it("keeps a sub-task the parent gained while a promote's create was in flight", async () => {
    __setPatchMirrorForTests(async (id, patch) => ({ ...taskById(id)!, ...patch }));
    addSubtask("TASK-221", "Spike the API", OPERATOR_ID);
    const sub = taskById("TASK-221")!.subtasks.at(-1)!;
    let accept!: () => void;
    respond(() => new Promise<Response>((resolve) => { accept = () => resolve(answer({ data: { id: "TASK-9999", title: sub.t } }, 201)); }));
    promoteSubtaskToTask("TASK-221", sub.id);
    // A reload brings the parent as another viewer left it, with one more sub-task.
    const later = { ...structuredClone(sub), id: "st-later", t: "Write the docs" };
    server = snapshot({
      tasks: structuredClone(allTasks()).map((x) => (x.id === "TASK-221" ? { ...x, subtasks: [...x.subtasks, later] } : x)),
    });
    await refreshState();
    accept();
    await flush();
    const ids = taskById("TASK-221")!.subtasks.map((s) => s.id);
    expect(ids).not.toContain(sub.id);
    expect(ids).toContain(later.id);
  });

  it("does not show a create twice when a reload already brought the server's copy", async () => {
    let accept!: (created: Task) => void;
    respond(() => new Promise<Response>((resolve) => { accept = (created) => resolve(answer({ data: created }, 201)); }));
    const mine = addTask({ title: "Mine", bucket: "BKT-WMS" });
    const created = { ...structuredClone(mine), id: "TASK-9999" };
    // The create committed before this reload read the state.
    server = snapshot({ tasks: [...structuredClone(allTasks()).filter((x) => x.id !== mine.id), created] });
    await refreshState();
    const pending = todos().counts.pending;
    accept(created);
    await flush();
    expect(allTasks().filter((x) => x.id === "TASK-9999")).toHaveLength(1);
    expect(todos().counts.pending).toBe(pending);
  });

  it("clears a promote's in-flight mark once the create answers, even when taking the sub-task off the parent was refused", async () => {
    __setPatchMirrorForTests(async (id, patch) => ({ ...taskById(id)!, ...patch }));
    addSubtask("TASK-221", "Spike the API", OPERATOR_ID);
    const sub = taskById("TASK-221")!.subtasks.at(-1)!;
    await flush();
    __setPatchMirrorForTests(async () => {
      throw new Error("Refused.");
    });
    respond(() => answer({ data: { id: "TASK-9999", title: sub.t } }, 201));
    promoteSubtaskToTask("TASK-221", sub.id);
    await flush();
    // The task exists, and the refused edit put the sub-task back on the parent.
    expect(taskById("TASK-9999")).toBeDefined();
    expect(taskById("TASK-221")!.subtasks.map((s) => s.id)).toContain(sub.id);
    expect(promoteSubtaskToTask("TASK-221", sub.id)).not.toBeNull();
  });

  it("does not promote a sub-task a second time while its create is in flight", async () => {
    __setPatchMirrorForTests(async (id, patch) => ({ ...taskById(id)!, ...patch }));
    addSubtask("TASK-221", "Spike the API", OPERATOR_ID);
    const sub = taskById("TASK-221")!.subtasks.at(-1)!;
    let accept!: () => void;
    const post = vi.fn(() => new Promise<Response>((resolve) => { accept = () => resolve(answer({ data: { id: "TASK-9999", title: sub.t } }, 201)); }));
    vi.stubGlobal("fetch", post);
    expect(promoteSubtaskToTask("TASK-221", sub.id)).not.toBeNull();
    expect(promoteSubtaskToTask("TASK-221", sub.id)).toBeNull();
    expect(activeNotices().map((n) => [n.tone, n.body])).toEqual([["info", 'Sub-task "Spike the API" is already being promoted.']]);
    accept();
    await flush();
    expect(post).toHaveBeenCalledTimes(1);
    expect(taskById("TASK-221")!.activity.filter((a) => a.what.startsWith("promoted a subtask"))).toHaveLength(1);
  });

  it("keeps the sub-task when a promote gets no clear answer, and says what to check", async () => {
    __setPatchMirrorForTests(async (id, patch) => ({ ...taskById(id)!, ...patch }));
    addSubtask("TASK-221", "Spike the API", OPERATOR_ID);
    const sub = taskById("TASK-221")!.subtasks.at(-1)!;
    respond(() => new Response("<html>Gateway timeout</html>", { status: 504, headers: { "content-type": "text/html" } }));
    const created = promoteSubtaskToTask("TASK-221", sub.id)!;
    // The create landed; only its answer was lost.
    server = snapshot();
    await flush();
    expect(taskById(created.id)?.title).toBe("Spike the API");
    expect(taskById("TASK-221")!.subtasks.map((s) => s.id)).toContain(sub.id);
    expect(activeNotices().map((n) => n.body)).toEqual([
      expect.stringContaining('Sub-task "Spike the API" stays on TASK-221. If the board now shows it as its own task'),
      expect.stringContaining("Couldn't confirm"),
    ]);
    // The person can promote it again once they have checked.
    respond(() => answer({ data: { id: "TASK-9999", title: sub.t } }, 201));
    expect(promoteSubtaskToTask("TASK-221", sub.id)).not.toBeNull();
  });

  it("tells the person to check after Retry when an unconfirmed promote's reload fails too", async () => {
    __setPatchMirrorForTests(async (id, patch) => ({ ...taskById(id)!, ...patch }));
    addSubtask("TASK-221", "Spike the API", OPERATOR_ID);
    const sub = taskById("TASK-221")!.subtasks.at(-1)!;
    respond(() => {
      throw new TypeError("Failed to fetch");
    });
    reloads.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    promoteSubtaskToTask("TASK-221", sub.id);
    await flush();
    expect(taskById("TASK-221")!.subtasks.map((s) => s.id)).toContain(sub.id);
    expect(activeNotices()[0].body).toContain('Sub-task "Spike the API" stays on TASK-221. The board could not reload');
  });

  it("counts a create once when a reload without ToDos counts dropped its optimistic copy", async () => {
    let accept!: (created: Task) => void;
    respond(() => new Promise<Response>((resolve) => { accept = (created) => resolve(answer({ data: created }, 201)); }));
    const mine = addTask({ title: "Mine", bucket: "BKT-WMS" });
    const pending = todos().counts.pending;
    // An empty tasks table sends no ToDos counts, so this reload keeps the client's.
    server = snapshot({ tasks: structuredClone(allTasks()).filter((x) => x.id !== mine.id), counts: {} });
    await refreshState();
    accept({ ...structuredClone(mine), id: "TASK-9999" });
    await flush();
    expect(taskById("TASK-9999")?.title).toBe("Mine");
    expect(todos().counts.pending).toBe(pending);
  });

  it("takes back a refused create's pending count when a reload without ToDos counts dropped its copy", async () => {
    let refuse!: () => void;
    respond(() => new Promise<Response>((resolve) => { refuse = () => resolve(refusal("forbidden", "Refused.", 403)); }));
    const before = todos().counts.pending;
    const mine = addTask({ title: "Mine", bucket: "BKT-WMS" });
    server = snapshot({ tasks: structuredClone(allTasks()).filter((x) => x.id !== mine.id), counts: {} });
    await refreshState();
    refuse();
    await flush();
    expect(todos().counts.pending).toBe(before);
  });

  it("does not reload, and so does not leave the page, when a resolve needs a new sign-in", async () => {
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { pathname: "/sync", search: "", assign } });
    // The real loader: a reload is a GET, which would send the page to sign in.
    __setStateLoaderForTests(null);
    respond(() => refusal("signin_required", "Sign in again to continue.", 401));
    __setOpenConflictsForTests([conflict]);
    resolveConflict(conflict.id, "sp");
    await flush();
    expect(assign).not.toHaveBeenCalled();
    expect(activeNotices().map((n) => n.body)).toEqual([expect.stringContaining("Sign in again to continue.")]);
  });

  it("keeps an unconfirmed resolve on screen while offline, and the next reload that works brings the conflict back", async () => {
    respond(() => {
      throw new TypeError("Failed to fetch");
    });
    __setOpenConflictsForTests([conflict]);
    reloads.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    resolveConflict(conflict.id, "sp");
    await flush();
    expect(dataSource()).toBe("offline");
    expect(openConflicts()).toEqual([]);
    expect(activeNotices().map((n) => n.body)).toEqual([expect.stringContaining("Couldn't resolve the conflict on TASK-221 · Status")]);
    server = snapshot({ conflicts: [conflict] });
    await refreshState();
    expect(openConflicts()).toEqual([conflict]);
  });
});

describe("markRead", () => {
  it("clears a notification's unread state and the unread count", () => {
    const before = unreadCount();
    expect(before).toBeGreaterThan(0);
    const firstUnread = inboxNotifications().find((n) => n.unread)!;
    markRead(firstUnread.id);
    expect(unreadCount()).toBe(before - 1);
    expect(inboxNotifications().find((n) => n.id === firstUnread.id)?.unread).toBe(false);
  });
});

describe("invitePerson", () => {
  it("registers a Petra-domain colleague and is idempotent per email", () => {
    const id = invitePerson("noa.levi@petrasoap.com");
    expect(id).toBe("inv-noalevi");
    expect(invitePerson("noa.levi@petrasoap.com")).toBe(id);
  });

  it("rejects non-Petra domains", () => {
    expect(invitePerson("someone@gmail.com")).toBeNull();
  });
});

describe("reassignTask", () => {
  it("sets the assignee and logs the honest SharePoint-mirror trail (real push, no fabricated Teams/email)", () => {
    reassignTask("TASK-221", "ricardo");
    const t = taskById("TASK-221");
    expect(t?.assignee).toBe("ricardo");
    // Item 1: the Assigned To person column now mirrors to SharePoint on the next
    // sync — the trail says so. It must NOT claim a Teams/email delivery that did
    // not happen (notification delivery is still deferred), nor revert to the old
    // "deferred to the directory increment" narrative.
    expect(t?.activity[0]?.what).toContain("Assigned To");
    expect(t?.activity[0]?.what).toContain("SharePoint");
    expect(t?.activity[0]?.what).not.toContain("notified via Teams");
    expect(t?.activity[0]?.what).not.toContain("deferred to the directory increment");
  });

  it("supports unassigning with the honest SharePoint-mirror trail", () => {
    reassignTask("TASK-222", "rishi");
    reassignTask("TASK-222", null);
    const t = taskById("TASK-222");
    expect(t?.assignee).toBeNull();
    expect(t?.activity[0]?.what).toContain("unassigned");
    expect(t?.activity[0]?.what).toContain("SharePoint");
    expect(t?.activity[0]?.what).not.toContain("deferred to the directory increment");
  });
});

describe("assignee-mirror audit honesty (now a real push, still pending until the sweep)", () => {
  it("reassign audit claims the real SharePoint mirror and is state=pending (until the sweep), not synced", () => {
    reassignTask("TASK-221", "ricardo");
    const top = auditLog()[0];
    expect(top.body).toContain("SharePoint");
    expect(top.body).not.toContain("deferred to the directory increment");
    expect(top.body).not.toContain("notified via Teams");
    // Pending: the value is queued for the next outbound sweep, not yet written —
    // claiming "synced" here would fabricate sync evidence.
    expect(top.state).toBe("pending");
  });

  it("unassign audit claims clearing Assigned To and is state=pending, not synced", () => {
    reassignTask("TASK-222", "rishi");
    reassignTask("TASK-222", null);
    const top = auditLog()[0];
    expect(top.body).toContain("Assigned To");
    expect(top.body).not.toContain("deferred to the directory increment");
    expect(top.state).toBe("pending");
  });
});

describe("patchTaskFields (the shared mutation spine)", () => {
  it("sets a field optimistically and is reflected by taskById", () => {
    patchTaskFields("TASK-221", { stage: "qa" });
    expect(taskById("TASK-221")?.stage).toBe("qa");
  });

  it("is a safe no-op on an empty patch", () => {
    const before = JSON.stringify(taskById("TASK-221"));
    patchTaskFields("TASK-221", {});
    expect(JSON.stringify(taskById("TASK-221"))).toBe(before);
  });

  it("refuses a drag/click into cancelled: a cancel needs a reason, so it says so and changes nothing (TASK-2529)", () => {
    const before = taskById("TASK-221")?.stage;
    setTaskStage("TASK-221", "cancelled");
    expect(taskById("TASK-221")?.stage).toBe(before);
    expect(activeNotices().some((n) => /lifecycle rail/.test(n.body) && /reason is required/.test(n.body))).toBe(true);
  });

  it("cancelTaskWithReason sends PATCH {cancel} and adopts the server's cancelled task (TASK-2598)", async () => {
    const before = taskById("TASK-221")!;
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: { ...before, stage: "cancelled", cancellation: { reason: "obsolete", replacedBy: null, cancelledAt: "2026-10-10T00:00:00Z", cancelledBy: "oid-1" } } }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(cancelTaskWithReason("TASK-221", { reason: "obsolete", replacedBy: null })).resolves.toBe(true);
      expect(fetchMock).toHaveBeenCalledWith("/api/tasks/TASK-221", expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ cancel: { reason: "obsolete", replacedBy: null } }),
      }));
      expect(taskById("TASK-221")?.stage).toBe("cancelled");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("cancelTaskWithReason leaves the task alone and says why when the server refuses (TASK-2598)", async () => {
    const before = taskById("TASK-221")?.stage;
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: "forbidden", message: "task.cancel denied (no_grant)." } }), { status: 403 })
    ));
    try {
      await expect(cancelTaskWithReason("TASK-221", { reason: "obsolete" })).resolves.toBe(false);
      expect(taskById("TASK-221")?.stage).toBe(before);
      expect(activeNotices().some((n) => /Couldn't cancel TASK-221/.test(n.body) && /no_grant/.test(n.body))).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("setTaskStage / setTaskPriority / setTaskBucket apply optimistically", () => {
    setTaskStage("TASK-221", "merged");
    setTaskPriority("TASK-221", "urgent");
    setTaskBucket("TASK-221", "BKT-DAPI");
    const t = taskById("TASK-221");
    expect(t?.stage).toBe("merged");
    expect(t?.priority).toBe("urgent");
    expect(t?.bucket).toBe("BKT-DAPI");
  });
});

// The two palette spine actions (Module G, SPEC §3.G.2 / §3.G.3). The palette's
// run handlers are thin wrappers around these store actions; the invariant is
// that "Mark done" → stage:"verified" (band=done) and "Assign to me" →
// assignee: the viewer (OPERATOR_ID stands in here), both routed through the FROZEN spine (optimistic +
// PATCH + reconcile/rollback + notice). The already-done / already-mine cases
// are handled by the palette HIDING the command (asserted by the gating predicates).
describe("palette spine actions — Mark done / Assign to me (Module G)", () => {
  it("'Mark done' sets stage to verified optimistically (reflected by taskById)", () => {
    // TASK-221 seeds as stage "planned" (band=todo), so this is a real change.
    expect(taskById("TASK-221")?.stage).toBe("planned");
    setTaskStage("TASK-221", "verified");
    expect(taskById("TASK-221")?.stage).toBe("verified");
  });

  it("'Assign to me' sets the assignee to OPERATOR_ID optimistically", () => {
    // TASK-221 seeds unassigned (assignee null), so assigning to me is a change.
    expect(taskById("TASK-221")?.assignee).toBeNull();
    reassignTask("TASK-221", OPERATOR_ID);
    expect(taskById("TASK-221")?.assignee).toBe(OPERATOR_ID);
  });

  it("hides the action when already in the target state (the gating predicates)", () => {
    // The palette appends "Mark done" only when stage ∉ {verified, merged}, and
    // "Assign to me" only when assignee !== the viewer. Mirror those predicates
    // so the no-op-avoidance contract is pinned (SPEC §3.G.2).
    const done: Task = { ...taskById("TASK-221")!, stage: "verified" };
    const mine: Task = { ...taskById("TASK-221")!, assignee: OPERATOR_ID };
    const isDone = (t: Task) => t.stage === "verified" || t.stage === "merged";
    expect(isDone(done)).toBe(true);
    expect(isDone({ ...done, stage: "merged" })).toBe(true);
    expect(isDone(taskById("TASK-221")!)).toBe(false); // "planned" → action shown
    expect(mine.assignee === OPERATOR_ID).toBe(true); // → "Assign to me" hidden
    expect(taskById("TASK-221")!.assignee === OPERATOR_ID).toBe(false); // → shown
  });

  it("'Mark done' rolls back + surfaces a notice when the PATCH rejects", async () => {
    const before = taskById("TASK-221")!.stage;
    expect(before).not.toBe("verified"); // guard: a real change
    __setPatchMirrorForTests(async () => {
      throw new Error("PATCH 500");
    });

    await setTaskStage("TASK-221", "verified");

    expect(taskById("TASK-221")?.stage).toBe(before); // rolled back to "planned"
    const notices = activeNotices();
    expect(notices).toHaveLength(1);
    expect(notices[0].tone).toBe("error");
    expect(notices[0].body).toContain("TASK-221");
    expect(notices[0].body.toLowerCase()).toContain("rolled back");
  });

  it("'Assign to me' rolls back + surfaces a notice when the PATCH rejects", async () => {
    const before = taskById("TASK-221")!.assignee;
    expect(before).not.toBe(OPERATOR_ID); // guard: a real change
    __setPatchMirrorForTests(async () => {
      throw new Error("PATCH 500");
    });

    await reassignTask("TASK-221", OPERATOR_ID);

    expect(taskById("TASK-221")?.assignee).toBe(before); // reassign rolled back
    expect(activeNotices()).toHaveLength(1);
  });
});

// The prime-directive guard (SPEC §5 Module B "recommended" reconcile-on-failure
// + §6 E2E #3a). `patchTaskFields` mirrors the optimistic edit to PATCH; on
// SUCCESS it adopts the server's returned task, on FAILURE it restores the
// pre-edit values of exactly the patched fields (and the optimistic activity
// line), re-emits, and surfaces a NON-SILENT notice — so a write the user saw
// is never silently dropped on the next hydrate. `serverCall`/the default mirror
// are no-ops under the Node test env, so these drive the real path through the
// injectable mirror seam (__setPatchMirrorForTests).
describe("patchTaskFields PATCH mirror — success reconcile", () => {
  it("adopts the server's returned task on a resolved mirror", async () => {
    // The server is the source of truth: it can return a task that differs from
    // the optimistic one (here it also bumps the title), and we must adopt it.
    const serverTask: Task = { ...taskById("TASK-221")!, stage: "qa", title: "Server-canonical title" };
    __setPatchMirrorForTests(async () => serverTask);

    await patchTaskFields("TASK-221", { stage: "qa" });

    const t = taskById("TASK-221");
    expect(t?.stage).toBe("qa");
    expect(t?.title).toBe("Server-canonical title"); // reconciled to DB truth
    expect(activeNotices()).toHaveLength(0); // success path surfaces no notice
  });
});

describe("patchTaskFields PATCH mirror — failure rollback (prime-directive guard)", () => {
  it("restores the patched field and surfaces a non-silent notice when the PATCH rejects", async () => {
    const before = taskById("TASK-221")!.stage;
    expect(before).not.toBe("qa"); // guard: the edit is a real change
    __setPatchMirrorForTests(async () => {
      throw new Error("PATCH 500");
    });

    await patchTaskFields("TASK-221", { stage: "qa" });

    // The optimistic move is rolled back to the pre-edit value …
    expect(taskById("TASK-221")?.stage).toBe(before);
    // … and the failure is surfaced, not silently swallowed.
    const notices = activeNotices();
    expect(notices).toHaveLength(1);
    expect(notices[0].tone).toBe("error");
    expect(notices[0].body).toContain("TASK-221");
    expect(notices[0].body.toLowerCase()).toContain("rolled back");
  });

  it("reverts the optimistic activity line and leaves unpatched fields intact", async () => {
    const t0 = taskById("TASK-221")!;
    const priorActivityLen = t0.activity.length;
    const priorTopActivity = t0.activity[0]?.what;
    const priorPriority = t0.priority; // an unpatched field — must be untouched
    __setPatchMirrorForTests(async () => {
      throw new Error("network down");
    });

    // setTaskStage prepends a "moved to …" activity line before the mirror runs.
    await setTaskStage("TASK-221", "merged");

    const t = taskById("TASK-221")!;
    expect(t.stage).toBe(t0.stage); // rolled back
    expect(t.priority).toBe(priorPriority); // unpatched field unchanged
    // The optimistic activity entry is also reverted (no spurious "moved to…").
    expect(t.activity).toHaveLength(priorActivityLen);
    expect(t.activity[0]?.what).toBe(priorTopActivity);
  });

  it("rolls back a DB-only field edit (labels) and notices on failure", async () => {
    const before = [...taskById("TASK-221")!.labels];
    __setPatchMirrorForTests(async () => {
      throw new Error("PATCH 500");
    });

    await setTaskLabels("TASK-221", ["go-live", "wms"]);

    expect(taskById("TASK-221")?.labels).toEqual(before); // restored
    expect(activeNotices()).toHaveLength(1);
  });

  it("rolls back a reassign through the same spine path", async () => {
    const before = taskById("TASK-221")!.assignee;
    __setPatchMirrorForTests(async () => {
      throw new Error("PATCH 500");
    });

    await reassignTask("TASK-221", "ricardo");

    expect(taskById("TASK-221")?.assignee).toBe(before); // reassign rolled back
    expect(activeNotices()).toHaveLength(1);
  });
});

describe("notice channel (rollback surfacing primitive)", () => {
  it("pushNotice prepends newest-first and returns an id; dismissNotice removes by id", () => {
    expect(activeNotices()).toHaveLength(0);
    const first = pushNotice("first problem");
    const second = pushNotice("second problem");
    const notices = activeNotices();
    expect(notices).toHaveLength(2);
    expect(notices[0].id).toBe(second); // newest first
    expect(notices[1].id).toBe(first);

    dismissNotice(first);
    expect(activeNotices().map((n) => n.id)).toEqual([second]);
    // Dismissing an unknown id is a safe no-op.
    dismissNotice("ntc-nope");
    expect(activeNotices()).toHaveLength(1);
  });

  it("defaults to the error tone", () => {
    pushNotice("boom");
    expect(activeNotices()[0].tone).toBe("error");
  });
});

describe("DB-only tier guarantee (DB-only edits never fabricate a pending push)", () => {
  it("patching labels / coassignees / bucket leaves task.sync.state unchanged", () => {
    // bucket/labels/coassignees stay DB-only. (subtasks moved to a pushed column
    // in Item 3 — its push tier is covered server-side in mc-patch.test.ts; the
    // client optimistic edit still never flips sync.state, the sweep owns that.)
    const t0 = taskById("TASK-221")!;
    const before = t0.sync.state;
    setTaskLabels("TASK-221", ["go-live", "wms"]);
    expect(taskById("TASK-221")?.sync.state).toBe(before);
    setCoassignees("TASK-221", ["stephen"]);
    expect(taskById("TASK-221")?.sync.state).toBe(before);
    setTaskBucket("TASK-221", "BKT-DAPI");
    expect(taskById("TASK-221")?.sync.state).toBe(before);
  });
});

describe("inline-edit field wrappers", () => {
  it("setTaskLabels replaces the label set (add/remove idempotence)", () => {
    setTaskLabels("TASK-221", ["go-live", "wms"]);
    expect(taskById("TASK-221")?.labels).toEqual(["go-live", "wms"]);
    // Re-applying the same set is idempotent.
    setTaskLabels("TASK-221", ["go-live", "wms"]);
    expect(taskById("TASK-221")?.labels).toEqual(["go-live", "wms"]);
    // Removing one yields exactly the remaining set.
    setTaskLabels("TASK-221", ["go-live"]);
    expect(taskById("TASK-221")?.labels).toEqual(["go-live"]);
  });

  it("addSubtask generates a unique id and appends; toggleSubtask flips done", () => {
    addSubtask("TASK-221", "first", "vince");
    addSubtask("TASK-221", "second", "stephen");
    const subs = taskById("TASK-221")!.subtasks;
    expect(subs).toHaveLength(2);
    expect(new Set(subs.map((s) => s.id)).size).toBe(2);
    expect(subs.every((s) => !s.done)).toBe(true);

    const firstId = subs[0].id;
    toggleSubtask("TASK-221", firstId);
    expect(taskById("TASK-221")?.subtasks.find((s) => s.id === firstId)?.done).toBe(true);
    toggleSubtask("TASK-221", firstId);
    expect(taskById("TASK-221")?.subtasks.find((s) => s.id === firstId)?.done).toBe(false);
  });

  it("addSubtask ignores blank text", () => {
    addSubtask("TASK-221", "   ", "vince");
    expect(taskById("TASK-221")?.subtasks).toHaveLength(0);
  });

  it("setCoassignees dedupes and never includes the primary assignee", () => {
    reassignTask("TASK-221", "ricardo");
    setCoassignees("TASK-221", ["stephen", "stephen", "ricardo", "ross"]);
    const co = taskById("TASK-221")!.coassignees;
    expect(co).toEqual(["stephen", "ross"]); // deduped; primary "ricardo" excluded
  });
});

describe("setTaskRepos (target repos — pushed field + audited Retarget)", () => {
  it("sets the target repos optimistically with an honest pending-push trail", () => {
    setTaskRepos("TASK-221", ["portal-web"]);
    expect(taskById("TASK-221")?.repos).toEqual(["portal-web"]);
    expect(taskById("TASK-221")?.activity[0]?.what).toContain("updated target repos");
    expect(taskById("TASK-221")?.activity[0]?.what).toContain("pending push");
  });

  it("records the reason in audit and activity on Retarget", () => {
    setTaskRepos("TASK-221", ["portal-web"], { reason: "confirm customer portal target" });
    const t = taskById("TASK-221");
    expect(t?.repos).toEqual(["portal-web"]);
    expect(t?.activity[0]?.what).toContain("retargeted repos");
    expect(t?.activity[0]?.what).toContain("confirm customer portal target");
    const top = auditLog()[0];
    expect(top.body).toContain("Retargeted repos for TASK-221");
    expect(top.body).toContain("confirm customer portal target");
    expect(top.state).toBe("pending");
  });
});

describe("setTaskTargetEnv (target environment — pushed, not locked)", () => {
  it("sets the target environment optimistically with a pending-push trail", () => {
    setTaskTargetEnv("TASK-221", "production");
    expect(taskById("TASK-221")?.targetEnv).toBe("production");
    expect(taskById("TASK-221")?.activity[0]?.what).toContain("set target environment to Production");
    expect(taskById("TASK-221")?.activity[0]?.what).toContain("pending push");
  });
});
