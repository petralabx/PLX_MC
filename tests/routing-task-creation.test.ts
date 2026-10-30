// P8 — confirmed Task creation + creation-intent idempotency.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PermissionActor } from "@/lib/permissions";
import type { AuthorizedActor } from "@/lib/routing/mutations/actors";
import { creationIntentHash } from "@/lib/routing/mutations/preconditions";

const txState = vi.hoisted(() => ({
  proposals: new Map<string, Record<string, unknown>>(),
  intents: [] as { proposal_id: string; creation_intent_hash: string; task_id: string; id: string }[],
  entities: new Set<string>(),
  entityData: new Map<string, { labels: string[] }>(),
  seq: 100,
  decisions: 0,
  links: 0,
}));

// TASK-3631: the gated creator list is reviewed code; a test marks a principal gated here.
const gated = vi.hoisted(() => ({ ids: new Set<string>() }));
vi.mock("@/lib/permissions", async (orig) => {
  const actual = await orig<typeof import("@/lib/permissions")>();
  return {
    ...actual,
    isCreatorApprovalGated: (id: string | null | undefined) => (!!id && gated.ids.has(id)) || actual.isCreatorApprovalGated(id),
  };
});

vi.mock("@/lib/db", () => ({
  withTransaction: async <T>(fn: (q: unknown) => Promise<T>) => {
    const q = async (text: string, params: unknown[] = []) => {
      if (text.includes("FOR UPDATE")) {
        const row = txState.proposals.get(String(params[0]));
        return row ? [row] : [];
      }
      if (text.includes("FROM routing_creation_intents")) {
        const hit = txState.intents.find(
          (i) => i.proposal_id === params[0] && i.creation_intent_hash === params[1]
        );
        return hit ? [{ id: hit.id, task_id: hit.task_id }] : [];
      }
      if (text.includes("nextval('mc_task_id_seq')")) {
        txState.seq += 1;
        return [{ next_id: txState.seq }];
      }
      if (text.includes("INSERT INTO routing_creation_intents")) {
        const row = {
          id: String(params[0]),
          proposal_id: String(params[1]),
          creation_intent_hash: String(params[2]),
          task_id: String(params[3]),
        };
        const existing = txState.intents.find(
          (i) =>
            i.proposal_id === row.proposal_id &&
            i.creation_intent_hash === row.creation_intent_hash
        );
        if (existing) {
          return [
            {
              id: existing.id,
              proposal_id: existing.proposal_id,
              creation_intent_hash: existing.creation_intent_hash,
              task_id: existing.task_id,
            },
          ];
        }
        txState.intents.push(row);
        return [
          {
            id: row.id,
            proposal_id: row.proposal_id,
            creation_intent_hash: row.creation_intent_hash,
            task_id: row.task_id,
          },
        ];
      }
      if (text.includes("SELECT id FROM entities")) {
        return txState.entities.has(String(params[0])) ? [{ id: params[0] }] : [];
      }
      if (text.includes("INSERT INTO entities")) {
        txState.entities.add(String(params[0]));
        txState.entityData.set(String(params[0]), JSON.parse(String(params[1])));
        return [{ id: params[0] }];
      }
      if (text.includes("INSERT INTO routing_decisions")) {
        txState.decisions += 1;
        return [];
      }
      if (text.includes("INSERT INTO routing_work_links")) {
        txState.links += 1;
        return [];
      }
      if (text.includes("INSERT INTO mc_events")) return [];
      if (text.includes("UPDATE routing_proposals")) {
        const row = txState.proposals.get(String(params[0]));
        if (!row) return [];
        Object.assign(row, {
          state: params[1],
          selected_task_id: params[2],
          selected_bucket_id: params[3],
          derived_project_id: params[4],
        });
        return [row];
      }
      if (text.includes("UPDATE routing_sessions")) return [];
      return [];
    };
    return fn(q);
  },
}));

vi.mock("@/lib/sync/engine", () => ({
  ensureSeeded: vi.fn(async () => true),
  ensureReposSeeded: vi.fn(async () => true),
  ensureBucketsSeeded: vi.fn(async () => true),
  checkRoutingFreshness: vi.fn(async () => ({
    ok: true,
    code: "ok",
    maxAgeMs: 360_000,
    checkedAt: new Date().toISOString(),
    registers: [],
    reasons: [],
  })),
}));

