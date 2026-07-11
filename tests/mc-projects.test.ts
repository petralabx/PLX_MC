// Store invariants for projects (P2): create + optimistic edit
// (reconcile-on-success / rollback+notice-on-failure), getters, allow-list clamping.

import { beforeEach, describe, expect, it } from "vitest";

import {
  __projectCreateSettled,
  __projectUpdateSettled,
  __setProjectCreateMirrorForTests,
  __setProjectUpdateMirrorForTests,
  activeNotices,
  addProject,
  allProjects,
  projectById,
  resetStore,
  updateProject,
} from "@/lib/mc-data/store";
import type { Project } from "@/lib/mc-data";

const serverProject = (over: Partial<Project>): Project => ({
  id: "PRJ-SERVER",
  name: "Server",
  owner: "vince",
  health: "track",
  target: "—",
  started: "2026.06.18",
  desc: "",
  repos: [],
  sync: { state: "pending", ts: "—", sp: "Projects · unprovisioned" },
  prd: null,
  ...over,
});

beforeEach(() => resetStore());

describe("addProject (P2)", () => {
  it("creates a project with a PRJ-<slug> id + defaults, visible via allProjects/projectById", () => {
    const before = allProjects().length;
    const p = addProject({ name: "Customer Portal" });
    expect(p.id).toBe("PRJ-CUSTOMER-PORTAL");
    expect(p.health).toBe("track");
    expect(allProjects().length).toBe(before + 1);
    expect(projectById(p.id)?.name).toBe("Customer Portal");
  });

  it("adopts the server's project on a resolved create mirror", async () => {
    __setProjectCreateMirrorForTests(async (input) => serverProject({ id: "PRJ-SERVER", name: input.name }));
    const optimistic = addProject({ name: "Server Owned" });
    await __projectCreateSettled();
    expect(projectById(optimistic.id)).toBeUndefined();
    expect(projectById("PRJ-SERVER")?.name).toBe("Server Owned");
  });

  it("rolls back the optimistic project + notices when the create mirror rejects", async () => {
    __setProjectCreateMirrorForTests(async () => {
      throw new Error("POST 500");
    });
    const p = addProject({ name: "Doomed Project" });
    expect(projectById(p.id)).toBeDefined();
    await __projectCreateSettled();
    expect(projectById(p.id)).toBeUndefined();
    expect(activeNotices().some((n) => /rolled back/i.test(n.body))).toBe(true);
  });
});

describe("updateProject (P2)", () => {
  it("optimistically merges and reconciles on success", async () => {
    const p = addProject({ name: "Alpha" });
    __setProjectUpdateMirrorForTests(async (id, patch) => serverProject({ id, name: patch.name ?? "Alpha" }));
    void updateProject(p.id, { name: "Beta" });
    expect(projectById(p.id)?.name).toBe("Beta");
    await __projectUpdateSettled();
    expect(projectById(p.id)?.name).toBe("Beta");
  });

  // The ProjectDetail edit spine (P2 edit parity): each field the screen edits
  // inline must mutate store state optimistically.
  it("applies each editable field optimistically (health, owner, target, desc)", () => {
    const p = addProject({ name: "Gamma" });
    updateProject(p.id, { health: "risk" });
    updateProject(p.id, { owner: "stephen" });
    updateProject(p.id, { target: "Sep 15" });
    updateProject(p.id, { desc: "Edited from ProjectDetail" });
    const after = projectById(p.id)!;
    expect(after.health).toBe("risk");
    expect(after.owner).toBe("stephen");
    expect(after.target).toBe("Sep 15");
    expect(after.desc).toBe("Edited from ProjectDetail");
  });

  it("adopts the server's project on a resolved mirror (no notice on success)", async () => {
    const p = addProject({ name: "Delta" });
    __setProjectUpdateMirrorForTests(async (id, patch) => ({
      ...projectById(id)!,
      ...patch,
      desc: "server-canonical",
    }));
    await updateProject(p.id, { health: "off" });
    await __projectUpdateSettled();
    expect(projectById(p.id)?.health).toBe("off");
    expect(projectById(p.id)?.desc).toBe("server-canonical"); // reconciled to DB truth
    expect(activeNotices()).toHaveLength(0);
  });

  it("rolls back + surfaces a notice when the mirror rejects", async () => {
    const p = addProject({ name: "Epsilon", target: "Jul 30", desc: "original" });
    const before = projectById(p.id)!;
    __setProjectUpdateMirrorForTests(async () => {
      throw new Error("PATCH 500");
    });
    await updateProject(p.id, { health: "off", owner: "stephen", target: "Dec 01", desc: "doomed" });
    await __projectUpdateSettled();
    const after = projectById(p.id)!;
    expect(after.health).toBe(before.health); // rolled back
    expect(after.owner).toBe(before.owner);
    expect(after.target).toBe(before.target);
    expect(after.desc).toBe(before.desc);
    expect(activeNotices().some((n) => /rolled back/i.test(n.body))).toBe(true);
  });

  it("treats an empty patch as a no-op (no mirror call)", async () => {
    const p = addProject({ name: "Zeta" });
    let called = 0;
    __setProjectUpdateMirrorForTests(async (id) => {
      called += 1;
      return projectById(id)!;
    });
    updateProject(p.id, {});
    await __projectUpdateSettled();
    expect(called).toBe(0);
  });
});
