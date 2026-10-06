import { route } from "@/lib/api/route";
import { publicMcBaseUrl } from "@/lib/mcp";

// RFC 9728 metadata is a top-level JSON document, not the app data envelope.
// Interim header-key-only state; TASK-1463 owns any future OAuth issuer.
export const GET = route(async () => Response.json({
  resource: `${publicMcBaseUrl()}/api/cursor/mcp`,
  authorization_servers: [],
}, { headers: { "Cache-Control": "no-store" } }));
