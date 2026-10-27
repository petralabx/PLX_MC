import { z } from "zod";
import { cursorRoute, parseCursorBody } from "@/lib/mcp/route";
import { actionSaveEvidence, saveEvidenceInputShape } from "@/lib/mcp/actions";
import { taskLink } from "@/lib/mcp/envelope";

const saveEvidenceSchema = z.object(saveEvidenceInputShape);

// POST /api/cursor/save-evidence — mc_save_evidence over REST (TASK-4055).
export const POST = cursorRoute("mc_save_evidence", async (req, _ctx, identity, meta) => {
  const body = await parseCursorBody(req, saveEvidenceSchema);
  const data = await actionSaveEvidence(identity, body);
  return { data, meta: { links: { ...meta.links, task: taskLink(data.taskId) } } };
});
