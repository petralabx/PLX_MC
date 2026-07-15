// Routing repository contracts — typed persistence seams, TxQuery injection,
// replay/idempotency, and proposal/session/revision constraints. Uses an
// in-memory fake query; no live database.

import { describe, expect, it, vi } from "vitest";

import type { TxQuery } from "@/lib/db";
import {
  allocateNextTaskId,
  appendWorkLink,
  getProposalByIdentity,
  getProposalRevision,
  insertCreationIntent,
  lockProposalForUpdate,
  recordDecision,
  upsertProposalRevision,
  upsertRoutingProposal,
  upsertRoutingSession,
} from "@/lib/routing/repo";
import type {
  CreationIntentRecord,
  ProposalIdentity,
  RoutingDecisionInput,
  RoutingEvidenceMeta,
  RoutingProposalInput,
  RoutingRevisionInput,
  RoutingSessionInput,
  WorkLinkInput,
} from "@/lib/routing/types";

type Row = Record<string, unknown>;

const evidenceCannotPersistRawBody: RoutingEvidenceMeta = {
  repoId: "1",
  // @ts-expect-error raw PR body is not an allowed persisted evidence field
  rawBody: "secret",
};
void evidenceCannotPersistRawBody;

function memoryDb() {
  const tables: Record<string, Row[]> = {
    routing_sessions: [],
    routing_proposals: [],
    routing_proposal_revisions: [],
    routing_revision_candidates: [],
    routing_decisions: [],
    routing_work_links: [],
    routing_creation_intents: [],
  };
  let seq = 100;

  const q = (async <R extends object = Record<string, unknown>>(
    text: string,
    params: unknown[] = []
  ): Promise<R[]> => {
    const sql = text.replace(/\s+/g, " ").trim();

    if (sql.includes("FROM routing_proposals") && sql.includes("FOR UPDATE")) {
      const id = String(params[0]);
      const row = tables.routing_proposals.find((r) => r.id === id);
      return (row ? [row] : []) as R[];
    }

    if (sql.startsWith("SELECT id, repo_id, change_id") && sql.includes("routing_proposals")) {
      const [repoId, changeId] = params as string[];
      const row = tables.routing_proposals.find(
        (r) => r.repo_id === repoId && r.change_id === changeId
      );
      return (row ? [row] : []) as R[];
    }

    if (sql.includes("INSERT INTO routing_sessions")) {
      const row: Row = {
        id: params[0],
        repo_id: params[1],
        actor_id: params[2],
        actor_kind: params[3],
        base_branch: params[4],
        source_branch: params[5],
        head_sha: params[6],
        status: params[7],
        absolute_expires_at: params[8],
        idle_expires_at: params[9],
      };
      const existing = tables.routing_sessions.findIndex((r) => r.id === row.id);
      if (existing >= 0) {
        const current = tables.routing_sessions[existing];
        const guarded = sql.includes("routing_sessions.status = 'active'");
        const sameBinding =
          current.repo_id === row.repo_id &&
          current.actor_id === row.actor_id &&
          current.actor_kind === row.actor_kind &&
          current.base_branch === row.base_branch &&
          current.source_branch === row.source_branch;
        if (guarded && (current.status !== "active" || !sameBinding)) return [] as R[];
        tables.routing_sessions[existing] = guarded
          ? {
              ...current,
              head_sha: row.head_sha,
              idle_expires_at: row.idle_expires_at,
            }
          : { ...current, ...row };
        return [tables.routing_sessions[existing]] as R[];
      }
      tables.routing_sessions.push(row);
      return [row] as R[];
    }

    if (sql.includes("INSERT INTO routing_proposals")) {
      const row: Row = {
        id: params[0],
        repo_id: params[1],
        change_id: params[2],
        session_id: params[3],
        state: params[4],
        title: params[5],
        body_content_hash: params[6],
        markers: params[7],
        derived_project_id: params[8],
        failure_reason: params[9],
      };
      const byIdentity = tables.routing_proposals.findIndex(
        (r) => r.repo_id === row.repo_id && r.change_id === row.change_id
      );
      if (byIdentity >= 0) {
        const current = tables.routing_proposals[byIdentity];
        const preserveTerminal =
          sql.includes("routing_proposals.state IN") &&
          (current.state === "resolved" || current.state === "rejected");
        tables.routing_proposals[byIdentity] = {
          ...current,
          ...row,
          id: current.id,
          state: preserveTerminal ? current.state : row.state,
        };
        return [tables.routing_proposals[byIdentity]] as R[];
      }
      tables.routing_proposals.push(row);
      return [row] as R[];
    }

    if (sql.includes("INSERT INTO routing_proposal_revisions")) {
      const row: Row = {
        id: params[0],
        proposal_id: params[1],
        head_sha: params[2],
        policy_version: params[3],
        evidence_meta:
          typeof params[4] === "string" ? JSON.parse(params[4]) : params[4],
      };
      const existing = tables.routing_proposal_revisions.find(
        (r) => r.proposal_id === row.proposal_id && r.head_sha === row.head_sha
      );
      const persisted = existing ?? row;
      if (!existing) tables.routing_proposal_revisions.push(row);

      if (sql.includes("jsonb_to_recordset")) {
        const candidates = JSON.parse(String(params[5] ?? "[]")) as Array<
          Record<string, unknown>
        >;
        for (const candidate of candidates) {
          const candidateRow = {
            id: `${persisted.id}_c${candidate.rank}`,
            revision_id: persisted.id,
            rank: candidate.rank,
            task_id: candidate.task_id,
            bucket_id: candidate.bucket_id,
            project_id: candidate.project_id,
            match_score: candidate.match_score,
            authorization_trust: candidate.authorization_trust,
            reasons: candidate.reasons,
          };
          const candidateExists = tables.routing_revision_candidates.some(
            (current) =>
              current.revision_id === candidateRow.revision_id &&
              current.rank === candidateRow.rank
          );
          if (!candidateExists) {
            tables.routing_revision_candidates.push(candidateRow);
          }
        }
      }
      return [persisted] as R[];
    }

    if (
      sql.startsWith("SELECT id, proposal_id, head_sha") &&
      sql.includes("routing_proposal_revisions")
    ) {
      const [proposalId, headSha] = params as string[];
      const row = tables.routing_proposal_revisions.find(
        (r) => r.proposal_id === proposalId && r.head_sha === headSha
      );
      return (row ? [row] : []) as R[];
    }

    if (
      sql.startsWith("SELECT rank, task_id") &&
      sql.includes("routing_revision_candidates")
    ) {
      const revisionId = String(params[0]);
      return tables.routing_revision_candidates
        .filter((candidate) => candidate.revision_id === revisionId)
        .sort((a, b) => Number(a.rank) - Number(b.rank)) as R[];
    }

    if (sql.includes("INSERT INTO routing_revision_candidates")) {
      const row = {
        id: params[0],
        revision_id: params[1],
        rank: params[2],
        task_id: params[3],
        bucket_id: params[4],
        project_id: params[5],
        match_score: params[6],
        authorization_trust: params[7],
        reasons: params[8],
      };
      const existing = tables.routing_revision_candidates.find(
        (candidate) =>
          candidate.revision_id === row.revision_id && candidate.rank === row.rank
      );
      if (!existing) tables.routing_revision_candidates.push(row);
      return [] as R[];
    }

    if (sql.includes("INSERT INTO routing_decisions")) {
      const row: Row = {
        id: params[0],
        proposal_id: params[1],
        revision_id: params[2],
        decision_kind: params[3],
        task_id: params[4],
        bucket_id: params[5],
        project_id: params[6],
        actor_id: params[7],
        actor_kind: params[8],
        override_reason: params[9],
        rejection_reason: params[10],
        policy_version: params[11],
      };
      const existing = tables.routing_decisions.find(
        (decision) => decision.id === row.id
      );
      if (existing) {
        if (sql.includes("ON CONFLICT")) return [] as R[];
        throw new Error("duplicate routing decision");
      }
      tables.routing_decisions.push(row);
      return [row] as R[];
    }

    if (sql.includes("INSERT INTO routing_work_links")) {
      const row: Row = {
        id: params[0],
        proposal_id: params[1],
        task_id: params[2],
        link_type: params[3],
        repo_id: params[4],
        change_id: params[5],
        head_sha: params[6],
        merge_sha: params[7],
        evidence: params[8],
        created_by: params[9],
      };
      const existing = tables.routing_work_links.find(
        (link) =>
          link.task_id === row.task_id &&
          link.link_type === row.link_type &&
          link.repo_id === row.repo_id &&
          link.change_id === row.change_id &&
          link.head_sha === row.head_sha &&
          link.merge_sha === row.merge_sha
      );
      if (existing) {
        if (sql.includes("ON CONFLICT")) return [] as R[];
        throw new Error("duplicate routing work link");
      }
      tables.routing_work_links.push(row);
      return [row] as R[];
    }

    if (sql.includes("INSERT INTO routing_creation_intents")) {
      const [id, proposalId, hash, taskId] = params as string[];
      const existing = tables.routing_creation_intents.find(
        (r) => r.proposal_id === proposalId && r.creation_intent_hash === hash
      );
      if (existing) return [existing] as R[];
      const row: Row = {
        id,
        proposal_id: proposalId,
        creation_intent_hash: hash,
        task_id: taskId,
      };
      tables.routing_creation_intents.push(row);
      return [row] as R[];
    }

    if (sql.includes("nextval('mc_task_id_seq')") || sql.includes("nextval(\"mc_task_id_seq\")")) {
      seq += 1;
      return [{ next_id: seq }] as R[];
    }

    throw new Error(`unexpected SQL in fake: ${sql}`);
  }) as TxQuery;

  return { q, tables, getSeq: () => seq };
}

