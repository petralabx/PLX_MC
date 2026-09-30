// Optional idempotency key on task create (agent fleet P8b). POST
// /api/cursor/tasks and the mc_create_task MCP tool share it through
// actionCreateTask.
//
// The key rides on the mc_events dedup keys (migration 010), so it needs no
// migration. The first call appends a claim event keyed
// task.create.idempotency:<principal>:<key> with a hash of the payload. Only
// the call whose insert wins creates the task. Its result event carries the
// task id and commits in the same transaction as the task, so a task never
// exists without its result. A repeat from the same principal finds the claim:
// - a different payload hash gives 409 idempotency_key_reused;
// - a result gives the original task back and creates nothing;
// - a failure marker gives 409 idempotency_key_failed (send a new key);
// - with no result yet, the first call still runs. The repeat waits a short
//   time for the result, then gives 409 idempotency_in_progress;
// - a claim with no result after abandonAfterSeconds is abandoned: the first
//   call stopped before its create committed. The repeat writes the failure
//   marker and gives 409 idempotency_key_failed. A lock on the claim key makes
//   the marker and the result exclusive, so a late first call rolls its task
//   back.

import { createHash } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/api/route";
import * as complianceRepo from "@/lib/compliance/repo";
import { withTransaction, type TxQuery } from "@/lib/db";

// The key is the last part of the dedup key, so it may not contain ":".
export const idempotencyKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
    "idempotencyKey must start with a letter or digit and use letters, digits, '.', '_' or '-'"
  );

const CLAIM_KIND = "task.create.idempotency";
const RESULT_KIND = `${CLAIM_KIND}.result`;
const FAILED_KIND = `${CLAIM_KIND}.failed`;

// MC sets the reporter from the MCP identity, so it is not part of the payload.
const UNHASHED_FIELDS = new Set(["reporter", "idempotencyKey"]);

// Sorted keys, and no undefined or null fields: an absent field and a null
// field ask for the same task.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .filter((key) => record[key] !== undefined && record[key] !== null)
        .map((key) => [key, canonical(record[key])])
    );
  }
  return value;
}

/** A stable hash of a task-create payload, without the reporter and the key. */
export function taskCreatePayloadHash(input: object): string {
  const fields = Object.fromEntries(
    Object.entries(input).filter(([key]) => !UNHASHED_FIELDS.has(key))
  );
  return createHash("sha256").update(JSON.stringify(canonical(fields))).digest("hex");
}

export interface IdempotentCreateClaim {
  principalId: string;
  idempotencyKey: string;
  payloadHash: string;
  /** mc_events actor and repo columns (the MCP runtime and X-MC-Repo). */
  actor: string;
  repo: string | null;
}

export interface IdempotentCreatePolling {
  pollMs: number;
  pollAttempts: number;
  /** A claim with no result or failure marker after this age is abandoned. */
  abandonAfterSeconds: number;
}

// A repeat waits up to about 5 s for a create that still runs. A create
// transaction ends well inside 120 s (query_timeout is 20 s).
const DEFAULT_POLLING: IdempotentCreatePolling = {
  pollMs: 250,
  pollAttempts: 20,
  abandonAfterSeconds: 120,
};

/**
 * Records the result inside the create transaction. `create` must call it
 * before its transaction commits (createTask's inTransaction option). It
 * throws, and so rolls the task back, when the claim is already closed.
 */
export type PersistIdempotencyResult = (q: TxQuery, taskId: string) => Promise<void>;

function keyFailed(idempotencyKey: string): ApiError {
  return new ApiError(
    "idempotency_key_failed",
    `The first create with idempotencyKey ${idempotencyKey} failed and created no task. Send a new key.`,
    409
  );
}

/**
 * Run `create` at most once per principal and idempotency key. Resolves to the
 * created task id, or to the original task id with replayed: true.
 */
