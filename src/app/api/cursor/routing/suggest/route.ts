import { z } from "zod";
import { cursorRoute, parseCursorBody } from "@/lib/mcp/route";
import { actionSuggestWork } from "@/lib/mcp/routing-suggest-actions";

const suggestSchema = z.object({
  title: z.string().optional(),
  branch: z.string().optional(),
  baseBranch: z.string().optional(),
  sourceBranch: z.string().optional(),
  headSha: z.string().optional(),
  body: z.string().optional(),
  changedPaths: z.array(z.string()).optional(),
  labels: z.array(z.string()).optional(),
  routingSessionId: z.string().optional(),
  detailLimit: z.number().int().min(1).max(10).optional(),
});

export const POST = cursorRoute("mc_suggest_work", async (req, _ctx, identity, meta) => {
  const body = await parseCursorBody(req, suggestSchema);
  const data = await actionSuggestWork(identity, body);
  return {
    data,
    meta: {
      links: {
        ...meta.links,
        // Session deep link for human confirmation (P9 inbox consumes this).
        ...(data.deepLinks.session
          ? { events: meta.links.events }
          : {}),
      },
      evidence: {
        routingSessionId: data.routingSessionId,
        candidateCount: data.candidates.length,
        failureReason: data.failureReason,
      },
    },
  };
});
