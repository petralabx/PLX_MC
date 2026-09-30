// Agent reports (agent fleet P8 and P8b). POST /api/cursor/agent-report writes
// one agent.report event per run. GET /api/cursor/agent-reports reads them,
// newest first. Both routes share the id rules below.

import { z } from "zod";
import { ApiError } from "@/lib/api/route";
import type { AgentReportRow } from "@/lib/compliance/repo";

// Ids join into the dedup key with ":", so they may not contain one.
export const agentSlugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, "agentSlug must be a lowercase registry slug");

export const runKeySchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "must use letters, digits, '.', '_' or '-'");

export const AGENT_REPORTS_DEFAULT_LIMIT = 20;
export const AGENT_REPORTS_MAX_LIMIT = 100;

const readerQuerySchema = z.object({
  agentSlug: agentSlugSchema.optional(),
  loopId: runKeySchema.optional(),
  limit: z
    .string()
    .regex(/^[1-9][0-9]{0,2}$/, `limit must be a whole number from 1 to ${AGENT_REPORTS_MAX_LIMIT}`)
    .transform(Number)
    .refine(
      (value) => value <= AGENT_REPORTS_MAX_LIMIT,
      `limit must be a whole number from 1 to ${AGENT_REPORTS_MAX_LIMIT}`
    )
    .optional(),
  // A seq from an earlier page. 18 digits at most keeps it inside bigint.
  cursor: z
    .string()
    .regex(/^[1-9][0-9]{0,17}$/, "cursor must be the nextCursor of an earlier page")
    .optional(),
});

const READER_PARAMS = ["agentSlug", "loopId", "limit", "cursor"] as const;

export interface AgentReportsQuery {
  agentSlug: string | null;
  loopId: string | null;
  limit: number;
  /** Return only reports older than this seq. */
  cursor: string | null;
}

/** Parse the reader query. A malformed value gives 400 invalid_request. */
export function parseAgentReportsQuery(params: URLSearchParams): AgentReportsQuery {
  const raw: Record<string, string> = {};
  const issues: string[] = [];
  for (const name of READER_PARAMS) {
    const values = params.getAll(name);
    if (values.length > 1) issues.push(`${name}: give one value at most`);
    else if (values.length === 1) raw[name] = values[0];
  }
  const parsed = readerQuerySchema.safeParse(raw);
  if (!parsed.success) {
    issues.push(...parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  if (issues.length > 0 || !parsed.success) {
    throw new ApiError("invalid_request", issues.join("; "));
  }
  return {
    agentSlug: parsed.data.agentSlug ?? null,
    loopId: parsed.data.loopId ?? null,
    limit: parsed.data.limit ?? AGENT_REPORTS_DEFAULT_LIMIT,
    cursor: parsed.data.cursor ?? null,
  };
}

export interface AgentReport {
  /** The mc_events seq of the agent.report event. */
  id: string;
  agentSlug: string;
  loopId: string;
  runId: string;
  title: string;
  markdown: string;
  createdAt: string;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function toAgentReport(row: AgentReportRow): AgentReport {
  return {
    id: row.seq,
    agentSlug: text(row.payload.agentSlug),
    loopId: text(row.payload.loopId),
    runId: text(row.payload.runId),
    title: text(row.payload.title),
    markdown: text(row.payload.markdown),
    createdAt: row.ts,
  };
}
