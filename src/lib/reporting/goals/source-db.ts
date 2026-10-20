// Read-only connection to the PLX reporting replica (FileMaker silver.*, Sage
// sage.*), separate from Mission Control's own pool. The login is read-only and
// each refresh attempt runs in ONE read-only REPEATABLE READ transaction, so all
// datasets come from the same moment. Server-only.

import { Pool } from "pg";

import { resolveDbSsl } from "@/lib/db/tls";
import { reportingDatabaseUrl } from "@/lib/secrets";

import { REPORT_TIME_ZONE } from "./calendar";

/** Time budget for one attempt across all of its queries (brief: time out after 120 s). */
export const ATTEMPT_TIMEOUT_MS = 120_000;

// Survive Next.js dev-mode module reloads without leaking pools.
const globalForReporting = globalThis as unknown as { __plxReportingPool?: Pool };

function pool(): Pool {
  if (!globalForReporting.__plxReportingPool) {
    globalForReporting.__plxReportingPool = new Pool({
      // Strip sslmode — it would override the ssl option (same as src/lib/db).
      connectionString: reportingDatabaseUrl()
        .replace(/([?&])sslmode=[^&]+&?/, "$1")
        .replace(/[?&]$/, ""),
      ssl: resolveDbSsl(),
      max: 2,
      keepAlive: true,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      // Backstop only; statement_timeout below is the real limit.
      query_timeout: ATTEMPT_TIMEOUT_MS + 5_000,
      application_name: "plx-mc-goals-report",
    });
  }
  return globalForReporting.__plxReportingPool;
}

export type SourceQuery = <R extends object>(text: string, params?: unknown[]) => Promise<R[]>;

/** The attempt ran out of its time budget between statements. */
export class AttemptTimeoutError extends Error {
  readonly code = "57014";
  constructor(timeoutMs: number) {
    super(`refresh attempt exceeded ${Math.round(timeoutMs / 1000)} s`);
  }
}

/**
 * Run `fn` in one read-only REPEATABLE READ transaction on the reporting
 * replica. Each statement gets the attempt's remaining time as its
 * statement_timeout, so the whole attempt stops at `timeoutMs`.
 */
export async function withReportingSnapshot<T>(
  fn: (q: SourceQuery) => Promise<T>,
  timeoutMs: number = ATTEMPT_TIMEOUT_MS
): Promise<T> {
  const client = await pool().connect();
  let failure: Error | undefined;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    // The Toronto calendar for any timestamp → date cast. The queries no longer
    // depend on it (the MCP path can't set it, TASK-3489); kept as the default.
    await client.query(`SET LOCAL TIME ZONE '${REPORT_TIME_ZONE}'`);
    const deadline = Date.now() + timeoutMs;
    const q: SourceQuery = async (text, params = []) => {
      const remaining = Math.ceil(deadline - Date.now());
      if (remaining <= 0) throw new AttemptTimeoutError(timeoutMs);
      await client.query(`SET LOCAL statement_timeout = ${remaining}`);
      return (await client.query(text, params)).rows;
    };
    const result = await fn(q);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    failure = err instanceof Error ? err : new Error(String(err));
    try {
      await client.query("ROLLBACK");
    } catch {
      // The connection is already gone; the original error is rethrown below
      // and release(failure) discards the client.
    }
    throw err;
  } finally {
    client.release(failure);
  }
}
