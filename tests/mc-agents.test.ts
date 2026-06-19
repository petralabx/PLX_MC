// EN-005 / WS-5 — agent operational-model invariants: the roster carries a real
// model (capabilities / advisory default-repos / enforced mode), `mode: approve`
// is no longer a dead label (it gates advance into the doing band), presence is
// DERIVED from in-flight assignment (no fabricated heartbeat), and the activity
// feed is derived from real agent-authored task events. Policy predicates are
// tested pure; the store tests prove the client spine enforces the mode gate.
import { beforeEach, describe, expect, it } from "vitest";

import { AGENTS, REPOS, TASKS, agentIsActive, liveAgentCount } from "@/lib/mc-data";
import { stageAdvanceViolation } from "@/lib/mc-data/policy";
import type { Task } from "@/lib/mc-data";
import {
  activeNotices,
  reassignTask,
  resetStore,
  setAgentRunApproved,
  setTaskStage,
  taskById,
} from "@/lib/mc-data/store";
import { deriveAgentFeed } from "@/components/mc/record-logic";

const baseTask = (over: Partial<Task>): Task => ({
  id: "TASK-T",
  title: "t",
  bucket: "BKT-WMS",
  stage: "planned",
  priority: "medium",
  assignee: null,
  coassignees: [],
  reporter: "vince",
  accountableOwner: "vince",
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

describe("agent operational model (EN-005)", () => {
  it("every agent carries a real model — capabilities, registry default-repos, valid mode, honest presence", () => {
    for (const agent of Object.values(AGENTS)) {
      expect(agent.capabilities.length).toBeGreaterThan(0);
      expect(agent.defaultRepos.length).toBeGreaterThan(0);
      // default repos are advisory but must be REAL registry ids (no fabrication).
      for (const repoId of agent.defaultRepos) expect(repoId in REPOS).toBe(true);
      expect(["auto", "approve"]).toContain(agent.mode);
      // Honest presence — no hardcoded online:true (EN-005 obs. #1/#4).
      expect(agent.online).toBe(false);
    }
  });
});

describe("mode enforcement — stageAdvanceViolation (EN-005)", () => {
  type AdvanceArg = Parameters<typeof stageAdvanceViolation>[0];
  const advanceArg = (over: Partial<AdvanceArg>): AdvanceArg => ({
    id: "T",
    accountableOwner: "vince",
    evidence: undefined,
    assignee: null,
    agentRunApproved: undefined,
    ...over,
  });

  it("gates an approve-mode agent run into the doing band until approved", () => {
    const run = advanceArg({ assignee: "atlas" }); // atlas = approve mode
    expect(stageAdvanceViolation(run, "planned")).toBeNull(); // todo band is fine
    expect(stageAdvanceViolation(run, "progress")).toMatch(/needs-approval/);
    expect(stageAdvanceViolation({ ...run, agentRunApproved: true }, "progress")).toBeNull();
  });

  it("does not gate an auto-mode agent", () => {
    expect(stageAdvanceViolation(advanceArg({ assignee: "vibes" }), "progress")).toBeNull();
  });

  it("does not gate a human executor", () => {
    expect(stageAdvanceViolation(advanceArg({ assignee: "greg" }), "progress")).toBeNull();
  });
});

describe("derived presence (EN-005 — no fabricated heartbeat)", () => {
  it("an agent executing an in-flight task is active; idle otherwise", () => {
    const tasks = [baseTask({ id: "TASK-1", assignee: "vibes", stage: "progress" })];
    expect(agentIsActive("vibes", tasks)).toBe(true);
    expect(agentIsActive("atlas", tasks)).toBe(false);
    expect(liveAgentCount(tasks)).toBe(1);
  });

  it("is honestly zero for the seeded fixture (no agent has live work yet)", () => {
    expect(liveAgentCount()).toBe(0);
  });
});

describe("agent feed derivation (EN-005)", () => {
  it("includes agent-authored activity and excludes human-authored", () => {
    const tasks = [
      baseTask({
        id: "TASK-1",
        activity: [
          { age: "now", who: "vibes", what: "ran the QA suite", kind: "move" },
          { age: "now", who: "vince", what: "created the task", kind: "move" },
        ],
      }),
    ];
    const feed = deriveAgentFeed(tasks);
    expect(feed).toHaveLength(1);
    expect(feed[0].actor).toBe("vibes");
    expect(feed[0].task).toBe("TASK-1");
    expect(feed[0].text).toBe("ran the QA suite");
  });

  it("is empty for the seeded fixture (no agent activity yet — honest)", () => {
    expect(deriveAgentFeed(TASKS)).toEqual([]);
  });
});

describe("store — approve-mode agent run gate (EN-005)", () => {
  beforeEach(() => resetStore());

  it("blocks advancing an approve-mode agent's task until the operator approves the run", () => {
    reassignTask("TASK-221", "atlas"); // approve-mode agent; TASK-221 owner = vince
    setTaskStage("TASK-221", "progress");
    expect(taskById("TASK-221")?.stage).toBe("planned"); // held
    expect(activeNotices().some((n) => /needs-approval/.test(n.body))).toBe(true);

    setAgentRunApproved("TASK-221", true);
    setTaskStage("TASK-221", "progress");
    expect(taskById("TASK-221")?.stage).toBe("progress"); // now advances
  });

  it("does not gate an auto-mode agent's task", () => {
    reassignTask("TASK-221", "vibes"); // auto-mode agent
    setTaskStage("TASK-221", "progress");
    expect(taskById("TASK-221")?.stage).toBe("progress");
  });
});
