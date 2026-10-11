import { z } from "zod";
import { TASK_KINDS } from "@/lib/tasks/kind";
import { cursorRoute, parseCursorBody } from "@/lib/mcp/route";
import { actionCreateRoutedTask } from "@/lib/mcp/routing-mutation-actions";
import { taskLink } from "@/lib/mcp/envelope";

const createTaskSchema = z.object({
  proposalId: z.string().min(1),
  bucketId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  repos: z.array(z.string()).optional(),
  accountableOwnerId: z.string().min(1),
  revisionId: z.string().optional(),
  headSha: z.string().optional(),
  mergeSha: z.string().optional(),
  labels: z.array(z.string()).optional(),
  kind: z.enum(TASK_KINDS).optional(),
  priority: z.enum(["urgent", "high", "medium", "low"]).optional(),
  authorizationTrust: z
    .enum([
      "credentialed_checkout",
      "persisted_decision",
      "author_declaration",
      "routing_correlation",
      "fuzzy",
      "none",
    ])
    .optional(),
});

export const POST = cursorRoute("mc_create_routed_task", async (req, _ctx, identity, meta) => {
  const body = await parseCursorBody(req, createTaskSchema);
  const data = await actionCreateRoutedTask(identity, body);
  return {
    data,
    meta: {
      links: { ...meta.links, task: taskLink(data.taskId) },
      sync: data.sync,
    },
  };
});
