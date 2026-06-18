// Store invariants for the EN-001 / WS-3 collaboration surface: comment CRUD,
// the @mention → notification path (honest deferred-mirror, no fabricated
// delivery), enriched sub-task edits + promote-to-task, the editable
// description, and the store-authoritative bucket thread. Runs through the same
// optimistic spine the rest of the store uses (serverCall is a no-op under the
// Node test env; the injected mirror exercises the reconcile path).

import { beforeEach, describe, expect, it } from "vitest";

import {
  __setPatchMirrorForTests,
  addBucketComment,
  addComment,
  addSubtask,
  allTasks,
  auditLog,
  commentsForBucket,
  deleteBucketComment,
  deleteComment,
  editBucketComment,
  editComment,
  inboxNotifications,
  promoteSubtaskToTask,
  reorderSubtasks,
  resetStore,
  setTaskDescription,
  taskById,
  unreadCount,
  updateSubtask,
} from "@/lib/mc-data/store";
import { CURRENT_USER } from "@/lib/mc-data";

beforeEach(() => resetStore());

describe("task comments — add / edit / delete", () => {
  it("adds a comment with a stamp + parsed mentions, persisted on the task", () => {
    const c = addComment("TASK-221", "first note @greg", "vince");
    expect(c).not.toBeNull();
    const t = taskById("TASK-221")!;
    expect(t.comments).toHaveLength(1);
    expect(t.comments![0].body).toBe("first note @greg");
    expect(t.comments![0].author).toBe("vince");
    expect(t.comments![0].mentions).toEqual(["greg"]);
    expect(t.comments![0].ts).not.toBe("");
  });

  it("ignores a blank comment body", () => {
    expect(addComment("TASK-221", "   ", "vince")).toBeNull();
    expect(taskById("TASK-221")!.comments ?? []).toHaveLength(0);
  });

  it("edits only the author's own comment and stamps editedTs", () => {
    const c = addComment("TASK-221", "draft", "vince")!;
    editComment("TASK-221", c.id, "polished @ricardo", "vince");
    const edited = taskById("TASK-221")!.comments!.find((x) => x.id === c.id)!;
    expect(edited.body).toBe("polished @ricardo");
    expect(edited.mentions).toEqual(["ricardo"]);
    expect(edited.editedTs).toBeTruthy();
  });

  it("refuses to edit or delete a comment the actor does not own", () => {
    const c = addComment("TASK-221", "mine", "vince")!;
    editComment("TASK-221", c.id, "hijacked", "greg");
    expect(taskById("TASK-221")!.comments![0].body).toBe("mine");
    deleteComment("TASK-221", c.id, "greg");
    expect(taskById("TASK-221")!.comments).toHaveLength(1);
  });

  it("deletes the author's own comment", () => {
    const c = addComment("TASK-221", "bye", "vince")!;
    deleteComment("TASK-221", c.id, "vince");
    expect(taskById("TASK-221")!.comments).toHaveLength(0);
  });
});

describe("@mention → notification (same deferred-mirror path as assignment)", () => {
  it("creates an inbox mention notification and an honest deferred-mirror audit row", () => {
    const before = unreadCount();
    addComment("TASK-221", "please review @greg @ricardo", "vince");
    expect(unreadCount()).toBe(before + 2);
    const mentions = inboxNotifications().filter((n) => n.kind === "mention" && n.task === "TASK-221");
    expect(mentions.length).toBeGreaterThanOrEqual(2);
    // The audit row must not claim a delivery that did not happen.
    const top = auditLog()[0];
    expect(top.body).toContain("deferred to the directory/notification increment");
    expect(top.body).not.toContain("notified via Teams");
    expect(top.state).toBe("pending");
  });

  it("does not notify the author when they mention themselves", () => {
    const before = unreadCount();
    addComment("TASK-221", "note to self @vince", "vince");
    expect(unreadCount()).toBe(before);
  });
});

