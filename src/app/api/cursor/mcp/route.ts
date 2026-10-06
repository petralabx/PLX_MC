// Streamable HTTP MCP endpoint — team-registered remote transport at /api/cursor/mcp.

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { ApiError } from "@/lib/api/route";
import { verifyMcpRequest } from "@/lib/mcp/auth";
import {
  isUnauthenticatedBrowserGet,
  mcpBrowserHelpHtml,
} from "@/lib/mcp/browser-help";
import { createPlxMcMcpServer } from "@/lib/mcp/create-http-server";
import { publicMcBaseUrl } from "@/lib/mcp/envelope";

export const runtime = "nodejs";

async function handleMcpRequest(req: Request): Promise<Response> {
  try {
    const identity = await verifyMcpRequest(req);
    const server = createPlxMcMcpServer(identity);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(req);
  } catch (err) {
    if (err instanceof ApiError) {
      return Response.json({ error: { code: err.code, message: err.message } }, {
        status: err.status,
        headers: err.status === 401 ? { "WWW-Authenticate": "Bearer" } : undefined,
      });
    }
    console.error("[cursor/mcp] unhandled error:", err);
    return Response.json({ error: { code: "internal", message: "Internal error." } }, { status: 500 });
  }
}

export async function GET(req: Request) {
  if (isUnauthenticatedBrowserGet(req)) {
    const welcome = `${publicMcBaseUrl()}/welcome`;
    return new Response(mcpBrowserHelpHtml(welcome), {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }
  return handleMcpRequest(req);
}

export async function POST(req: Request) {
  return handleMcpRequest(req);
}

export async function DELETE(req: Request) {
  return handleMcpRequest(req);
}
