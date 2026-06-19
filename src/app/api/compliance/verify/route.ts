// POST /api/compliance/verify — the gate brain (EN-007 decisions 2, 9, 12). The
// GitHub status check calls this with the PR's repo/number/head + changed paths;
// it returns the pass/block verdict + reasons. The soft-vs-hard (warn vs block)
// decision belongs to the caller (the status-check workflow), not this route.

import { z } from "zod";
import { parseBody, route } from "@/lib/api/route";
import { verifyPrOrQueue } from "@/lib/compliance/service";

const verifySchema = z.object({
  repo: z.string().min(1),
  prNumber: z.number().int().nonnegative(),
  headSha: z.string().min(1),
  changedPaths: z.array(z.string()).default([]),
  labels: z.array(z.string()).optional(),
  checkoutId: z.string().optional(),
  taskId: z.string().optional(),
});

export const POST = route(async (req) => verifyPrOrQueue(await parseBody(req, verifySchema)));
