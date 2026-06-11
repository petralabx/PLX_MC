// Invariant tests for the runtime store (the prototype sync engine): task
// creation, the sweep, conflict resolution, error retry, invites.
import { beforeEach, describe, expect, it } from "vitest";

import {
  addTask,
  allRisks,
  allTasks,
  applyInbound,
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
    const t = addTask({ title: "  New thing  ", bucket: "BKT-CPV2" });
    expect(t.id).toBe(id);
    expect(t.title).toBe("New thing");
    expect(t.stage).toBe("backlog");
    expect(t.sync.state).toBe("pending");
    expect(t.userCreated).toBe(true);
    expect(allTasks().some((x) => x.id === t.id)).toBe(true);
    expect(storeSyncCounts().pending).toBe(before.pending + 1);
  });
});

describe("markAllSynced + applyInbound (the sweep)", () => {
  it("flips every pending item to synced and zeroes pending counts", () => {
    addTask({ title: "x", bucket: "BKT-CPV2" });
    markAllSynced();
    const counts = storeSyncCounts();
    expect(counts.pending).toBe(0);
    expect(allTasks().every((t) => t.sync.state !== "pending")).toBe(true);
  });

  it("pulls exactly one inbound edit, once", () => {
    const first = applyInbound();
    expect(first).toEqual(
      expect.objectContaining({ taskId: "TASK-188", field: "Due Date", to: "Jun 13" })
    );
    expect(taskById("TASK-188")?.due).toBe("Jun 13");
    expect(applyInbound()).toBeNull();
  });
});

describe("resolveConflict", () => {
  it("removes the conflict, decrements the list count, and marks the entity synced", () => {
    const before = storeSyncCounts();
    resolveConflict("cf-140", "sp");
    expect(openConflicts().some((c) => c.id === "cf-140")).toBe(false);
    expect(storeSyncCounts().conflict).toBe(before.conflict - 1);
    expect(taskById("TASK-140")?.sync.state).toBe("synced");
  });

  it("marks Risk entities synced too (risks live in the store)", () => {
    resolveConflict("cf-risk1", "mc");
    expect(allRisks().find((r) => r.id === "RISK-1")?.sync.state).toBe("synced");
  });
});

describe("retryError", () => {
  it("normalizes the value, clears the error, decrements the count, and syncs the risk", () => {
    const before = storeSyncCounts();
    retryError("er-risk4");
    expect(openErrors()).toHaveLength(0);
    expect(storeSyncCounts().error).toBe(before.error - 1);
    const risk = allRisks().find((r) => r.id === "RISK-4");
    expect(risk?.sync.state).toBe("synced");
    expect(risk?.sync.reason).toBeUndefined();
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
    reassignTask("TASK-133", "priya");
    const t = taskById("TASK-133");
    expect(t?.assignee).toBe("priya");
    expect(t?.activity[0]?.what).toContain("mirrored to SharePoint");
  });

  it("supports unassigning", () => {
    reassignTask("TASK-129", null);
    const t = taskById("TASK-129");
    expect(t?.assignee).toBeNull();
    expect(t?.activity[0]?.what).toContain("unassigned");
  });
});
