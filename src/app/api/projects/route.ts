// POST /api/projects — create a project (P2). Lands pending until the Projects
// SharePoint mirror increment; persisted in the plx_mc DB so it survives reload.
// Attached repos are allow-list-clamped server-side.

import { z } from "zod";
import { parseBody, route } from "@/lib/api/route";
import { requireSessionActor } from "@/lib/routing/mutations/actors";
import { createProject } from "@/lib/sync";

const createProjectSchema = z.object({
  name: z.string().min(1),
  owner: z.string().min(1).optional(),
  health: z.enum(["track", "risk", "off"]).optional(),
  target: z.string().optional(),
  started: z.string().optional(),
  desc: z.string().optional(),
  repos: z.array(z.string()).optional(),
  prd: z.string().nullable().optional(),
});

export const POST = route(async (req) => {
  const body = await parseBody(req, createProjectSchema);
  const authorized = await requireSessionActor("project.create");
  return createProject(body, authorized.auditLabel);
});