vi.mock("@/lib/sync/repo", () => ({
  stamp: () => "2026.07.14 · 00:00",
  openConflicts: vi.fn(async () => []),
  openErrors: vi.fn(async () => []),
  getBuckets: vi.fn(async () => [{ id: "BKT-OPS", project: "PRJ-1", name: "Ops" }]),
  getRepos: vi.fn(async () => [
    { id: "petralabx/PLX_MC", name: "PLX_MC", lang: "TS", def: "main", owner: "v", visibility: "private", scope: "" },
  ]),
  getEntity: vi.fn(async () => null),
}));

vi.mock("@/lib/sync", async () => {
  const engine = await import("@/lib/sync/engine");
  return { checkRoutingFreshness: engine.checkRoutingFreshness };
});

import { createConfirmedTask } from "@/lib/routing/service";

const human: AuthorizedActor = {
  actor: { kind: "human", id: "oid-1", role: "member", status: "active" } satisfies PermissionActor,
  actorId: "oid-1",
  actorKind: "human",
  auditLabel: "vince@example.com",
};

const serviceActor: AuthorizedActor = {
  actor: { kind: "service", id: "sp_mcp_cursor", status: "active" } satisfies PermissionActor,
  actorId: "sp_mcp_cursor",
  actorKind: "service",
  auditLabel: "cos@petrasoap.com",
};

beforeEach(() => {
  process.env.PLX_MC_ROUTING_CONFIRM_ENABLED = "1";
  gated.ids.clear();
  txState.proposals.clear();
  txState.intents.length = 0;
  txState.entities.clear();
  txState.entityData.clear();
  txState.seq = 100;
  txState.decisions = 0;
  txState.links = 0;
  txState.proposals.set("prop-create", {
    id: "prop-create",
    repo_id: "petralabx/PLX_MC",
    change_id: "99",
    session_id: null,
    state: "action_required",
    title: "New work",
    body_content_hash: "hash",
    markers: [],
    derived_project_id: null,
    failure_reason: null,
    selected_task_id: null,
    selected_bucket_id: null,
  });
});

