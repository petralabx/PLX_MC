// P0d — actionComplete writes the tier-appropriate evidence bundle onto the task.
// Standard tier needs summary + done checklist + rollback; high/full tier also
// needs a test run (qa) or screenshots (shots). This proves the MCP complete-flow
// can supply that proof, so a high-risk PR (e.g. a migration) is gate-passable.
// All seams are mocked in-memory (same technique as compliance-server.test.ts).
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

vi.mock("@/lib/routing/mutations/actors", () => ({
  requireMcpActor: vi.fn((_identity: unknown, _cap: string) => ({
    actor: { kind: "service", id: "sp_mcp_cursor", status: "active" },
    actorId: "sp_mcp_cursor",
    actorKind: "service",
    auditLabel: "vince@example.com",
  })),
}));

import { actionComplete } from "@/lib/mcp/actions";
import type { McpIdentity } from "@/lib/mcp/auth";

const identity: McpIdentity = {
  operatorEmail: "vince@example.com",
  runtime: "cursor",
  workerId: "test",
  repo: "petralabx/PLX_MC",
  servicePrincipalId: "sp_mcp_cursor",
  actor: { kind: "service", id: "sp_mcp_cursor", status: "active" },
};

beforeEach(() => {
  db.dispatches.clear();
  db.patched.length = 0;
  db.dispatches.set("dsp_test", { taskId: "TASK-900", accountableHuman: "vince" });
});

describe("actionComplete evidence (P0d)", () => {
  it("standard bundle: writes summary + done checklist + rollback, no qa", async () => {
    await actionComplete(identity, {
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
    const res = await actionComplete(identity, {
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
    await actionComplete(identity, {
      checkoutId: "dsp_test",
      summary: "ui change",
      rollback: "revert",
      shots: [{ label: "before", cap: "old" }, { label: "after", cap: "new" }],
    });
    const ev = db.patched.at(-1)?.patch.evidence as { shots?: { label: string }[] };
    expect(ev.shots).toHaveLength(2);
  });
});

describe("mc_complete_task transport contracts", () => {
  it("exposes and forwards the REST completion evidence fields over stdio", () => {
    const source = readFileSync(
      join(process.cwd(), "tools/plx-mc-mcp/index.ts"),
      "utf8"
    );
    const start = source.indexOf('"mc_complete_task"');
    const end = source.indexOf("\nserver.tool(", start + 1);
    const block = source.slice(start, end);

    expect(block).toContain("rollback: z.string().optional()");
    expect(block).toContain("testRun: z");
    expect(block).toContain("shots: z.array");
    expect(block).toContain('mcFetch("/complete", { method: "POST", body })');
  });

  it("exposes and forwards the REST completion evidence fields over HTTP", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/mcp/create-http-server.ts"),
      "utf8"
    );
    const start = source.indexOf('"mc_complete_task"');
    const end = source.indexOf("\n  server.tool(", start + 1);
    const block = source.slice(start, end);

    expect(block).toContain("rollback: z.string().optional()");
    expect(block).toContain("testRun: z");
    expect(block).toContain("shots: z.array");
    expect(block).toContain("actionComplete(identity, body)");
  });
});
