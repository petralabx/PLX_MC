// POST /api/compliance/checkout — the checkout handshake (EN-007 decision 3).
// Mints a per-dispatch credential tying the work to {task, accountable human,
// repo}; the PR gate later resolves the actor from this, not git metadata.

import { z } from "zod";
import { parseBody, route } from "@/lib/api/route";
import { checkout } from "@/lib/compliance/service";

// No actorKind — a checkout always mints an agent credential server-side
// (security review CRITICAL #1); the client cannot self-declare as an operator.
const checkoutSchema = z.object({
  taskId: z.string().min(1),
  runtime: z.string().min(1),
  accountableHuman: z.string().min(1),
  repo: z.string().min(1),
});

export const POST = route(async (req) => checkout(await parseBody(req, checkoutSchema)));
