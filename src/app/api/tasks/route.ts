// POST /api/tasks — create a task (spec §6: lands pending until the first
// successful outbound write).

import { z } from "zod";
import { parseBody, route } from "@/lib/api/route";
import { createTask } from "@/lib/sync";

const STAGES = ["backlog", "specced", "approved", "planned", "progress", "qa", "review", "merged", "verified"] as const;

const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  bucket: z.string().min(1),
  stage: z.enum(STAGES).optional(),
  priority: z.enum(["urgent", "high", "medium", "low"]).optional(),
  assignee: z.string().nullable().optional(),
  coassignees: z.array(z.string()).optional(),
  reporter: z.string().min(1),
  accountableOwner: z.string().nullable().optional(),
  humanOnly: z.boolean().optional(),
  reqs: z.array(z.string()).optional(),
  repos: z.array(z.string()).optional(),
  targetEnv: z.enum(["staging", "production"]).optional(),
  estimate: z.enum(["S", "M", "L"]).optional(),
  labels: z.array(z.string()).optional(),
  due: z.string().optional(),
});

export const POST = route(async (req) => createTask(await parseBody(req, createTaskSchema)));
