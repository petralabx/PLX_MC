// TASK-4150: the merge note is written once, evidence first, inside one transaction.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  calls: [] as string[],
  recorded: new Set<string>(),
  task: { id: "TASK-900", comments: [{ id: "c1", body: "earlier" }] } as Record<string, unknown> | null,
  patches: [] as Record<string, unknown>[],
  events: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/db", () => ({ withTransaction: async (fn: (q: unknown) => unknown) => fn(() => []) }));
vi.mock("@/lib/sync/repo", () => ({
  getEntity: async () => (h.task ? { data: h.task } : null),
}));
vi.mock("@/lib/sync", () => ({
  patchTask: async (_id: string, patch: Record<string, unknown>) => {
    h.calls.push("note");
    h.patches.push(patch);
    return h.task;
  },
}));
vi.mock("@/lib/compliance/repo", () => ({
  lockDedupKeyTx: async () => { h.calls.push("lock"); },
  eventAgeByDedupKeyTx: async (_q: unknown, key: string) => (h.recorded.has(key) ? { taskId: "TASK-900", ageSeconds: 1 } : null),
  appendEventTx: async (_q: unknown, e: Record<string, unknown>) => {
    h.calls.push("evidence");
    h.events.push(e);
    h.recorded.add(e.dedupKey as string);
    return "1";
  },
}));

import { mergeNoteBody, recordMergeOnTask } from "@/lib/compliance/merge-note";

const rec = {
  taskId: "TASK-900", repo: "petralabx/PLX_MC", prNumber: 512,
  mergeSha: "0123456789abcdef0123456789abcdef01234567", checkoutIds: ["dsp_mvtqqxjvg3rb4g"], actor: "cursor-cloud",
};

beforeEach(() => {
  h.calls.length = 0; h.recorded.clear(); h.patches.length = 0; h.events.length = 0;
  h.task = { id: "TASK-900", comments: [{ id: "c1", body: "earlier" }] };
});

describe("recordMergeOnTask", () => {
  it("writes the evidence event, then appends the note after existing comments", async () => {
    expect(await recordMergeOnTask(rec)).toBe(true);
    expect(h.calls).toEqual(["lock", "evidence", "note"]);
    expect(h.events[0]).toMatchObject({
      kind: "task.merge_recorded", taskId: "TASK-900", pr: "512",
      payload: {
        mergeSha: rec.mergeSha,
        prUrl: "https://github.com/petralabx/PLX_MC/pull/512",
        rollback: `git revert -m 1 ${rec.mergeSha}`,
        releaseReason: "merged",
      },
    });
    const comments = h.patches[0].comments as { id: string; body: string }[];
    expect(comments.map((c) => c.id)).toEqual(["c1", `merge-512-${rec.mergeSha.slice(0, 12)}`]);
    expect(comments[1].body).toContain("https://github.com/petralabx/PLX_MC/pull/512");
    expect(comments[1].body).toContain(`git revert -m 1 ${rec.mergeSha}`);
  });

  it("is a no-op on webhook replay", async () => {
    await recordMergeOnTask(rec);
    h.calls.length = 0;
    expect(await recordMergeOnTask(rec)).toBe(false);
    expect(h.calls).toEqual(["lock"]);
    expect(h.patches).toHaveLength(1);
  });

  it("writes nothing for a task that no longer exists", async () => {
    h.task = null;
    expect(await recordMergeOnTask(rec)).toBe(false);
    expect(h.events).toHaveLength(0);
  });

  it("never puts the usable checkout id in the note", () => {
    const body = mergeNoteBody(rec);
    expect(body).not.toContain("dsp_mvtqqxjvg3rb4g");
    expect(body).toContain("dsp_…rb4g");
  });
});