describe("routing repo — TxQuery seams", () => {
  it("passes the injected TxQuery into write paths (transaction-aware)", async () => {
    const { q } = memoryDb();
    const spy = vi.fn(q);

    const session: RoutingSessionInput = {
      id: "rtx_session001",
      repoId: "123",
      actorId: "oid-1",
      actorKind: "human",
      baseBranch: "main",
      sourceBranch: "feat/x",
      headSha: null,
      status: "active",
      absoluteExpiresAt: new Date(Date.now() + 7 * 864e5).toISOString(),
      idleExpiresAt: new Date(Date.now() + 864e5).toISOString(),
    };
    await upsertRoutingSession(session, spy as unknown as TxQuery);
    expect(spy).toHaveBeenCalled();
    expect(String(spy.mock.calls[0]?.[0])).toMatch(/routing_sessions/i);
  });

  it("does not rebind immutable session identity or revive terminal sessions", async () => {
    const { q, tables } = memoryDb();
    const session: RoutingSessionInput = {
      id: "rtx_immutable",
      repoId: "repo-1",
      actorId: "actor-1",
      actorKind: "human",
      baseBranch: "main",
      sourceBranch: "feat/a",
      headSha: "sha-1",
      status: "active",
      absoluteExpiresAt: "2099-01-07T00:00:00.000Z",
      idleExpiresAt: "2099-01-01T00:00:00.000Z",
    };
    await upsertRoutingSession(session, q);

    await expect(
      upsertRoutingSession({ ...session, repoId: "repo-2", headSha: "sha-2" }, q)
    ).rejects.toThrow(/returned no row/);
    expect(tables.routing_sessions[0]).toMatchObject({
      repo_id: "repo-1",
      actor_id: "actor-1",
      absolute_expires_at: session.absoluteExpiresAt,
    });

    tables.routing_sessions[0].status = "consumed";
    await expect(
      upsertRoutingSession({ ...session, headSha: "sha-3" }, q)
    ).rejects.toThrow(/returned no row/);
    expect(tables.routing_sessions[0].status).toBe("consumed");
  });

  it("refreshes only mutable active-session fields and keeps absolute expiry", async () => {
    const { q, tables } = memoryDb();
    const session: RoutingSessionInput = {
      id: "rtx_refresh",
      repoId: "repo-1",
      actorId: "actor-1",
      actorKind: "service",
      baseBranch: "main",
      sourceBranch: "feat/a",
      headSha: "sha-1",
      status: "active",
      absoluteExpiresAt: "2099-01-07T00:00:00.000Z",
      idleExpiresAt: "2099-01-01T00:00:00.000Z",
    };
    await upsertRoutingSession(session, q);
    await upsertRoutingSession(
      {
        ...session,
        headSha: "sha-2",
        absoluteExpiresAt: "2099-02-07T00:00:00.000Z",
        idleExpiresAt: "2099-01-02T00:00:00.000Z",
      },
      q
    );
    expect(tables.routing_sessions[0]).toMatchObject({
      head_sha: "sha-2",
      idle_expires_at: "2099-01-02T00:00:00.000Z",
      absolute_expires_at: "2099-01-07T00:00:00.000Z",
    });
  });

  it("locks a proposal with FOR UPDATE for P8 atomic mutation seams", async () => {
    const { q, tables } = memoryDb();
    tables.routing_proposals.push({
      id: "rp_1",
      repo_id: "1",
      change_id: "42",
      state: "action_required",
    });
    const locked = await lockProposalForUpdate("rp_1", q);
    expect(locked?.id).toBe("rp_1");
  });

  it("allocates Task IDs through nextval on the injected query", async () => {
    const { q } = memoryDb();
    const a = await allocateNextTaskId(q);
    const b = await allocateNextTaskId(q);
    expect(a).toMatch(/^TASK-\d+$/);
    expect(b).toMatch(/^TASK-\d+$/);
    expect(a).not.toBe(b);
  });
});

