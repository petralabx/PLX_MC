// POST /api/compliance/complete — the done marker (mirrors VMC complete_task).
// Records the completion as an event; the bundle itself (evidence/rollback/PRD)
// is set on the task through the normal task-edit flow and checked by the gate.

import { z } from "zod";
import { parseBody, route } from "@/lib/api/route";
import { complete } from "@/lib/compliance/service";

const completeSchema = z.object({
  checkoutId: z.string().min(1),
  summary: z.string().min(1),
  commitSha: z.string().optional(),
  prUrl: z.string().url().optional(),
});

export const POST = route(async (req) => complete(await parseBody(req, completeSchema)));
