// mc_link_merged_pr (TASK-2559): steward-only link of a merged PR to a task.
// Real action, authorize(), projection and patchTask; only the sync repo, the
// event log and the GitHub reader are faked. No network, no database.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@/lib/mc-data";
import type { McpIdentity } from "@/lib/mcp/auth";
import type { MergedPrFacts } from "@/lib/compliance/github-pr";

const store = vi.hoisted(() => ({
  rows: new Map<string, { entity_type: string; id: string; data: Record<string, unknown>; sync_state: string; sp_item_id: string | null; dirty_fields: string[] }>(),
  events: [] as { kind: string; actor: string; taskId?: string | null; dedupKey?: string | null; payload?: Record<string, unknown> }[],
}));

vi.mock("@/lib/permissions/enforcement", async () => {
  const { authorize } = await import("@/lib/permissions");
  return {
    resolveStagedServicePrincipal: async (id: string) => ({
      actor: { kind: "service", id, status: "active" },
      missing: false,
      shadowActor: null,
      shadowMissing: false,
      mode: "off",
    }),
    authorizeStaged: (input: { capability: never; resource?: never; appliedActor: never }) => {
      const d = authorize({ actor: input.appliedActor, capability: input.capability, resource: input.resource });
      return { allowed: d.allowed, reasonCode: d.reasonCode, policyVersion: "permissions.v2" };
    },
    recordUnresolvedActorDenial: () => {},
  };
});
vi.mock("@/lib/permissions/decision-log", () => ({ recordPermissionDecision: vi.fn(async () => true) }));
vi.mock("@/lib/permissions/project-acl-guard", () => ({ assertTaskProjectAccess: vi.fn(async () => undefined) }));
vi.mock("@/lib/sync/engine", () => ({
  ensureSeeded: vi.fn(async () => true),
  ensureReposSeeded: vi.fn(async () => true),
}));
vi.mock("@/lib/sync/repo", () => ({
  stamp: () => "2026.10.09 · 00:00",
  async getRepos() {
    return [{ id: "plx-mc", name: "PLX_MC", lang: "TypeScript", def: "main", owner: "petralabx", visibility: "private", scope: "" }];
  },
  async getEntity(type: string, id: string) {
    return store.rows.get(`${type}:${id}`) ?? null;
  },
  async getEntities(type: string) {
    return [...store.rows.entries()].filter(([k]) => k.startsWith(`${type}:`)).map(([, row]) => row);
  },
  async updateEntity(type: string, id: string, opts: { patch?: Record<string, unknown> }) {
    const row = store.rows.get(`${type}:${id}`);
    if (row) row.data = { ...row.data, ...(opts.patch ?? {}) };
  },
  async appendAudit() {},
}));
vi.mock("@/lib/compliance/repo", () => ({
  async appendEvent(e: { kind: string; actor: string; dedupKey?: string | null }) {
    if (e.dedupKey && store.events.some((x) => x.dedupKey === e.dedupKey)) return undefined;
    store.events.push(e);
    return String(store.events.length);
  },
}));

import { actionLinkMergedPr } from "@/lib/mcp/link-merged-pr-actions";

const identity = (id: string, operatorEmail = "cos@petrasoap.com"): McpIdentity => ({
  operatorEmail,
  runtime: "claude",
  workerId: "w1",
  repo: "petralabx/PLX_MC",
  servicePrincipalId: id as McpIdentity["servicePrincipalId"],
  actor: { kind: "service", id, status: "active" },
});
const ledger = identity("sp_mcp_ledger");

function seedTask(id: string, over: Partial<Task> = {}): void {
  const base = {
    id, title: id, description: "", bucket: "BKT-INFRA", stage: "planned", priority: "medium",
    assignee: null, coassignees: [], reporter: "vince", accountableOwner: "vince", reqs: [],
    repos: ["plx-mc"], estimate: "M", labels: [], prs: [], due: "Oct 9",
    sync: { state: "synced", ts: "—", sp: "ToDos · item 1" }, subtasks: [], activity: [], ...over,
  } as unknown as Task;
  store.rows.set(`task:${id}`, { entity_type: "task", id, data: base as unknown as Record<string, unknown>, sync_state: "synced", sp_item_id: "1", dirty_fields: [] });
}
const taskOf = (id: string) => store.rows.get(`task:${id}`)!.data as unknown as Task;
const merged: MergedPrFacts = { merged: true, state: "closed", headSha: "h".repeat(40), mergeSha: "m".repeat(40), title: "Old work", repoFullName: "petralabx/PLX_MC" };
const facts = (over: Partial<MergedPrFacts> = {}) => ({ loadFacts: vi.fn(async () => ({ ...merged, ...over })) });
const input = (over: Record<string, unknown> = {}) => ({ taskId: "TASK-100", repo: "petralabx/PLX_MC", prNumber: 42, reason: "delivered months ago", ...over });

beforeEach(() => {
  store.rows.clear();
  store.events.length = 0;
  seedTask("TASK-100");
});

describe("mc_link_merged_pr authorization (acceptance 1)", () => {
  it.each(["sp_mcp_claude_code", "sp_mcp_cursor", "sp_mcp_codex", "sp_mcp_portal"])(
    "refuses %s with 403 and writes nothing, even with a steward operator email",
    async (principal) => {
      const deps = facts();
      await expect(actionLinkMergedPr(identity(principal), input(), deps)).rejects.toMatchObject({ status: 403 });
      expect(deps.loadFacts).not.toHaveBeenCalled();
      expect(taskOf("TASK-100").prs).toEqual([]);
      expect(taskOf("TASK-100").stage).toBe("planned");
      expect(store.events).toEqual([]);
    }
  );

  it("admits the steward principal regardless of operator email", async () => {
    const result = await actionLinkMergedPr(identity("sp_mcp_ledger", "someone@petrasoap.com"), input(), facts());
    expect(result).toMatchObject({ linked: true });
  });

  it("rejects caller-supplied SHAs (they are read from GitHub only)", async () => {
    await expect(actionLinkMergedPr(ledger, input({ headSha: "x" }), facts())).rejects.toMatchObject({ status: 400 });
  });
});