describe("enriched sub-tasks — field edits, status/done consistency, reorder", () => {
  it("updates description / assignee / due / status and keeps done in lockstep", () => {
    addSubtask("TASK-221", "spike the adapter", "vince");
    const subId = taskById("TASK-221")!.subtasks[0].id;
    updateSubtask("TASK-221", subId, {
      description: "look at the WMS SDK",
      assignee: "ricardo",
      due: "Jun 22",
      status: "doing",
    });
    let sub = taskById("TASK-221")!.subtasks[0];
    expect(sub.description).toBe("look at the WMS SDK");
    expect(sub.assignee).toBe("ricardo");
    expect(sub.due).toBe("Jun 22");
    expect(sub.status).toBe("doing");
    expect(sub.done).toBe(false);

    updateSubtask("TASK-221", subId, { status: "done" });
    sub = taskById("TASK-221")!.subtasks[0];
    expect(sub.done).toBe(true); // a done status implies the checkbox is done
  });

  it("reorders sub-tasks by id list", () => {
    addSubtask("TASK-221", "a", "vince");
    addSubtask("TASK-221", "b", "vince");
    const [a, b] = taskById("TASK-221")!.subtasks.map((s) => s.id);
    reorderSubtasks("TASK-221", [b, a]);
    expect(taskById("TASK-221")!.subtasks.map((s) => s.id)).toEqual([b, a]);
  });
});

describe("promote-to-task (reuses addTask)", () => {
  it("creates a governed task from a sub-task and removes it from the parent", () => {
    addSubtask("TASK-221", "carve out the migration", "ricardo");
    const subId = taskById("TASK-221")!.subtasks[0].id;
    updateSubtask("TASK-221", subId, { description: "details", assignee: "ricardo", due: "Aug 31" });
    const beforeCount = allTasks().length;

    const created = promoteSubtaskToTask("TASK-221", subId);

    expect(created).not.toBeNull();
    expect(allTasks().length).toBe(beforeCount + 1);
    expect(created!.title).toBe("carve out the migration");
    expect(created!.description).toBe("details");
    expect(created!.assignee).toBe("ricardo");
    expect(created!.bucket).toBe("BKT-WMS"); // inherits the parent's bucket
    // The sub-task is gone from the parent, and a traceable activity line exists.
    expect(taskById("TASK-221")!.subtasks.find((s) => s.id === subId)).toBeUndefined();
    expect(taskById("TASK-221")!.activity[0].what).toContain(`promoted a subtask to ${created!.id}`);
  });
});

describe("editable description (SP-tier — claims a pending push, then reconciles)", () => {
  it("applies optimistically with an honest pending-push trail", () => {
    setTaskDescription("TASK-221", "Now with a real description.");
    const t = taskById("TASK-221")!;
    expect(t.description).toBe("Now with a real description.");
    expect(t.activity[0].what).toContain("pending push");
  });

  it("adopts the server's reconciled task on a resolved mirror", async () => {
    const serverTask = { ...taskById("TASK-221")!, description: "Server-canonical description." };
    __setPatchMirrorForTests(async () => serverTask);
    await setTaskDescription("TASK-221", "client text");
    expect(taskById("TASK-221")!.description).toBe("Server-canonical description.");
  });
});

describe("bucket discussion thread (store-authoritative for v1)", () => {
  it("adds / edits / deletes a bucket comment and fires the mention audit", () => {
    const c = addBucketComment("BKT-WMS", "kickoff thread @greg", "vince")!;
    expect(commentsForBucket("BKT-WMS")).toHaveLength(1);
    expect(c.mentions).toEqual(["greg"]);
    expect(auditLog()[0].body).toContain("deferred to the directory/notification increment");

    editBucketComment("BKT-WMS", c.id, "kickoff revised", "vince");
    expect(commentsForBucket("BKT-WMS")[0].body).toBe("kickoff revised");
    expect(commentsForBucket("BKT-WMS")[0].editedTs).toBeTruthy();

    deleteBucketComment("BKT-WMS", c.id, "vince");
    expect(commentsForBucket("BKT-WMS")).toHaveLength(0);
  });

  it("does not let a non-author edit or delete a bucket comment", () => {
    const c = addBucketComment("BKT-WMS", "mine", "vince")!;
    editBucketComment("BKT-WMS", c.id, "nope", "greg");
    deleteBucketComment("BKT-WMS", c.id, "greg");
    expect(commentsForBucket("BKT-WMS")).toHaveLength(1);
    expect(commentsForBucket("BKT-WMS")[0].body).toBe("mine");
  });
});

// Guard CURRENT_USER assumption used above (mention-self test relies on it).
describe("test fixture assumptions", () => {
  it("CURRENT_USER is vince", () => {
    expect(CURRENT_USER).toBe("vince");
  });
});
