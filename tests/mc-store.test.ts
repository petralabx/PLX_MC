// Invariant tests for the runtime store (the client cache over the sync
// engine): task creation, the sweep, safe no-op reconciliation, invites,
// reassignment. Conflict/error resolution semantics live in the engine
// (tests/sync-mapping.test.ts + the live evidence bundles); the store-side
// invariants here are the optimistic-local behaviors.
import { beforeEach, describe, expect, it } from "vitest";

import {
  __setPatchMirrorForTests,
  activeNotices,
  addSubtask,
  addTask,
  allTasks,
  auditLog,
  dismissNotice,
  inboxNotifications,
  invitePerson,
  markAllSynced,
  markRead,
  nextTaskId,
  openConflicts,
  openErrors,
  patchTaskFields,
  pushNotice,
  reassignTask,
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
  storeSyncCounts,
  taskById,
  toggleSubtask,
  unreadCount,
} from "@/lib/mc-data/store";
import { CURRENT_USER } from "@/lib/mc-data";
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
// assignee: CURRENT_USER, both routed through the FROZEN spine (optimistic +
// PATCH + reconcile/rollback + notice). The already-done / already-mine cases
// are handled by the palette HIDING the command (asserted by the gating predicates).
describe("palette spine actions — Mark done / Assign to me (Module G)", () => {
  it("'Mark done' sets stage to verified optimistically (reflected by taskById)", () => {
    // TASK-221 seeds as stage "planned" (band=todo), so this is a real change.
    expect(taskById("TASK-221")?.stage).toBe("planned");
    setTaskStage("TASK-221", "verified");
    expect(taskById("TASK-221")?.stage).toBe("verified");
  });

  it("'Assign to me' sets the assignee to CURRENT_USER optimistically", () => {
    // TASK-221 seeds unassigned (assignee null), so assigning to me is a change.
    expect(taskById("TASK-221")?.assignee).toBeNull();
    reassignTask("TASK-221", CURRENT_USER);
    expect(taskById("TASK-221")?.assignee).toBe(CURRENT_USER);
  });

  it("hides the action when already in the target state (the gating predicates)", () => {
    // The palette appends "Mark done" only when stage ∉ {verified, merged}, and
    // "Assign to me" only when assignee !== CURRENT_USER. Mirror those predicates
    // so the no-op-avoidance contract is pinned (SPEC §3.G.2).
    const done: Task = { ...taskById("TASK-221")!, stage: "verified" };
    const mine: Task = { ...taskById("TASK-221")!, assignee: CURRENT_USER };
    const isDone = (t: Task) => t.stage === "verified" || t.stage === "merged";
    expect(isDone(done)).toBe(true);
    expect(isDone({ ...done, stage: "merged" })).toBe(true);
    expect(isDone(taskById("TASK-221")!)).toBe(false); // "planned" → action shown
    expect(mine.assignee === CURRENT_USER).toBe(true); // → "Assign to me" hidden
    expect(taskById("TASK-221")!.assignee === CURRENT_USER).toBe(false); // → shown
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
    expect(before).not.toBe(CURRENT_USER); // guard: a real change
    __setPatchMirrorForTests(async () => {
      throw new Error("PATCH 500");
    });

    await reassignTask("TASK-221", CURRENT_USER);

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
