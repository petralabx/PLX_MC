// Server invariants for projects (P2): createProject id-generation, defaults,
// allow-list enforcement, patchProject merge / unknown-id.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@/lib/mc-data";

const store = vi.hoisted(() => ({
  repos: [] as { id: string; name: string; lang: string; def: string; owner: string; visibility: string; scope: string }[],
  projects: [] as Project[],
  upserts: [] as Project[],
  audits: [] as string[],
}));

vi.mock("@/lib/sync/engine", () => ({
  ensureSeeded: vi.fn(async () => true),
  ensureReposSeeded: vi.fn(async () => {}),
  ensureProjectsSeeded: vi.fn(async () => {}),
  ensureBucketsSeeded: vi.fn(async () => {}),
}));

vi.mock("@/lib/sync/repo", () => ({
  stamp: () => "2026.06.18 · 12:00",
  async getRepos() {
    return store.repos;
  },
  async getProjects() {
    return store.projects;
  },
  async upsertProject(p: Project) {
    store.upserts.push(p);
  },
  async appendAudit(actor: string) {
    store.audits.push(actor);
  },
}));

import { createProject, patchProject } from "@/lib/sync/state";

beforeEach(() => {
  store.repos = [
    { id: "plx-mc", name: "PLX_MC", lang: "TypeScript", def: "main", owner: "taylorvalton", visibility: "public", scope: "MC" },
  ];
  store.projects = [];
  store.upserts.length = 0;
  store.audits.length = 0;
});

describe("createProject (P2)", () => {
  it("generates a PRJ-<slug> id, applies defaults, and upserts the project", async () => {
    const p = await createProject({ name: "Mission Control Ops" });
    expect(p.id).toBe("PRJ-MISSION-CONTROL-OPS");
    expect(p.sync.state).toBe("pending");
    expect(store.upserts).toHaveLength(1);
  });

  it("suffixes the id on collision", async () => {
    store.projects = [{ id: "PRJ-OPS" } as Project];
    const p = await createProject({ name: "Ops" });
    expect(p.id).toBe("PRJ-OPS-2");
  });

  it("records the authenticated actor separately from the assigned owner", async () => {
    await createProject(
      { name: "Delegated project", owner: "assigned-owner" },
      "session-actor@example.com"
    );
    expect(store.audits).toEqual(["session-actor@example.com"]);
  });
});

describe("patchProject (P2)", () => {
  it("merges defined fields and upserts; ignores unknown id", async () => {
    store.projects = [
      {
        id: "PRJ-FIN",
        name: "Finance",
        owner: "vince",
        health: "track",
        target: "Jul 20",
        started: "2026.06.11",
        desc: "x",
        repos: [],
        sync: { state: "pending", ts: "—", sp: "Projects · unprovisioned" },
        prd: null,
      },
    ];
    const next = await patchProject("PRJ-FIN", { health: "risk" }, "vince");
    expect(next?.health).toBe("risk");
    expect(await patchProject("PRJ-MISSING", { health: "risk" }, "vince")).toBeNull();
  });
});
