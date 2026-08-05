// PATCH /api/projects/{id} — edit a project (P2): owner, health, target,
// started, description, attached repos (allow-list-clamped), PRD link.
// Persisted in the plx_mc DB; the Projects SharePoint mirror is a later increment.

import { z } from "zod";
import { ApiError, parseBody, route } from "@/lib/api/route";
import { requireSessionActor } from "@/lib/routing/mutations/actors";
import { patchProject } from "@/lib/sync";

const patchProjectSchema = z.object({
  // Deprecated / ignored — authority is session oid only.
  actor: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  owner: z.string().min(1).optional(),
  health: z.enum(["track", "risk", "off"]).optional(),
  target: z.string().optional(),
  started: z.string().optional(),
  desc: z.string().optional(),
  repos: z.array(z.string()).optional(),
  prd: z.string().nullable().optional(),
});

export const PATCH = route(async (req, ctx) => {
  const { id } = await ctx.params;
  const patch = await parseBody(req, patchProjectSchema);
  delete patch.actor;
  const authorized = await requireSessionActor("project.update", {
    type: "project",
    id,
  });
  const project = await patchProject(id, patch, authorized.auditLabel);
  if (!project) throw new ApiError("not_found", `unknown project ${id}`, 404);
  return project;
});
