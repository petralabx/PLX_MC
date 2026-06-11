// Invariant tests for the runtime store (the client cache over the sync
// engine): task creation, the sweep, safe no-op reconciliation, invites,
// reassignment. Conflict/error resolution semantics live in the engine
// (tests/sync-mapping.test.ts + the live evidence bundles); the store-side
// invariants here are the optimistic-local behaviors.
import { beforeEach, describe, expect, it } from "vitest";

import {
  addTask,
  allTasks,
  inboxNotifications,
  invitePerson,
  markAllSynced,
  markRead,
  nextTaskId,
  openConflicts,
  openErrors,
  reassignTask,
  resetStore,
  resolveConflict,
  retryError,
  storeSyncCounts,
  taskById,
  unreadCount,
} from "@/lib/mc-data/store";

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
});

describe("markAllSynced (the sweep)", () => {
  it("flips every pending item to synced and zeroes pending counts", () => {
    addTask({ title: "x", bucket: "BKT-WMS" });
    markAllSynced();
    const counts = storeSyncCounts();
    expect(counts.pending).toBe(0);
    expect(allTasks().every((t) => t.sync.state !== "pending")).toBe(true);
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
  it("sets the assignee and logs the notify trail", () => {
    reassignTask("TASK-221", "priya");
    const t = taskById("TASK-221");
    expect(t?.assignee).toBe("priya");
    expect(t?.activity[0]?.what).toContain("mirrored to SharePoint");
  });

  it("supports unassigning", () => {
    reassignTask("TASK-222", "felix");
    reassignTask("TASK-222", null);
    const t = taskById("TASK-222");
    expect(t?.assignee).toBeNull();
    expect(t?.activity[0]?.what).toContain("unassigned");
  });
});