describe("routing repo — proposal identity and revision replay", () => {
  it("persists revision and candidate inputs in one atomic SQL statement", async () => {
    const calls: Array<{ text: string; params: unknown[] }> = [];
    const q = (async <R extends object = Record<string, unknown>>(
      text: string,
      params: unknown[] = []
    ): Promise<R[]> => {
      calls.push({ text, params });
      if (text.includes("WITH persisted_revision")) {
        return [
          {
            id: "rr_atomic",
            proposal_id: "rp_atomic",
            head_sha: "atomic-sha",
            policy_version: "routing.v1",
            evidence_meta: { repoId: "1" },
          },
        ] as R[];
      }
      if (text.includes("FROM routing_proposal_revisions")) {
        return [
          {
            id: "rr_atomic",
            proposal_id: "rp_atomic",
            head_sha: "atomic-sha",
            policy_version: "routing.v1",
            evidence_meta: { repoId: "1" },
          },
        ] as R[];
      }
      if (text.includes("FROM routing_revision_candidates")) {
        return [
          {
            rank: 1,
            task_id: "TASK-1",
            bucket_id: "BKT-A",
            project_id: null,
            match_score: 90,
            authorization_trust: "none",
            reasons: ["persisted"],
          },
        ] as R[];
      }
      throw new Error(`unexpected SQL: ${text}`);
    }) as TxQuery;

    const result = await upsertProposalRevision(
      {
        id: "rr_atomic",
        proposalId: "rp_atomic",
        headSha: "atomic-sha",
        policyVersion: "routing.v1",
        evidenceMeta: { repoId: "1" },
        candidates: [
          {
            rank: 1,
            taskId: "TASK-1",
            bucketId: "BKT-A",
            projectId: null,
            matchScore: 90,
            authorizationTrust: "none",
            reasons: ["persisted"],
          },
        ],
      },
      q
    );

    expect(calls[0]?.text).toContain("WITH persisted_revision");
    expect(calls[0]?.text).toContain("jsonb_to_recordset");
    expect(calls[0]?.text).toContain("INSERT INTO routing_revision_candidates");
    expect(calls.filter((call) => call.text.includes("INSERT INTO"))).toHaveLength(1);
    expect(result.candidates[0]?.taskId).toBe("TASK-1");
  });

  it("upserts proposals by stable {repoId, changeId} identity", async () => {
    const { q } = memoryDb();
    const identity: ProposalIdentity = { repoId: "998877", changeId: "175" };
    const input: RoutingProposalInput = {
      id: "rp_new",
      ...identity,
      sessionId: null,
      state: "action_required",
      title: "feat: routing",
      bodyContentHash: "abc",
      markers: [],
      derivedProjectId: null,
      failureReason: null,
    };
    const first = await upsertRoutingProposal(input, q);
    const second = await upsertRoutingProposal({ ...input, id: "rp_other", title: "updated" }, q);
    expect(first.id).toBe(second.id);
    const loaded = await getProposalByIdentity(identity, q);
    expect(loaded?.title).toBe("updated");
  });

  it("does not reopen a resolved proposal during metadata replay", async () => {
    const { q, tables } = memoryDb();
    const input: RoutingProposalInput = {
      id: "rp_resolved",
      repoId: "petralabx/PLX_MC",
      changeId: "176",
      sessionId: null,
      state: "action_required",
      title: "routing",
      bodyContentHash: "first",
      markers: [],
      derivedProjectId: null,
      failureReason: null,
    };
    await upsertRoutingProposal(input, q);
    tables.routing_proposals[0].state = "resolved";
    const replay = await upsertRoutingProposal(
      { ...input, state: "action_required", bodyContentHash: "second" },
      q
    );
    expect(replay.state).toBe("resolved");
  });

  it("replays the same head-SHA revision idempotently", async () => {
    const { q, tables } = memoryDb();
    tables.routing_proposals.push({
      id: "rp_1",
      repo_id: "1",
      change_id: "9",
      state: "action_required",
    });

    const revision: RoutingRevisionInput = {
      id: "rr_1",
      proposalId: "rp_1",
      headSha: "deadbeef",
      policyVersion: "routing.v1",
      evidenceMeta: { repoId: "1", title: "x", pathCount: 2 },
      candidates: [
        {
          rank: 1,
          taskId: "TASK-1",
          bucketId: "BKT-A",
          projectId: null,
          matchScore: 100,
          authorizationTrust: "author_declaration",
          reasons: ["first persisted candidate"],
        },
      ],
    };

    const a = await upsertProposalRevision(revision, q);
    const b = await upsertProposalRevision({
      ...revision,
      id: "rr_2",
      policyVersion: "routing.v2",
      evidenceMeta: { repoId: "1", title: "changed", pathCount: 9 },
      candidates: [
        {
          rank: 1,
          taskId: "TASK-2",
          bucketId: "BKT-B",
          projectId: null,
          matchScore: 99,
          authorizationTrust: "fuzzy",
          reasons: ["stale replay candidate"],
        },
      ],
    }, q);
    expect(a.id).toBe(b.id);
    expect(tables.routing_proposal_revisions).toHaveLength(1);
    expect(tables.routing_revision_candidates).toHaveLength(1);
    const persisted = await getProposalRevision("rp_1", "deadbeef", q);
    expect(persisted?.policyVersion).toBe("routing.v1");
    expect(persisted?.evidenceMeta.title).toBe("x");
    expect(persisted?.candidates[0]?.taskId).toBe("TASK-1");
  });

  it("backfills a missing candidate rank on same-head replay", async () => {
    const { q, tables } = memoryDb();
    tables.routing_proposals.push({
      id: "rp_backfill",
      repo_id: "1",
      change_id: "10",
      state: "action_required",
    });
    const input: RoutingRevisionInput = {
      id: "rr_backfill",
      proposalId: "rp_backfill",
      headSha: "backfill-sha",
      policyVersion: "routing.v1",
      evidenceMeta: { repoId: "1", title: "first" },
      candidates: [
        {
          rank: 1,
          taskId: "TASK-1",
          bucketId: "BKT-A",
          projectId: null,
          matchScore: 100,
          authorizationTrust: "none",
          reasons: ["one"],
        },
        {
          rank: 2,
          taskId: "TASK-2",
          bucketId: "BKT-B",
          projectId: null,
          matchScore: 80,
          authorizationTrust: "none",
          reasons: ["two"],
        },
      ],
    };
    await upsertProposalRevision(input, q);
    tables.routing_revision_candidates.splice(
      tables.routing_revision_candidates.findIndex((row) => row.rank === 2),
      1
    );

    const replay = await upsertProposalRevision(
      { ...input, id: "rr_replay" },
      q
    );
    expect(replay.candidates.map((candidate) => candidate.rank)).toEqual([1, 2]);
    expect(tables.routing_proposal_revisions).toHaveLength(1);
  });

  it("keeps matchScore separate from authorizationTrust on candidates", async () => {
    const { q, tables } = memoryDb();
    tables.routing_proposals.push({
      id: "rp_1",
      repo_id: "1",
      change_id: "1",
      state: "action_required",
    });
    await upsertProposalRevision(
      {
        id: "rr_1",
        proposalId: "rp_1",
        headSha: "aaa",
        policyVersion: "routing.v1",
        evidenceMeta: { repoId: "1" },
        candidates: [
          {
            rank: 1,
            taskId: "TASK-2",
            bucketId: "BKT-B",
            projectId: "PRJ-1",
            matchScore: 100,
            authorizationTrust: "author_declaration",
            reasons: ["exact marker"],
          },
        ],
      },
      q
    );
    const cand = tables.routing_revision_candidates[0];
    expect(cand.match_score).toBe(100);
    expect(cand.authorization_trust).toBe("author_declaration");
    expect(cand.project_id).toBe("PRJ-1");
  });
});

