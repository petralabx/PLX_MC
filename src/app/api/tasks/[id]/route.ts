// PATCH /api/tasks/{id} — update task fields (reassign and two-way scalars).

import { z } from "zod";
import { ApiError, parseBody, route } from "@/lib/api/route";
import { patchTask } from "@/lib/sync";

const STAGES = ["backlog", "specced", "approved", "planned", "progress", "qa", "review", "merged", "verified"] as const;

// Exported for unit testing of the validation contract (api-route.test.ts).
// Next treats only HTTP-method exports (PATCH) as route handlers, so a schema
// export is inert for routing.
export const subtaskSchema = z.object({
  id: z.string(),
  t: z.string(),
  done: z.boolean(),
  who: z.string(),
});

export const patchTaskSchema = z.object({
  actor: z.string().min(1),
  assignee: z.string().nullable().optional(),
  title: z.string().min(1).optional(),
  stage: z.enum(STAGES).optional(),
  priority: z.enum(["urgent", "high", "medium", "low"]).optional(),
  due: z.string().optional(),
  description: z.string().optional(),
  bucket: z.string().min(1).optional(), // NEW
  labels: z.array(z.string()).max(25).optional(), // NEW — soft cap (see Risk R6)
  coassignees: z.array(z.string()).optional(), // NEW
  subtasks: z.array(subtaskSchema).optional(), // NEW
  accountableOwner: z.string().nullable().optional(), // EN-003
  humanOnly: z.boolean().optional(), // EN-003
});

export const PATCH = route(async (req, ctx) => {
  const { id } = await ctx.params;
  const { actor, ...patch } = await parseBody(req, patchTaskSchema);
  const task = await patchTask(id, patch, actor);
  if (!task) throw new ApiError("not_found", `unknown task ${id}`, 404);
  return task;
});
