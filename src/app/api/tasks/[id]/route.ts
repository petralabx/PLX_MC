// PATCH /api/tasks/{id} — update task fields (reassign and two-way scalars).

import { z } from "zod";
import { ApiError, parseBody, route } from "@/lib/api/route";
import { patchTask } from "@/lib/sync";

const STAGES = ["backlog", "specced", "approved", "planned", "progress", "qa", "review", "merged", "verified"] as const;

const patchTaskSchema = z.object({
  actor: z.string().min(1),
  assignee: z.string().nullable().optional(),
  title: z.string().min(1).optional(),
  stage: z.enum(STAGES).optional(),
  priority: z.enum(["urgent", "high", "medium", "low"]).optional(),
  due: z.string().optional(),
  description: z.string().optional(),
});

export const PATCH = route(async (req, ctx) => {
  const { id } = await ctx.params;
  const { actor, ...patch } = await parseBody(req, patchTaskSchema);
  const task = await patchTask(id, patch, actor);
  if (!task) throw new ApiError("not_found", `unknown task ${id}`, 404);
  return task;
});
