// GET /api/approvals/decided?days=N — what the signed-in person decided
// (TASK-3720): questions they answered and gates they approved or rejected,
// newest first, on tasks their project ACL lets them see. days defaults to 14
// and is clamped to 1..90; a value that is not a number is 400.
// Session-authenticated read.

import { z } from "zod";

import { ApiError, route } from "@/lib/api/route";
import { sessionAuthorId } from "@/lib/api/session-actor";
import { DECIDED_DAYS_DEFAULT, DECIDED_DAYS_MAX, listDecided } from "@/lib/compliance/decided";
import { aclPrincipalFromAuthorized, requireSessionActor } from "@/lib/routing/mutations/actors";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  days: z.coerce
    .number()
    .transform((n) => Math.min(DECIDED_DAYS_MAX, Math.max(1, Math.trunc(n))))
    .optional(),
});

export const GET = route(async (req) => {
  const authorized = await requireSessionActor("task.read");
  const raw = new URL(req.url).searchParams.get("days");
  const parsed = querySchema.safeParse({ days: raw === null || raw === "" ? undefined : raw });
  if (!parsed.success) {
    throw new ApiError("invalid_query", `days must be a number (1-${DECIDED_DAYS_MAX}).`);
  }
  const decided = await listDecided(
    { authorId: sessionAuthorId(authorized.auditLabel), auditLabel: authorized.auditLabel },
    aclPrincipalFromAuthorized(authorized),
    parsed.data.days ?? DECIDED_DAYS_DEFAULT
  );
  return { decided };
});
