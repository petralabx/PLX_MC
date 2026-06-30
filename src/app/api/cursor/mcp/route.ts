// Streamable HTTP MCP endpoint — team-registered remote transport at /api/cursor/mcp.

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { ApiError } from "@/lib/api/route";
import { verifyMcpRequest } from "@/lib/mcp/auth";
import { createPlxMcMcpServer } from "@/lib/mcp/create-http-server";

export const runtime = "nodejs";

async function handleMcpRequest(req: Request): Promise<Response> {
  try {
    const identity = verifyMcpRequest(req);
    const server = createPlxMcMcpServer(identity);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(req);
  } catch (err) {
    if (err instanceof ApiError) {
      return Response.json({ error: { code: err.code, message: err.message } }, { status: err.status });
    }
    console.error("[cursor/mcp] unhandled error:", err);
    return Response.json({ error: { code: "internal", message: "Internal error." } }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return handleMcpRequest(req);
}

export async function POST(req: Request) {
  return handleMcpRequest(req);
}

export async function DELETE(req: Request) {
  return handleMcpRequest(req);
}
