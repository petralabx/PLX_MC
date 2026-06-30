// Shared cursor route wrapper — MCP auth, envelope, audit on every call.

import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/api/route";
import { verifyMcpRequest, type McpIdentity } from "./auth";
import { buildMeta, wrapMcpResponse, type McpResponseMeta } from "./envelope";
import { recordMcpToolCall } from "./audit";

type RouteContext = { params: Promise<Record<string, string>> };

export type CursorHandlerResult = {
  data: unknown;
  meta?: Partial<Omit<McpResponseMeta, "requestId" | "ts" | "actor">>;
};

type CursorHandler = (
  req: Request,
  ctx: RouteContext,
  identity: McpIdentity,
  meta: McpResponseMeta
) => Promise<CursorHandlerResult>;

export function cursorRoute(toolName: string, handler: CursorHandler) {
  return async (req: Request, ctx: RouteContext): Promise<NextResponse> => {
    const started = Date.now();
    let identity: McpIdentity | null = null;
    let requestId = "";
    try {
      identity = verifyMcpRequest(req);
      const baseMeta = buildMeta(identity);
      requestId = baseMeta.requestId;
      const result = await handler(req, ctx, identity, baseMeta);
      const merged = buildMeta(identity, result.meta);
      merged.audit = { ...merged.audit, kinds: [toolName, "mcp.tool.invoked"] };
      const eventSeq = await recordMcpToolCall({
        tool: toolName,
        identity,
        requestId: merged.requestId,
        taskId: (result.data as { taskId?: string })?.taskId ?? null,
        checkoutId: (result.data as { checkoutId?: string })?.checkoutId ?? null,
        ok: true,
        durationMs: Date.now() - started,
      });
      if (eventSeq) merged.audit.eventSeq = eventSeq;
      return NextResponse.json(wrapMcpResponse(result.data, merged));
    } catch (err) {
      if (identity) {
        await recordMcpToolCall({
          tool: toolName,
          identity,
          requestId: requestId || buildMeta(identity).requestId,
          ok: false,
          durationMs: Date.now() - started,
          error: err instanceof ApiError ? err.message : "internal",
        }).catch(() => {});
      }
      if (err instanceof ApiError) {
        return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status });
      }
      console.error("[cursor] unhandled error:", err);
      return NextResponse.json({ error: { code: "internal", message: "Internal error." } }, { status: 500 });
    }
  };
}

export async function parseCursorBody<Schema extends z.ZodType>(
  req: Request,
  schema: Schema
): Promise<z.infer<Schema>> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new ApiError("invalid_json", "Request body must be valid JSON.");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError(
      "invalid_request",
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    );
  }
  return parsed.data;
}
