// MCP create-time accountable-owner defaulting: a task created by an agent
// session defaults accountableOwner to the human operator behind the session
// (the Entra/allowlist email on the MCP request), resolved through
// resolveHumanAccountableOwner — same resolution the checkout backfill uses.
// Before this, MCP-created tasks landed ownerless and the EN-003 gate stranded
// them in Planned until a human edited them in the UI.
// Seams are mocked in-memory (same technique as mcp-complete-evidence.test.ts).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@/lib/mc-data";
import type { CreateTaskInput } from "@/lib/sync";

const db = vi.hoisted(() => ({
  created: [] as CreateTaskInput[],
}));

vi.mock("@/lib/compliance/service", () => ({
  complete: vi.fn(),
  checkout: vi.fn(),
}));

vi.mock("@/lib/compliance/repo", () => ({
  getDispatch: vi.fn(async () => null),
  appendEvent: vi.fn(async () => undefined),
}));

vi.mock("@/lib/sync", () => ({
  createTask: vi.fn(async (input: CreateTaskInput) => {
    db.created.push(input);
    return { id: "TASK-901", ...input } as unknown as Task;
  }),
  patchTask: vi.fn(),
  snapshot: vi.fn(),
}));

vi.mock("@/lib/sync/repo", () => ({
  getEntity: vi.fn(async () => null),
}));

vi.mock("@/lib/mcp/sync-meta", () => ({
  syncMetaForTask: vi.fn(async () => ({ status: "queued" })),
}));

vi.mock("@/lib/routing/mutations/actors", () => ({
  requireMcpActor: vi.fn(() => ({
    actor: { kind: "service", id: "sp_mcp_cursor", status: "active" },
    actorId: "sp_mcp_cursor",
    actorKind: "service",
    auditLabel: "vince@petrasoap.com",
  })),
}));

import { actionCreateTask } from "@/lib/mcp/actions";
import type { McpIdentity } from "@/lib/mcp/auth";

function identityFor(operatorEmail: string): McpIdentity {
  return {
    operatorEmail,
    runtime: "cursor",
    workerId: "test",
    repo: "petralabx/PLX_MC",
    servicePrincipalId: "sp_mcp_cursor",
    actor: { kind: "service", id: "sp_mcp_cursor", status: "active" },
  };
}

beforeEach(() => {
  db.created.length = 0;
});

describe("actionCreateTask accountable-owner defaulting", () => {
  it("defaults accountableOwner to the directory human behind the operator email", async () => {
    await actionCreateTask(identityFor("greg.m@petrasoap.com"), {
      title: "agent-created task",
      bucket: "BKT-OPS",
      reporter: "ignored",
    });
    expect(db.created.at(-1)?.accountableOwner).toBe("greg");
    expect(db.created.at(-1)?.reporter).toBe("greg.m@petrasoap.com");
  });

  it("falls back to the default accountable human for service-alias operators", async () => {
    await actionCreateTask(identityFor("cos@petrasoap.com"), {
      title: "swarm-created task",
      bucket: "BKT-OPS",
      reporter: "ignored",
    });
    expect(db.created.at(-1)?.accountableOwner).toBe("vince");
  });

  it("an explicit accountableOwner from the caller wins over the default", async () => {
    await actionCreateTask(identityFor("cos@petrasoap.com"), {
      title: "explicitly owned task",
      bucket: "BKT-OPS",
      reporter: "ignored",
      accountableOwner: "stephen",
    });
    expect(db.created.at(-1)?.accountableOwner).toBe("stephen");
  });
});
