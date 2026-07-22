// EN-003 / WS-1 invariants: the real directory (no fabricated people), the
// human-only assignment policy, and the accountable-owner + completion gates.
// Policy predicates are tested pure; the store tests prove the client spine
// enforces them (server parity lives in tests/mc-patch.test.ts).
import { beforeEach, describe, expect, it } from "vitest";

import { AGENTS, HUMANS, SP_LISTS } from "@/lib/mc-data";
import {
  assignmentViolation,
  hasHumanAccountableOwner,
  isAgentId,
  resolveHumanAccountableOwner,
  stageAdvanceViolation,
} from "@/lib/mc-data/policy";
import type { Task } from "@/lib/mc-data";
import {
  activeNotices,
  addTask,
  directory,
  reassignTask,
  resetStore,
  setAccountableOwner,
  setHumanOnly,
  setTaskStage,
  taskById,
} from "@/lib/mc-data/store";

const FAKES = ["maya", "tariq", "lena", "evan", "noor", "priya", "felix", "dana", "sam", "ines", "omar", "grace", "ruben"];

describe("directory truth (EN-003)", () => {
  beforeEach(() => resetStore());

  it("is exactly the six real people — no fabricated humans remain", () => {
    expect(Object.keys(HUMANS).sort()).toEqual(
      ["greg", "ricardo", "rishi", "ross", "stephen", "vince"].sort()
    );
    for (const fake of FAKES) expect(fake in HUMANS).toBe(false);
  });

  it("every human resolves to a Petra identity", () => {
    for (const person of Object.values(HUMANS)) {
      expect(person.email).toMatch(/@petra(soap|labx)\.com$/);
    }
  });

  it("defines the Accountable Owner person column in the ToDos system-of-record", () => {
    const todos = SP_LISTS.find((list) => list.key === "todos")!;
    const column = todos.columns.find((c) => c.mc === "accountableOwner");
    expect(column).toBeDefined();
    expect(column!.type).toBe("Person");
    expect(column!.name).toBe("Accountable Owner");
  });
});

describe("directory() ordering (role → online → name, no hardcoded ids)", () => {
  beforeEach(() => resetStore());

  it("ranks the Owner first, then orders the rest by name", () => {
    const ids = directory().map((p) => p.id);
    expect(ids[0]).toBe("vince"); // Owner role ranks first
    expect(new Set(ids)).toEqual(new Set(["greg", "rishi", "ricardo", "stephen", "ross", "vince"]));
    // No agents leak into the human directory.
    for (const id of ids) expect(id in AGENTS).toBe(false);
    // The non-Owner tail is alphabetical by display name.
    const tail = directory()
      .filter((p) => p.role !== "Owner")
      .map((p) => p.name);
    expect(tail).toEqual([...tail].sort((a, b) => a.localeCompare(b)));
  });
});

