// GET /api/state must not leak restricted names via audit / conflicts / errors
// after hierarchy scoping.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { principalFromTokens } from "@/lib/permissions/project-acl";

const mocks = vi.hoisted(() => ({
  snapshot: vi.fn(),
  aclPrincipalFromSession: vi.fn(),
}));

vi.mock("@/lib/sync", () => ({
  snapshot: mocks.snapshot,
}));

vi.mock("@/lib/routing/mutations/actors", () => ({
  aclPrincipalFromSession: mocks.aclPrincipalFromSession,
}));

vi.mock("@/lib/api/route", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/route")>("@/lib/api/route");
  return {
    ...actual,
    route: (handler: () => Promise<unknown>) => handler,
  };
});

describe("GET /api/state restricted side channels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.aclPrincipalFromSession.mockResolvedValue(principalFromTokens("greg@petrasoap.com"));
    mocks.snapshot.mockResolvedValue({
      tasks: [
        { id: "TASK-OPEN", bucket: "BKT-OPEN", title: "public" },
        { id: "TASK-SECRET", bucket: "BKT-SECRET", title: "private contents" },
      ],
      buckets: [
        { id: "BKT-OPEN", project: "PRJ-OPEN", name: "Open" },
        { id: "BKT-SECRET", project: "PRJ-SECRET", name: "Secret initiative" },
      ],
      projects: [
        { id: "PRJ-OPEN", visibility: "shared", name: "Open" },
        {
          id: "PRJ-SECRET",
          visibility: "restricted",
          members: ["vince@petrasoap.com"],
          name: "Secret project",
        },
      ],
      bucketComments: {
        "BKT-OPEN": [{ id: "c1", body: "ok" }],
        "BKT-SECRET": [{ id: "c2", body: "classified" }],
      },
      conflicts: [
        {
          id: "cf-open",
          list: "ToDos",
          entity: "ToDos",
          entityId: "TASK-OPEN",
          field: "title",
          mcVal: "public",
          spVal: "public",
          detected: "t",
          by: "sync",
          note: "",
        },
        {
          id: "cf-secret",
          list: "ToDos",
          entity: "ToDos",
          entityId: "TASK-SECRET",
          field: "title",
          mcVal: "private contents",
          spVal: "x",
          detected: "t",
          by: "sync",
          note: "",
        },
      ],
      errors: [
        {
          id: "er-open",
          list: "Projects",
          entity: "Project",
          entityId: "PRJ-OPEN",
          field: "name",
          value: "Open",
          reason: "ok",
        },
        {
          id: "er-secret",
          list: "Projects",
          entity: "Project",
          entityId: "PRJ-SECRET",
          field: "name",
          value: "Secret project",
          reason: "lookup",
        },
      ],
      audit: [
        { ts: "t1", actor: "sync", body: "Created task TASK-OPEN (public).", state: "synced" },
        {
          ts: "t2",
          actor: "sync",
          body: "Created task TASK-SECRET (private contents).",
          state: "synced",
        },
      ],
    });
  });

  it("strips restricted hierarchy and side-channel rows for an outsider", async () => {
    const { GET } = await import("@/app/api/state/route");
    const snap = (await GET(new Request("http://localhost/api/state"), {
      params: Promise.resolve({}),
    })) as unknown as {
      tasks: Array<{ id: string }>;
      buckets: Array<{ id: string }>;
      projects: Array<{ id: string }>;
      bucketComments: Record<string, unknown[]>;
      conflicts: Array<{ id: string }>;
      errors: Array<{ id: string }>;
      audit: Array<{ ts: string }>;
    };
    expect(snap.tasks.map((row) => row.id)).toEqual(["TASK-OPEN"]);
    expect(snap.buckets.map((row) => row.id)).toEqual(["BKT-OPEN"]);
    expect(snap.projects.map((row) => row.id)).toEqual(["PRJ-OPEN"]);
    expect(Object.keys(snap.bucketComments)).toEqual(["BKT-OPEN"]);
    expect(snap.conflicts.map((row) => row.id)).toEqual(["cf-open"]);
    expect(snap.errors.map((row) => row.id)).toEqual(["er-open"]);
    expect(snap.audit.map((row) => row.ts)).toEqual(["t1"]);
  });

  it("keeps restricted side channels for a project member", async () => {
    mocks.aclPrincipalFromSession.mockResolvedValue(principalFromTokens("vince@petrasoap.com"));
    const { GET } = await import("@/app/api/state/route");
    const snap = (await GET(new Request("http://localhost/api/state"), {
      params: Promise.resolve({}),
    })) as unknown as {
      tasks: Array<{ id: string }>;
      conflicts: Array<{ id: string }>;
      audit: Array<{ ts: string }>;
    };
    expect(snap.tasks.map((row) => row.id)).toEqual(["TASK-OPEN", "TASK-SECRET"]);
    expect(snap.conflicts.map((row) => row.id)).toEqual(["cf-open", "cf-secret"]);
    expect(snap.audit.map((row) => row.ts)).toEqual(["t1", "t2"]);
  });
});
