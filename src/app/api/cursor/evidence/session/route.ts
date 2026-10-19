import { z } from "zod";
import { cursorRoute, parseCursorBody } from "@/lib/mcp/route";
import { actionStartEvidenceUpload, startEvidenceUploadInputShape } from "@/lib/mcp/evidence-actions";
import { taskLink } from "@/lib/mcp/envelope";

const startEvidenceUploadSchema = z.object(startEvidenceUploadInputShape);

// POST /api/cursor/evidence/session — mc_start_evidence_upload over REST (TASK-3167).
export const POST = cursorRoute("mc_start_evidence_upload", async (req, _ctx, identity, meta) => {
  const body = await parseCursorBody(req, startEvidenceUploadSchema);
  const data = await actionStartEvidenceUpload(identity, body);
  return { data, meta: { links: { ...meta.links, task: taskLink(data.taskId) } } };
});