describe("routing repo — decisions, links, creation intent", () => {
  it("records decisions including override and rejection fields", async () => {
    const { q, tables } = memoryDb();
    const decision: RoutingDecisionInput = {
      id: "rd_1",
      proposalId: "rp_1",
      revisionId: "rr_1",
      decisionKind: "override",
      taskId: "TASK-9",
      bucketId: "BKT-X",
      projectId: null,
      actorId: "oid-owner",
      actorKind: "human",
      overrideReason: "wrong bucket prior",
      rejectionReason: null,
      policyVersion: "routing.v1",
    };
    await recordDecision(decision, q);
    await recordDecision(decision, q);
    expect(tables.routing_decisions).toHaveLength(1);
    expect(tables.routing_decisions[0].override_reason).toBe("wrong bucket prior");
    expect(tables.routing_decisions[0].project_id).toBeNull();
  });

  it("appends typed related|delivery work links without overwrite semantics", async () => {
    const { q, tables } = memoryDb();
    const link: WorkLinkInput = {
      id: "rwl_1",
      proposalId: "rp_1",
      taskId: "TASK-9",
      linkType: "delivery",
      repoId: "1",
      changeId: "99",
      headSha: "abc",
      mergeSha: "def",
      evidence: { note: "confirmed" },
      createdBy: "oid-1",
    };
    await appendWorkLink(link, q);
    await appendWorkLink({ ...link, id: "rwl_replay" }, q);
    await appendWorkLink({ ...link, id: "rwl_2", linkType: "related", mergeSha: null }, q);
    expect(tables.routing_work_links).toHaveLength(2);
    expect(tables.routing_work_links.map((r) => r.link_type)).toEqual(["delivery", "related"]);
  });

  it("creation-intent insert is idempotent on (proposal_id, creation_intent_hash)", async () => {
    const { q } = memoryDb();
    const intent: CreationIntentRecord = {
      id: "rci_1",
      proposalId: "rp_1",
      creationIntentHash: "hash-a",
      taskId: "TASK-101",
    };
    const first = await insertCreationIntent(intent, q);
    const second = await insertCreationIntent({ ...intent, id: "rci_2", taskId: "TASK-999" }, q);
    expect(first.taskId).toBe("TASK-101");
    expect(second.taskId).toBe("TASK-101");
  });
});
