import { z } from "zod";
import { cursorRoute, parseCursorBody } from "@/lib/mcp/route";
import { actionUploadEvidence, uploadEvidenceInputShape } from "@/lib/mcp/evidence-actions";
import { taskLink } from "@/lib/mcp/envelope";

const uploadEvidenceSchema = z.object(uploadEvidenceInputShape);

// POST /api/cursor/evidence — mc_upload_evidence over REST (TASK-3166).
export const POST = cursorRoute("mc_upload_evidence", async (req, _ctx, identity, meta) => {
  const body = await parseCursorBody(req, uploadEvidenceSchema);
  const data = await actionUploadEvidence(identity, body);
  return { data, meta: { links: { ...meta.links, task: taskLink(data.taskId) } } };
});
