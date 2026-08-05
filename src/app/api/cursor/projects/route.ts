import { z } from "zod";
import { actionCreateProject } from "@/lib/mcp/actions";
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
});

export const POST = cursorRoute("mc_create_project", async (req, _ctx, identity) => {
  const result = await actionCreateProject(
    identity,
    await parseCursorBody(req, createProjectSchema)
  );
  return { data: result };
});
