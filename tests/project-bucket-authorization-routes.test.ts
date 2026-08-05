// Project/Bucket session routes must derive the human actor server-side.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/route";

const mocks = vi.hoisted(() => ({
  requireSessionActor: vi.fn(),
  createProject: vi.fn(),
  createBucket: vi.fn(),
  patchProject: vi.fn(),
  patchBucket: vi.fn(),
}));

vi.mock("@/lib/routing/mutations/actors", () => ({
  requireSessionActor: mocks.requireSessionActor,
}));

vi.mock("@/lib/sync", () => ({
  createProject: mocks.createProject,
  createBucket: mocks.createBucket,
  patchProject: mocks.patchProject,
  patchBucket: mocks.patchBucket,
}));

vi.mock("@/lib/api/route", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/route")>("@/lib/api/route");
  return {
    ...actual,
    route: (handler: (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<unknown>) =>
      handler,
  };
});

const authorizedActor = {
  actor: { kind: "human" as const, id: "oid-owner", role: "owner" as const, status: "active" as const },
  actorId: "oid-owner",
  actorKind: "human" as const,
  auditLabel: "vince@example.com",
};

function request(path: string, method: "POST" | "PATCH", body: Record<string, unknown>) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("project and bucket authorization routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSessionActor.mockResolvedValue(authorizedActor);
    mocks.createProject.mockResolvedValue({ id: "PRJ-1" });
    mocks.createBucket.mockResolvedValue({ id: "BKT-1" });
    mocks.patchProject.mockResolvedValue({ id: "PRJ-1" });
    mocks.patchBucket.mockResolvedValue({ id: "BKT-1" });
  });

  it("POST /api/projects authorizes project.create and records the session actor", async () => {
    const { POST } = await import("@/app/api/projects/route");
    await POST(
      request("/api/projects", "POST", {
        name: "Secure project",
        owner: "assigned-owner",
        actor: "spoofed-actor",
      }),
      { params: Promise.resolve({}) }
    );

    expect(mocks.requireSessionActor).toHaveBeenCalledWith("project.create");
    expect(mocks.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Secure project", owner: "assigned-owner" }),
      "vince@example.com"
    );
    expect(mocks.createProject.mock.calls[0][0]).not.toHaveProperty("actor");
  });

  it("POST /api/buckets authorizes bucket.create in the selected project", async () => {
    const { POST } = await import("@/app/api/buckets/route");
    await POST(
      request("/api/buckets", "POST", {
        name: "Secure bucket",
        project: "PRJ-1",
        actor: "spoofed-actor",
      }),
      { params: Promise.resolve({}) }
    );

    expect(mocks.requireSessionActor).toHaveBeenCalledWith("bucket.create", {
      type: "project",
      id: "PRJ-1",
    });
    expect(mocks.createBucket).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Secure bucket", project: "PRJ-1" }),
      "vince@example.com"
    );
    expect(mocks.createBucket.mock.calls[0][0]).not.toHaveProperty("actor");
  });

  it("PATCH routes ignore body.actor and use the authorized audit label", async () => {
    const [{ PATCH: patchProject }, { PATCH: patchBucket }] = await Promise.all([
      import("@/app/api/projects/[id]/route"),
      import("@/app/api/buckets/[id]/route"),
    ]);

    await patchProject(
      request("/api/projects/PRJ-1", "PATCH", {
        actor: "spoofed-project-actor",
        health: "risk",
      }),
      { params: Promise.resolve({ id: "PRJ-1" }) }
    );
    await patchBucket(
      request("/api/buckets/BKT-1", "PATCH", {
        actor: "spoofed-bucket-actor",
        health: "off",
      }),
      { params: Promise.resolve({ id: "BKT-1" }) }
    );

    expect(mocks.requireSessionActor).toHaveBeenNthCalledWith(1, "project.update", {
      type: "project",
      id: "PRJ-1",
    });
    expect(mocks.requireSessionActor).toHaveBeenNthCalledWith(2, "bucket.update", {
      type: "bucket",
      id: "BKT-1",
    });
    expect(mocks.patchProject).toHaveBeenCalledWith(
      "PRJ-1",
      { health: "risk" },
      "vince@example.com"
    );
    expect(mocks.patchBucket).toHaveBeenCalledWith(
      "BKT-1",
      { health: "off" },
      "vince@example.com"
    );
  });

  it.each([
    ["project create", () => import("@/app/api/projects/route"), "/api/projects", "POST", { name: "Denied" }],
    ["bucket create", () => import("@/app/api/buckets/route"), "/api/buckets", "POST", { name: "Denied" }],
    [
      "project update",
      () => import("@/app/api/projects/[id]/route"),
      "/api/projects/PRJ-1",
      "PATCH",
      { health: "risk" },
    ],
    [
      "bucket update",
      () => import("@/app/api/buckets/[id]/route"),
      "/api/buckets/BKT-1",
      "PATCH",
      { health: "risk" },
    ],
  ] as const)("does not mutate when a member is denied %s", async (_label, load, path, method, body) => {
    mocks.requireSessionActor.mockRejectedValue(
      new ApiError("forbidden", "capability_not_granted", 403)
    );
    const routeModule = await load();
    const handler = "POST" in routeModule ? routeModule.POST : routeModule.PATCH;
    const id = path.includes("PRJ-") ? "PRJ-1" : path.includes("BKT-") ? "BKT-1" : "";
    const params: Record<string, string> = id ? { id } : {};

    await expect(
      handler(request(path, method, body), {
        params: Promise.resolve(params),
      })
    ).rejects.toMatchObject({ code: "forbidden", status: 403 });

    expect(mocks.createProject).not.toHaveBeenCalled();
    expect(mocks.createBucket).not.toHaveBeenCalled();
    expect(mocks.patchProject).not.toHaveBeenCalled();
    expect(mocks.patchBucket).not.toHaveBeenCalled();
  });
});