describe("unmerged PRs (acceptance 2)", () => {
  it.each([
    ["open", { merged: false, state: "open" as const }],
    ["closed unmerged", { merged: false, state: "closed" as const }],
  ])("refuses a %s PR and writes nothing", async (_label, over) => {
    await expect(actionLinkMergedPr(ledger, input(), facts(over))).rejects.toMatchObject({ code: "pr_not_merged", status: 409 });
    expect(taskOf("TASK-100").prs).toEqual([]);
    expect(taskOf("TASK-100").stage).toBe("planned");
    expect(store.events).toEqual([]);
  });

  it("refuses a PR GitHub places in a different repo", async () => {
    await expect(actionLinkMergedPr(ledger, input(), facts({ repoFullName: "petralabx/other" }))).rejects.toMatchObject({ code: "repo_mismatch" });
    expect(store.events).toEqual([]);
  });
});

describe("idempotency (acceptance 3)", () => {
  it("repeating the same link is a no-op: one prs entry, one link audit, one promotion", async () => {
    await actionLinkMergedPr(ledger, input(), facts());
    const deps = facts();
    const again = await actionLinkMergedPr(ledger, input(), deps);
    expect(again).toMatchObject({ linked: false, unchanged: true });
    expect(deps.loadFacts).not.toHaveBeenCalled();
    expect(taskOf("TASK-100").prs).toHaveLength(1);
    expect(store.events.filter((e) => e.kind === "task.pr.linked")).toHaveLength(1);
    expect(store.events.filter((e) => e.kind === "task.promoted")).toHaveLength(1);
  });
});

describe("audit entry (acceptance 4)", () => {
  it("records actor, reason, repo, PR, head and merge SHA read from GitHub", async () => {
    const result = await actionLinkMergedPr(ledger, input(), facts());
    const evt = store.events.find((e) => e.kind === "task.pr.linked")!;
    expect(evt.actor).toBe("claude:cos@petrasoap.com");
    expect(evt.payload).toMatchObject({
      servicePrincipalId: "sp_mcp_ledger",
      reason: "delivered months ago",
      repo: "petralabx/PLX_MC",
      prNumber: 42,
      headSha: merged.headSha,
      mergeSha: merged.mergeSha,
      override: false,
      overrideReason: null,
    });
    expect(result).toMatchObject({ headSha: merged.headSha, mergeSha: merged.mergeSha, eventSeq: expect.any(String) });
    expect(taskOf("TASK-100").prs).toEqual([{ repo: "PLX_MC", num: 42, status: "merged", title: "Old work" }]);
  });
});

describe("stage effects (acceptance 5 and 6)", () => {
  it.each(["backlog", "planned", "progress", "review"])("promotes a %s task to merged, never verified", async (stage) => {
    seedTask("TASK-100", { stage } as Partial<Task>);
    const result = await actionLinkMergedPr(ledger, input(), facts());
    expect(taskOf("TASK-100").stage).toBe("merged");
    expect(taskOf("TASK-100").merge?.sha).toBe(merged.mergeSha);
    expect(result).toMatchObject({ promoted: true, stage: "merged" });
  });

  it.each(["merged", "verified"])("keeps a %s task's stage and promotes nothing", async (stage) => {
    seedTask("TASK-100", { stage } as Partial<Task>);
    await actionLinkMergedPr(ledger, input(), facts());
    expect(taskOf("TASK-100").stage).toBe(stage);
    expect(taskOf("TASK-100").prs).toHaveLength(1);
    expect(store.events.filter((e) => e.kind === "task.promoted")).toHaveLength(0);
  });
});

describe("PR already linked to another task (acceptance 7)", () => {
  beforeEach(() => {
    seedTask("TASK-200", { prs: [{ repo: "PLX_MC", num: 42, status: "merged", title: "Old work" }], stage: "merged" } as Partial<Task>);
  });

  it("refuses without override", async () => {
    await expect(actionLinkMergedPr(ledger, input(), facts())).rejects.toMatchObject({ code: "pr_linked_elsewhere", status: 409 });
    expect(taskOf("TASK-100").prs).toEqual([]);
    expect(store.events).toEqual([]);
  });

  it("rejects override without overrideReason", async () => {
    await expect(actionLinkMergedPr(ledger, input({ override: true }), facts())).rejects.toMatchObject({ status: 400 });
    expect(store.events).toEqual([]);
  });

  it("accepts override with a reason and audits it", async () => {
    await actionLinkMergedPr(ledger, input({ override: true, overrideReason: "PR delivered both tasks" }), facts());
    expect(taskOf("TASK-100").prs).toHaveLength(1);
    const evt = store.events.find((e) => e.kind === "task.pr.linked")!;
    expect(evt.payload).toMatchObject({ override: true, overrideReason: "PR delivered both tasks", otherTaskIds: ["TASK-200"] });
  });
});

describe("grant", () => {
  it("only sp_mcp_ledger holds task.link_merged_pr", async () => {
    const { MCP_AGENT_SERVICE_PRINCIPAL_IDS, capabilitiesForServicePrincipal } = await import("@/lib/permissions");
    const holders = MCP_AGENT_SERVICE_PRINCIPAL_IDS.filter((id) => capabilitiesForServicePrincipal(id).includes("task.link_merged_pr"));
    expect(holders).toEqual(["sp_mcp_ledger"]);
  });
});