describe("creationIntentHash", () => {
  it("is stable for the same creation payload", () => {
    const a = creationIntentHash({
      bucketId: "BKT-OPS",
      title: "Ship routing",
      repos: ["petralabx/PLX_MC"],
      accountableOwnerId: "oid-1",
      projectId: "PRJ-1",
    });
    const b = creationIntentHash({
      bucketId: "BKT-OPS",
      title: "Ship routing",
      repos: ["petralabx/PLX_MC"],
      accountableOwnerId: "oid-1",
      projectId: "PRJ-1",
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("createConfirmedTask", () => {
  it("allocates a sequence Task id and resolves the proposal", async () => {
    const result = await createConfirmedTask(human, {
      proposalId: "prop-create",
      bucketId: "BKT-OPS",
      title: "Ship routing",
      repos: ["petralabx/PLX_MC"],
      accountableOwnerId: "oid-1",
      authorizationTrust: "persisted_decision",
    });
    expect(result.created).toBe(true);
    expect(result.taskId).toBe("TASK-101");
    expect(result.decisionKind).toBe("create_task");
    expect(txState.entities.has("TASK-101")).toBe(true);
    expect(txState.proposals.get("prop-create")!.state).toBe("resolved");
    expect(txState.proposals.get("prop-create")!.selected_task_id).toBe("TASK-101");
  });

  it("replays the same Task for matching creation intent", async () => {
    const first = await createConfirmedTask(human, {
      proposalId: "prop-create",
      bucketId: "BKT-OPS",
      title: "Ship routing",
      repos: ["petralabx/PLX_MC"],
      accountableOwnerId: "oid-1",
    });
    // Reset proposal to action_required but keep intent — simulates retry mid-flight.
    txState.proposals.get("prop-create")!.state = "action_required";
    txState.proposals.get("prop-create")!.selected_task_id = null;
    const seqBefore = txState.seq;
    const second = await createConfirmedTask(human, {
      proposalId: "prop-create",
      bucketId: "BKT-OPS",
      title: "Ship routing",
      repos: ["petralabx/PLX_MC"],
      accountableOwnerId: "oid-1",
    });
    expect(second.taskId).toBe(first.taskId);
    expect(second.replayed).toBe(true);
    expect(txState.seq).toBe(seqBefore);
  });

  it("defaults the kind to kind:needs-review and keeps other labels", async () => {
    const result = await createConfirmedTask(human, {
      proposalId: "prop-create",
      bucketId: "BKT-OPS",
      title: "Kindless",
      accountableOwnerId: "oid-1",
      labels: ["Lane:Dev "],
    });
    expect(txState.entityData.get(result.taskId)?.labels).toEqual(["lane:dev", "kind:needs-review"]);
  });

  it("merges the kind param into labels and rejects a disagreeing kind label", async () => {
    const result = await createConfirmedTask(human, {
      proposalId: "prop-create",
      bucketId: "BKT-OPS",
      title: "Coded",
      accountableOwnerId: "oid-1",
      kind: "code",
    });
    expect(txState.entityData.get(result.taskId)?.labels).toEqual(["kind:code"]);
    txState.proposals.get("prop-create")!.state = "action_required";
    await expect(createConfirmedTask(human, {
      proposalId: "prop-create",
      bucketId: "BKT-OPS",
      title: "Conflict",
      accountableOwnerId: "oid-1",
      kind: "code",
      labels: ["kind:decision"],
    })).rejects.toMatchObject({ code: "invalid_request", status: 400 });
  });

  // TASK-4200 (S1-03): only the portal's closeStale adds uat:stale, so no create
  // door stores it. Refused before the transaction: no intent, id or row.
  it("refuses a uat:stale label with 403 before any write, in any case and with spaces", async () => {
    await expect(createConfirmedTask(human, {
      proposalId: "prop-create",
      bucketId: "BKT-OPS",
      title: "Stale on create",
      accountableOwnerId: "oid-1",
      kind: "code",
      labels: ["uat:r5jd2k", " UAT:Stale "],
    })).rejects.toMatchObject({ code: "forbidden", status: 403, message: expect.stringContaining("closeStale") });
    expect(txState.seq).toBe(100);
    expect(txState.intents).toEqual([]);
    expect(txState.entities.size).toBe(0);
    expect(txState.proposals.get("prop-create")!.state).toBe("action_required");
  });

  it("requires accountable owner", async () => {
    await expect(
      createConfirmedTask(human, {
        proposalId: "prop-create",
        bucketId: "BKT-OPS",
        title: "No owner",
        accountableOwnerId: "",
      })
    ).rejects.toMatchObject({ code: "accountable_owner_required" });
  });

  it("allows MCP service principal via routing.resolve (not task.create)", async () => {
    const result = await createConfirmedTask(serviceActor, {
      proposalId: "prop-create",
      bucketId: "BKT-OPS",
      title: "Agent confirmed create",
      accountableOwnerId: "oid-human",
      authorizationTrust: "persisted_decision",
    });
    expect(result.created).toBe(true);
    expect(result.taskId).toMatch(/^TASK-\d+$/);
  });

  it("starts a gated service creator's routed task with a pending creator approval (TASK-3631)", async () => {
    gated.ids.add("sp_mcp_cursor");
    const result = await createConfirmedTask(serviceActor, {
      proposalId: "prop-create",
      bucketId: "BKT-OPS",
      title: "Gated routed create",
      accountableOwnerId: "oid-human",
      authorizationTrust: "persisted_decision",
    });
    const task = txState.entityData.get(result.taskId) as unknown as { creatorApproval?: Record<string, unknown> };
    expect(task.creatorApproval).toMatchObject({ principal: "sp_mcp_cursor", status: "pending" });
    expect(typeof task.creatorApproval?.requestedAt).toBe("string");
  });

  it("sets no creator approval for an ungated service or a person", async () => {
    const svc = await createConfirmedTask(serviceActor, {
      proposalId: "prop-create",
      bucketId: "BKT-OPS",
      title: "Ungated routed create",
      accountableOwnerId: "oid-human",
      authorizationTrust: "persisted_decision",
    });
    expect((txState.entityData.get(svc.taskId) as unknown as { creatorApproval?: unknown }).creatorApproval).toBeUndefined();
    txState.proposals.get("prop-create")!.state = "action_required";
    gated.ids.add("oid-1"); // a person's oid is never a gated creator, even if listed
    const person = await createConfirmedTask(human, {
      proposalId: "prop-create",
      bucketId: "BKT-OPS",
      title: "Person routed create",
      accountableOwnerId: "oid-1",
    });
    expect((txState.entityData.get(person.taskId) as unknown as { creatorApproval?: unknown }).creatorApproval).toBeUndefined();
  });

  it("rejects missing bucket", async () => {
    await expect(
      createConfirmedTask(human, {
        proposalId: "prop-create",
        bucketId: "BKT-MISSING",
        title: "Nope",
        accountableOwnerId: "oid-1",
      })
    ).rejects.toMatchObject({ code: "invalid_bucket" });
  });
});