describe("policy predicates", () => {
  const taskish = (over: Partial<Task>): Task => ({
    id: "TASK-X",
    title: "t",
    bucket: "BKT-WMS",
    stage: "planned",
    priority: "medium",
    assignee: null,
    coassignees: [],
    reporter: "vince",
    accountableOwner: null,
    reqs: [],
    repos: [],
    estimate: "M",
    labels: [],
    prs: [],
    due: "—",
    sync: { state: "pending", ts: "—", sp: "—" },
    subtasks: [],
    activity: [],
    ...over,
  });

  it("isAgentId only matches the agent roster", () => {
    expect(isAgentId("vibes")).toBe(true);
    expect(isAgentId("greg")).toBe(false);
    expect(isAgentId(null)).toBe(false);
  });

  it("hasHumanAccountableOwner is true only for a non-agent id", () => {
    expect(hasHumanAccountableOwner(taskish({ accountableOwner: "greg" }))).toBe(true);
    expect(hasHumanAccountableOwner(taskish({ accountableOwner: "vibes" }))).toBe(false);
    expect(hasHumanAccountableOwner(taskish({ accountableOwner: null }))).toBe(false);
  });

  it("assignmentViolation blocks an agent only when the task is human-only", () => {
    expect(assignmentViolation(taskish({ humanOnly: true }), "vibes")).toMatch(/human-only/);
    expect(assignmentViolation(taskish({ humanOnly: true }), "greg")).toBeNull();
    expect(assignmentViolation(taskish({}), "vibes")).toBeNull();
  });

  it("stageAdvanceViolation enforces the accountable-owner gate past planned", () => {
    const noOwner = taskish({ accountableOwner: null });
    expect(stageAdvanceViolation(noOwner, "planned")).toBeNull(); // up to planned is fine
    expect(stageAdvanceViolation(noOwner, "qa")).toMatch(/accountable owner/);
    expect(stageAdvanceViolation(taskish({ accountableOwner: "greg" }), "qa")).toBeNull();
  });

  it("resolveHumanAccountableOwner maps session emails and ids to directory humans", () => {
    expect(resolveHumanAccountableOwner("vince@petrasoap.com")).toBe("vince");
    expect(resolveHumanAccountableOwner("GREG.M@petrasoap.com")).toBe("greg"); // case-insensitive
    expect(resolveHumanAccountableOwner("greg")).toBe("greg"); // already a directory id
    // Service aliases and unknowns fall back to the default accountable human —
    // never a null owner (the gate would strand the task) and never an agent.
    expect(resolveHumanAccountableOwner("cos@petrasoap.com")).toBe("vince");
    expect(resolveHumanAccountableOwner("unknown@example.com")).toBe("vince");
    expect(isAgentId(resolveHumanAccountableOwner("cos@petrasoap.com"))).toBe(false);
  });

  it("stageAdvanceViolation enforces the completion gate on done stages", () => {
    const incomplete = taskish({
      accountableOwner: "greg",
      evidence: { summary: "x", items: [{ key: "a", label: "a", done: false }] },
    });
    expect(stageAdvanceViolation(incomplete, "verified")).toMatch(/evidence/);
    const complete = taskish({
      accountableOwner: "greg",
      evidence: { summary: "x", items: [{ key: "a", label: "a", done: true }] },
    });
    expect(stageAdvanceViolation(complete, "verified")).toBeNull();
    // No evidence bundle at all → the completion gate does not apply.
    expect(stageAdvanceViolation(taskish({ accountableOwner: "greg" }), "verified")).toBeNull();
  });
});

describe("store enforcement — human-only policy", () => {
  beforeEach(() => resetStore());

  it("rejects an agent executor on a human-only task and surfaces a notice", () => {
    setHumanOnly("TASK-221", true);
    reassignTask("TASK-221", "vibes");
    expect(taskById("TASK-221")?.assignee).toBeNull();
    expect(activeNotices().some((n) => /human-only/.test(n.body))).toBe(true);
  });

  it("allows a human executor on a human-only task", () => {
    setHumanOnly("TASK-221", true);
    reassignTask("TASK-221", "greg");
    expect(taskById("TASK-221")?.assignee).toBe("greg");
  });

  it("turning on human-only clears an existing agent executor", () => {
    reassignTask("TASK-221", "vibes"); // agents allowed while not human-only
    expect(taskById("TASK-221")?.assignee).toBe("vibes");
    setHumanOnly("TASK-221", true);
    expect(taskById("TASK-221")?.humanOnly).toBe(true);
    expect(taskById("TASK-221")?.assignee).toBeNull();
  });
});

describe("store enforcement — accountable-owner gate", () => {
  beforeEach(() => resetStore());

  it("blocks advancing a task with no accountable owner past planned", () => {
    const t = addTask({ title: "orphan", bucket: "BKT-WMS" }); // accountableOwner defaults null
    expect(t.accountableOwner).toBeNull();
    setTaskStage(t.id, "qa");
    expect(taskById(t.id)?.stage).toBe("backlog"); // unchanged
    expect(activeNotices().some((n) => /accountable owner/.test(n.body))).toBe(true);
  });

  it("permits the advance once a human accountable owner is set", () => {
    const t = addTask({ title: "owned", bucket: "BKT-WMS" });
    setAccountableOwner(t.id, "greg");
    setTaskStage(t.id, "qa");
    expect(taskById(t.id)?.accountableOwner).toBe("greg");
    expect(taskById(t.id)?.stage).toBe("qa");
  });

  it("rejects an agent as the accountable owner", () => {
    setAccountableOwner("TASK-221", "vibes");
    expect(taskById("TASK-221")?.accountableOwner).toBe("vince"); // seed value, unchanged
    expect(activeNotices().some((n) => /always human/.test(n.body))).toBe(true);
  });

  it("blocks a done-stage move while evidence is incomplete (completion gate)", () => {
    // TASK-227 seeds in QA with a 0/4 evidence bundle and a human owner.
    setTaskStage("TASK-227", "verified");
    expect(taskById("TASK-227")?.stage).toBe("qa"); // unchanged
    expect(activeNotices().some((n) => /evidence/.test(n.body))).toBe(true);
  });
});
