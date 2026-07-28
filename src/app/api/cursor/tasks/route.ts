import { z } from "zod";
import { cursorRoute, parseCursorBody } from "@/lib/mcp/route";
import { actionCreateTask, actionSearchTasks } from "@/lib/mcp/actions";
import { taskLink } from "@/lib/mcp/envelope";

const createSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  bucket: z.string().min(1),
  stage: z
    .enum(["backlog", "specced", "approved", "planned", "progress", "qa", "review", "merged", "verified"])
    .optional(),
  priority: z.enum(["urgent", "high", "medium", "low"]).optional(),
  assignee: z.string().nullable().optional(),
  // Ignored for identity — MCP service principal + operator email are authoritative.
  reporter: z.string().min(1).optional(),
  accountableOwner: z.string().nullable().optional(),
  repos: z.array(z.string()).optional(),
  targetEnv: z.enum(["staging", "production"]).optional(),
});

export const GET = cursorRoute("mc_search_tasks", async (req) => {
  const sp = new URL(req.url).searchParams;
  const result = await actionSearchTasks({
    q: sp.get("q") ?? undefined,
    query: sp.get("query") ?? undefined,
    bucket: sp.get("bucket") ?? undefined,
    stage: sp.get("stage") ?? undefined,
    limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
  });
  return {
    data: { tasks: result.tasks, total: result.total },
    meta: { filter: result.filter },
  };
});

export const POST = cursorRoute("mc_create_task", async (req, _ctx, identity, meta) => {
  const body = await parseCursorBody(req, createSchema);
  const result = await actionCreateTask(identity, {
    ...body,
    reporter: identity.operatorEmail,
  });
  return {
    data: result,
    meta: {
      links: { ...meta.links, task: taskLink(result.taskId) },
      sync: result.sync,
    },
  };
});