export async function runIdempotentTaskCreate(
  claim: IdempotentCreateClaim,
  create: (persistResult: PersistIdempotencyResult) => Promise<string>,
  polling: Partial<IdempotentCreatePolling> = {}
): Promise<{ taskId: string; replayed: boolean }> {
  const opts = { ...DEFAULT_POLLING, ...polling };
  const claimKey = `${CLAIM_KIND}:${claim.principalId}:${claim.idempotencyKey}`;
  const resultKey = `${claimKey}:task`;
  const failedKey = `${claimKey}:failed`;
  const payload = {
    principalId: claim.principalId,
    idempotencyKey: claim.idempotencyKey,
    payloadHash: claim.payloadHash,
  };
  const event = { actor: claim.actor, repo: claim.repo };
  const claimed = await complianceRepo.appendEvent({
    kind: CLAIM_KIND,
    ...event,
    taskId: null,
    payload,
    dedupKey: claimKey,
  });

  if (claimed !== undefined) {
    const persistResult: PersistIdempotencyResult = async (q, taskId) => {
      await complianceRepo.lockDedupKeyTx(q, claimKey);
      if (await complianceRepo.eventAgeByDedupKeyTx(q, failedKey)) {
        throw keyFailed(claim.idempotencyKey);
      }
      const seq = await complianceRepo.appendEventTx(q, {
        kind: RESULT_KIND,
        ...event,
        taskId,
        payload,
        dedupKey: resultKey,
      });
      if (seq === undefined) throw new Error(`idempotency result ${resultKey} already exists`);
    };
    try {
      const taskId = await create(persistResult);
      return { taskId, replayed: false };
    } catch (err) {
      try {
        await complianceRepo.appendEvent({
          kind: FAILED_KIND,
          ...event,
          taskId: null,
          payload: { ...payload, error: err instanceof ApiError ? err.code : "internal" },
          dedupKey: failedKey,
        });
      } catch (markErr) {
        console.error(
          "[task-create-idempotency] failure marker not written for %s: %s",
          claimKey,
          markErr instanceof Error ? markErr.message : "error"
        );
      }
      throw err;
    }
  }

  const existing = await complianceRepo.eventByDedupKey(claimKey);
  if (!existing) {
    throw new Error(`idempotency claim ${claimKey} conflicted but was not found`);
  }
  if (existing.payload.payloadHash !== claim.payloadHash) {
    throw new ApiError(
      "idempotency_key_reused",
      `idempotencyKey ${claim.idempotencyKey} was already used with a different payload.`,
      409
    );
  }
  // Under the claim lock: the result, the failure marker, or the claim's age.
  // An abandoned claim gets its failure marker here.
  const settle = () =>
    withTransaction(async (q) => {
      await complianceRepo.lockDedupKeyTx(q, claimKey);
      const result = await complianceRepo.eventAgeByDedupKeyTx(q, resultKey);
      if (result?.taskId) return { taskId: result.taskId };
      if (await complianceRepo.eventAgeByDedupKeyTx(q, failedKey)) return { state: "failed" as const };
      const claimRow = await complianceRepo.eventAgeByDedupKeyTx(q, claimKey);
      if (!claimRow || claimRow.ageSeconds < opts.abandonAfterSeconds) {
        return { state: "in_progress" as const };
      }
      await complianceRepo.appendEventTx(q, {
        kind: FAILED_KIND,
        ...event,
        taskId: null,
        payload: { ...payload, error: "abandoned" },
        dedupKey: failedKey,
      });
      return { state: "failed" as const };
    });
  for (let attempt = 0; ; attempt += 1) {
    const outcome = await settle();
    if (outcome.taskId) return { taskId: outcome.taskId, replayed: true };
    if (outcome.state === "failed") throw keyFailed(claim.idempotencyKey);
    if (attempt >= opts.pollAttempts) break;
    await new Promise((resolve) => setTimeout(resolve, opts.pollMs));
  }
  throw new ApiError(
    "idempotency_in_progress",
    `The first create with idempotencyKey ${claim.idempotencyKey} has not finished. Retry with the same key.`,
    409
  );
}
