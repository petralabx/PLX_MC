// The error text an mcp.tool.invoked audit row keeps (TASK-4059). /api/events
// shows these rows to every signed-in reader, and a failed call's row carries no
// draft id the export filter could scope it by. A Draft Projects tool's message
// can quote a restricted draft (preflight names its repos, owners and projects;
// an upload names the draft), so its row keeps only the error code.

import { ApiError } from "@/lib/api/route";

const DRAFT_TOOL = /^mc_([a-z]+_drafts?|upload_draft_artifact)$/;

export function auditErrorText(tool: string, err: unknown): string {
  if (!(err instanceof ApiError)) return "internal";
  return DRAFT_TOOL.test(tool) ? err.code : err.message;
}
