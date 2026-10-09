import { z } from "zod";
import { ApiError } from "@/lib/api/route";
import { taskSearchSchema } from "@/lib/mcp/task-search-schema";
import { cursorRoute, parseCursorBody } from "@/lib/mcp/route";
import { actionCreateTask, actionSearchTasks } from "@/lib/mcp/actions";
import { taskLink } from "@/lib/mcp/envelope";
import { idempotencyKeySchema } from "@/lib/mcp/task-create-idempotency";

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
  // Fleet P8b: a repeat with the same key returns the original task.
  idempotencyKey: idempotencyKeySchema.optional(),
});

export const GET = cursorRoute("mc_search_tasks", async (req, _ctx, identity) => {
  const sp = new URL(req.url).searchParams;
  const parsed = taskSearchSchema.safeParse({
    q: sp.get("q") ?? undefined,
    query: sp.get("query") ?? undefined,
    bucket: sp.get("bucket") ?? undefined,
    stage: sp.get("stage") ?? undefined,
    assignee: sp.get("assignee") ?? undefined,
    completedAfter: sp.get("completedAfter") ?? undefined,
    completedBefore: sp.get("completedBefore") ?? undefined,
    label: sp.get("label") ?? undefined,
    cursor: sp.get("cursor") ?? undefined,
    fields: sp.get("fields") ?? undefined,
    searchComments: sp.has("searchComments")
      ? sp.get("searchComments") === "true" ? true
        : sp.get("searchComments") === "false" ? false : sp.get("searchComments")
      : undefined,
    in: sp.has("in") ? sp.getAll("in").flatMap((value) => value.split(",")) : undefined,
    limit: sp.has("limit") ? Number(sp.get("limit")) : undefined,
  });
  if (!parsed.success) throw new ApiError("invalid_request", parsed.error.message);
  const result = await actionSearchTasks(parsed.data, identity);
  return {
    data: { tasks: result.tasks, total: result.total, nextCursor: result.nextCursor },
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
