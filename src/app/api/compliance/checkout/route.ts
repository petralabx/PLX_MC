// POST /api/compliance/checkout — agent handshake.
// Actor = Entra oid from session; never from request body (P8).

import { z } from "zod";
import { parseBody, route } from "@/lib/api/route";
import { checkout } from "@/lib/compliance/service";
import { requireSessionActor } from "@/lib/routing/mutations/actors";

const checkoutSchema = z.object({
  taskId: z.string().min(1),
  runtime: z.string().min(1),
  accountableHuman: z.string().min(1),
  repo: z.string().min(1),
});

export const POST = route(async (req) => {
  const body = await parseBody(req, checkoutSchema);
  const authorized = await requireSessionActor(
    "task.checkout",
    { type: "task", id: body.taskId },
    { repositoryId: body.repo }
  );
  return checkout({
    ...body,
    actor: authorized.actor,
    door: "compliance",
  });
});
