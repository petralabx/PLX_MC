import { z } from "zod";
import { actionCreateProject } from "@/lib/mcp/actions";
import {
  actionListProjects,
  actionUpdateProject,
  updateProjectSchema,
} from "@/lib/mcp/project-actions";
import { cursorRoute, parseCursorBody } from "@/lib/mcp/route";

const createProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  owner: z.string().min(1).optional(),
  health: z.enum(["track", "risk", "off"]).optional(),
  target: z.string().optional(),
  started: z.string().optional(),
  repos: z.array(z.string()).optional(),
  prd: z.string().nullable().optional(),
  visibility: z.enum(["shared", "restricted"]).optional(),
  members: z.array(z.string().trim().min(1).max(320)).max(200).optional(),
});

export const POST = cursorRoute("mc_create_project", async (req, _ctx, identity) => {
  const result = await actionCreateProject(
    identity,
    await parseCursorBody(req, createProjectSchema)
  );
  return { data: result };
});

export const PATCH = cursorRoute("mc_update_project", async (req, _ctx, identity) => {
  const body = await parseCursorBody(req, updateProjectSchema);
  return { data: await actionUpdateProject(identity, body) };
});

export const GET = cursorRoute("mc_list_projects", async (req, _ctx, identity) => {
  const params = new URL(req.url).searchParams;
  const status = params.get("status");
  const q = params.get("q");
  return {
    data: await actionListProjects(identity, {
      includeArchived: params.get("includeArchived") === "true",
      ...(status ? { status } : {}),
      ...(q ? { q } : {}),
    }),
  };
});
