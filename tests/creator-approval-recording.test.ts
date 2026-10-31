// recordingCreatorRefusal (TASK-4293): a creator-gate refusal reaches the
// caller only once its creator_approval.blocked event is written, so a route
// never answers 409 while the write is still out. Any other error passes
// through and records nothing.
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ release: null as null | (() => void), written: [] as unknown[] }));

vi.mock("@/lib/compliance/repo", () => ({
  appendEvent: vi.fn(
    (event: unknown) =>
      new Promise<string>((resolve) => {
        h.release = () => {
          h.written.push(event);
          resolve(String(h.written.length));
        };
      })
  ),
}));

import { CreatorApprovalRefusal, recordingCreatorRefusal } from "@/lib/compliance/creator-approval";
import { appendEvent } from "@/lib/compliance/repo";

const refusal = () =>
  new CreatorApprovalRefusal(
    { id: "TASK-1", creatorApproval: { principal: "sp_mcp_workbench_intake", status: "pending", requestedAt: "2026-10-31T00:00:00.000Z" } },
    "progress",
    { actor: "someone@petrasoap.com", actorId: "sp_mcp_codex" },
    "TASK-1 waits for creator approval."
  );

describe("recordingCreatorRefusal", () => {
  it("rethrows a refusal only after its event is written, with the caller's context", async () => {
    const err = refusal();
    let settled = false;
    const outcome = recordingCreatorRefusal(async () => {
      throw err;
    }, { actor: "codex:cos@petrasoap.com", repo: "petralabx/PLX_MC", door: "mcp" }).catch((thrown: unknown) => {
      settled = true;
      return thrown;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    h.release!();
    expect(await outcome).toBe(err);
    expect(h.written).toEqual([
      expect.objectContaining({
        kind: "creator_approval.blocked",
        actor: "codex:cos@petrasoap.com",
        repo: "petralabx/PLX_MC",
        taskId: "TASK-1",
        payload: expect.objectContaining({ action: "stage", requestedStage: "progress", actorId: "sp_mcp_codex", door: "mcp" }),
      }),
    ]);
  });

  it("passes any other error through and records nothing", async () => {
    const other = new Error("database went away");
    vi.mocked(appendEvent).mockClear();
    await expect(recordingCreatorRefusal(async () => {
      throw other;
    })).rejects.toBe(other);
    expect(appendEvent).not.toHaveBeenCalled();
  });

  it("returns what the transaction returns", async () => {
    await expect(recordingCreatorRefusal(async () => 42)).resolves.toBe(42);
  });
});
