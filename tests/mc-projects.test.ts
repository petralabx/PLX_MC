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
  navProjects,
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

  // Overlapping saves (TASK-4414): a save settles after a later edit was applied.
  // Each settles by hand, in the order the test chooses.
  const deferredMirror = () => {
    const calls: Array<{ resolve: (p: Project) => void; reject: (e: Error) => void; patch: Partial<Project> }> = [];
    __setProjectUpdateMirrorForTests(
      (_id, patch) => new Promise<Project>((resolve, reject) => calls.push({ resolve, reject, patch }))
    );
    return calls;
  };
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it("a late failure rolls back only its own fields: a later edit survives", async () => {
    const p = addProject({ name: "Overlap" });
    const before = projectById(p.id)!;
    const calls = deferredMirror();
    void updateProject(p.id, { health: "risk" });
    void updateProject(p.id, { owner: "stephen" });
    calls[1].resolve({ ...projectById(p.id)!, owner: "stephen" });
    await settle();
    calls[0].reject(new Error("PATCH 500"));
    await settle();
    expect(projectById(p.id)?.health).toBe(before.health); // its own field rolls back
    expect(projectById(p.id)?.owner).toBe("stephen"); // the later, saved edit stays
    expect(activeNotices().some((n) => /rolled back/i.test(n.body))).toBe(true);
  });

  it("a success that lands after a later edit keeps that edit", async () => {
    const p = addProject({ name: "Overlap 2" });
    const calls = deferredMirror();
    void updateProject(p.id, { health: "risk" });
    void updateProject(p.id, { target: "Dec 31" });
    calls[0].resolve({ ...projectById(p.id)!, health: "risk", target: "—" }); // the server has not seen the target yet
    await settle();
    expect(projectById(p.id)?.health).toBe("risk");
    expect(projectById(p.id)?.target).toBe("Dec 31"); // the pending edit is not overwritten
  });

  it("two failed saves of one field roll back to the last saved value, not the first unsaved one", async () => {
    const p = addProject({ name: "Overlap 3", target: "Jul 30" });
    const calls = deferredMirror();
    void updateProject(p.id, { target: "Nov 01" });
    void updateProject(p.id, { target: "Dec 31" });
    calls[0].reject(new Error("PATCH 500"));
    await settle();
    expect(projectById(p.id)?.target).toBe("Dec 31"); // the later edit still stands
    calls[1].reject(new Error("PATCH 500"));
    await settle();
    expect(projectById(p.id)?.target).toBe("Jul 30");
  });

  it("rolls back a field the project did not have by removing it", async () => {
    const p = addProject({ name: "No status" });
    expect(projectById(p.id)?.status).toBeUndefined();
    const calls = deferredMirror();
    void updateProject(p.id, { status: "closed" });
    expect(projectById(p.id)?.status).toBe("closed");
    calls[0].reject(new Error("PATCH 500"));
    await settle();
    expect(projectById(p.id)).not.toHaveProperty("status");
  });

  it("drops archived records from navProjects while keeping the record", async () => {
    const visible = addProject({ name: "Live Ops" });
    const archived = addProject({ name: "Credential Smoke" });
    __setProjectUpdateMirrorForTests(async (id, patch) => ({
      ...projectById(id)!,
      ...patch,
      archivedAt: "2026-10-09T00:00:00Z",
    }));
    await updateProject(archived.id, { health: "off" });
    await __projectUpdateSettled();

    expect(projectById(archived.id)?.health).toBe("off");
    expect(allProjects().some((p) => p.id === archived.id)).toBe(true);
    expect(navProjects().some((p) => p.id === archived.id)).toBe(false);
    expect(navProjects().some((p) => p.id === visible.id)).toBe(true);
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
