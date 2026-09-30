// Optional idempotency key on task create (agent fleet P8b). POST
// /api/cursor/tasks and the mc_create_task MCP tool share it through
// actionCreateTask.
//
// The key rides on the mc_events dedup keys (migration 010), so it needs no
// migration. The first call appends a claim event keyed
// task.create.idempotency:<principal>:<key> with a hash of the payload. Only
// the call whose insert wins creates the task. That call then appends a result
// event that carries the task id. A repeat from the same principal finds the
// claim:
// - a different payload hash gives 409 idempotency_key_reused;
// - a result gives the original task back and creates nothing;
// - a failure marker gives 409 idempotency_key_failed (send a new key);
// - with no result yet, the first call still runs. The repeat waits a short
//   time for the result, then gives 409 idempotency_in_progress.

import { createHash } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/api/route";
import * as complianceRepo from "@/lib/compliance/repo";

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
}

// A repeat waits up to about 5 s for a create that still runs.
const DEFAULT_POLLING: IdempotentCreatePolling = { pollMs: 250, pollAttempts: 20 };

/**
 * Run `create` at most once per principal and idempotency key. Resolves to the
 * created task id, or to the original task id with replayed: true.
 */
export async function runIdempotentTaskCreate(
  claim: IdempotentCreateClaim,
  create: () => Promise<string>,
  polling: IdempotentCreatePolling = DEFAULT_POLLING
): Promise<{ taskId: string; replayed: boolean }> {
  const claimKey = `${CLAIM_KIND}:${claim.principalId}:${claim.idempotencyKey}`;
  const payload = {
    principalId: claim.principalId,
    idempotencyKey: claim.idempotencyKey,
    payloadHash: claim.payloadHash,
  };
  const claimed = await complianceRepo.appendEvent({
    kind: CLAIM_KIND,
    actor: claim.actor,
    repo: claim.repo,
    taskId: null,
    payload,
    dedupKey: claimKey,
  });

  if (claimed !== undefined) {
    let taskId: string;
    try {
      taskId = await create();
    } catch (err) {
      try {
        await complianceRepo.appendEvent({
          kind: FAILED_KIND,
          actor: claim.actor,
          repo: claim.repo,
          taskId: null,
          payload: { ...payload, error: err instanceof ApiError ? err.code : "internal" },
          dedupKey: `${claimKey}:failed`,
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
    await complianceRepo.appendEvent({
      kind: RESULT_KIND,
      actor: claim.actor,
      repo: claim.repo,
      taskId,
      payload,
      dedupKey: `${claimKey}:task`,
    });
    return { taskId, replayed: false };
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
  for (let attempt = 0; attempt < polling.pollAttempts; attempt += 1) {
    const taskId = await complianceRepo.eventTaskIdByDedupKey(`${claimKey}:task`);
    if (taskId) return { taskId, replayed: true };
    if (await complianceRepo.eventByDedupKey(`${claimKey}:failed`)) {
      throw new ApiError(
        "idempotency_key_failed",
        `The first create with idempotencyKey ${claim.idempotencyKey} failed and created no task. Send a new key.`,
        409
      );
    }
    await new Promise((resolve) => setTimeout(resolve, polling.pollMs));
  }
  throw new ApiError(
    "idempotency_in_progress",
    `The first create with idempotencyKey ${claim.idempotencyKey} has not finished. Retry with the same key.`,
    409
  );
}
