import { z } from "zod";
import { cursorRoute, parseCursorBody } from "@/lib/mcp/route";
import { actionFinishEvidenceUpload, finishEvidenceUploadInputShape } from "@/lib/mcp/evidence-actions";
import { taskLink } from "@/lib/mcp/envelope";

// Finish re-reads the stored video (up to 200 MiB) to check its SHA-256.
export const maxDuration = 60;

const finishEvidenceUploadSchema = z.object(finishEvidenceUploadInputShape);

// POST /api/cursor/evidence/finish — mc_finish_evidence_upload over REST (TASK-3167).
export const POST = cursorRoute("mc_finish_evidence_upload", async (req, _ctx, identity, meta) => {
  const body = await parseCursorBody(req, finishEvidenceUploadSchema);
  const data = await actionFinishEvidenceUpload(identity, body);
  return { data, meta: { links: { ...meta.links, task: taskLink(data.taskId) } } };
});
