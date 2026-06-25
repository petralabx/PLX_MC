// P0d — actionComplete writes the tier-appropriate evidence bundle onto the task.
// Standard tier needs summary + done checklist + rollback; high/full tier also
// needs a test run (qa) or screenshots (shots). This proves the MCP complete-flow
// can supply that proof, so a high-risk PR (e.g. a migration) is gate-passable.
// All seams are mocked in-memory (same technique as compliance-server.test.ts).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@/lib/mc-data";

const db = vi.hoisted(() => ({
  dispatches: new Map<string, { taskId: string; accountableHuman: string }>(),
  patched: [] as { taskId: string; patch: Record<string, unknown> }[],
}));

vi.mock("@/lib/compliance/service", () => ({
  complete: vi.fn(async () => ({ ok: true })),
  checkout: vi.fn(async () => ({ checkoutId: "dsp_test" })),
}));

vi.mock("@/lib/compliance/repo", () => ({
  getDispatch: vi.fn(async (id: string) => db.dispatches.get(id) ?? null),
}));

vi.mock("@/lib/sync", () => ({
  patchTask: vi.fn(async (taskId: string, patch: Record<string, unknown>) => {
    db.patched.push({ taskId, patch });
    return { id: taskId } as Task;
  }),
  createTask: vi.fn(),
  snapshot: vi.fn(),
}));

vi.mock("@/lib/sync/repo", () => ({
  getEntity: vi.fn(async () => null),
}));

vi.mock("@/lib/mcp/sync-meta", () => ({
  syncMetaForTask: vi.fn(async () => ({ status: "queued" })),
}));

import { actionComplete } from "@/lib/mcp/actions";

beforeEach(() => {
  db.dispatches.clear();
  db.patched.length = 0;
  db.dispatches.set("dsp_test", { taskId: "TASK-900", accountableHuman: "vince" });
});

describe("actionComplete evidence (P0d)", () => {
  it("standard bundle: writes summary + done checklist + rollback, no qa", async () => {
    await actionComplete({
      checkoutId: "dsp_test",
      summary: "did the thing",
      verificationCommands: ["npm test"],
      rollback: "revert the PR",
    });
    const ev = db.patched.at(-1)?.patch.evidence as Record<string, unknown>;
    expect(ev.summary).toBe("did the thing");
    expect(ev.rollback).toBe("revert the PR");
    expect(ev.qa).toBeUndefined();
    expect(ev.shots).toBeUndefined();
  });

  it("high/full bundle: a testRun lands as evidence.qa so a high-risk PR is gate-passable", async () => {
    const res = await actionComplete({
      checkoutId: "dsp_test",
      summary: "migration applied",
      verificationCommands: ["npx vitest run"],
      rollback: "db/rollback/011_projects_rollback.sql",
      testRun: { suite: "vitest", passed: 637, failed: 0 },
    });
    const ev = db.patched.at(-1)?.patch.evidence as { qa?: { pass: number; fail: number; total: number; suite: string } };
    expect(ev.qa).toBeDefined();
    expect(ev.qa?.pass).toBe(637);
    expect(ev.qa?.fail).toBe(0);
    expect(ev.qa?.total).toBe(637);
    expect(ev.qa?.suite).toBe("vitest");
    // The returned envelope echoes the qa proof too.
    expect(res.evidence.qa).not.toBeNull();
  });

  it("screenshots are accepted as the alternative full-tier proof", async () => {
    await actionComplete({
      checkoutId: "dsp_test",
      summary: "ui change",
      rollback: "revert",
      shots: [{ label: "before", cap: "old" }, { label: "after", cap: "new" }],
    });
    const ev = db.patched.at(-1)?.patch.evidence as { shots?: { label: string }[] };
    expect(ev.shots).toHaveLength(2);
  });
});
