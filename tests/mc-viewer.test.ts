// Wave 2 — UI trust: the store's acting identity is the viewer the server
// resolved from the session (GET /api/viewer), never a hardcoded "vince".
// Server-side resolution is covered in tests/viewer-resolution.test.ts.
import { beforeEach, describe, expect, it } from "vitest";

import { greeting } from "@/components/mc/inbox";
import { HUMANS, type Human } from "@/lib/mc-data";
import {
  __setViewerLoaderForTests,
  addBucket,
  approveRepo,
  assignableViewerId,
  auditLog,
  hydrate,
  reassignTask,
  rejectRepo,
  repoRequests,
  requestRepo,
  resetStore,
  setTaskPriority,
  taskById,
  UNRESOLVED_VIEWER_ID,
  viewer,
  viewerId,
} from "@/lib/mc-data/store";

beforeEach(() => resetStore());

const UNLISTED: Human = {
  id: "jane.doe@petrasoap.com",
  kind: "human",
  name: "Jane Doe",
  init: "JD",
  role: "Contributor",
  online: true,
  email: "jane.doe@petrasoap.com",
};

describe("store viewer (acting identity)", () => {
  it("never attributes an action to 'vince' before the server has named the viewer", () => {
    reassignTask("TASK-221", "greg");
    const row = auditLog()[0];
    expect(row.body).toContain("Reassigned TASK-221");
    expect(row.actor).not.toBe("vince");
    expect(row.actor).toBe(UNRESOLVED_VIEWER_ID);
    expect(viewer()).toBeNull();
  });

  it("records the server-resolved viewer on audit, activity and ownership", async () => {
    __setViewerLoaderForTests(async () => HUMANS.greg);
    await hydrate();
    expect(viewerId()).toBe("greg");

    reassignTask("TASK-221", "ricardo");
    expect(auditLog()[0].actor).toBe("greg");

    setTaskPriority("TASK-221", "high");
    expect(taskById("TASK-221")!.activity[0].who).toBe("greg");

    expect(addBucket({ name: "Viewer-owned" }).owner).toBe("greg");
  });

  it("keeps an unlisted session viewer as themselves, but never as a default assignee", async () => {
    __setViewerLoaderForTests(async () => UNLISTED);
    await hydrate();
    expect(viewer()?.name).toBe("Jane Doe");
    expect(viewerId()).toBe("jane.doe@petrasoap.com");
    // Not a directory member → can't be offered as an owner/assignee default.
    expect(assignableViewerId()).toBeNull();

    __setViewerLoaderForTests(async () => HUMANS.ross);
    await hydrate();
    expect(assignableViewerId()).toBe("ross");
  });

  it("gates repo approval on the resolved viewer (fails closed while unresolved)", async () => {
    const req = requestRepo({ name: "viewer-gated" });
    expect(req.requestedBy).toBe(UNRESOLVED_VIEWER_ID);
    expect(approveRepo(req.id)).toBe(false);

    __setViewerLoaderForTests(async () => HUMANS.greg); // Contributor
    await hydrate();
    expect(approveRepo(req.id)).toBe(false);

    __setViewerLoaderForTests(async () => HUMANS.vince); // Owner
    await hydrate();
    expect(rejectRepo(req.id)).toBe(true);
    expect(repoRequests().find((r) => r.id === req.id)?.decidedBy).toBe("vince");
  });

  it("stays unresolved (not a fallback person) when the viewer load fails", async () => {
    __setViewerLoaderForTests(async () => {
      throw new Error("503");
    });
    await hydrate();
    expect(viewer()).toBeNull();
    expect(viewerId()).toBe(UNRESOLVED_VIEWER_ID);
  });
});

describe("Home greeting", () => {
  it("follows the time of day and the viewer's first name", () => {
    expect(greeting(9, HUMANS.greg)).toBe("Good morning, Greg");
    expect(greeting(14, HUMANS.ross)).toBe("Good afternoon, Ross");
    expect(greeting(19, UNLISTED)).toBe("Good evening, Jane");
  });

  it("names no one when the viewer is unknown, and stays neutral before the clock is read", () => {
    expect(greeting(9, null)).toBe("Good morning");
    expect(greeting(null, HUMANS.greg)).toBe("Hello, Greg");
    expect(greeting(null, null)).toBe("Hello");
  });
});
