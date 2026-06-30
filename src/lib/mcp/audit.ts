// MCP tool audit trail — every cursor API call appends mcp.tool.invoked.

import * as repo from "@/lib/compliance/repo";
import type { McpIdentity } from "./auth";

export async function recordMcpToolCall(input: {
  tool: string;
  identity: McpIdentity;
  requestId: string;
  taskId?: string | null;
  checkoutId?: string | null;
  ok: boolean;
  durationMs: number;
  error?: string | null;
}): Promise<string | undefined> {
  await repo.appendEvent({
    kind: "mcp.tool.invoked",
    actor: `${input.identity.runtime}:${input.identity.operatorEmail}`,
    repo: input.identity.repo,
    taskId: input.taskId ?? null,
    payload: {
      tool: input.tool,
      requestId: input.requestId,
      checkoutId: input.checkoutId ?? null,
      workerId: input.identity.workerId,
      ok: input.ok,
      durationMs: input.durationMs,
      error: input.error ?? null,
    },
    dedupKey: `mcp:${input.requestId}`,
  });
  const rows = await repo.eventsAfter(0, 1, "mcp.tool.invoked");
  return rows.at(-1)?.seq;
}
