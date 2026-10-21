// GET /api/questions — the signed-in person's open questions (TASK-3567):
// only questions addressed to them, only on tasks their project ACL lets them
// see. The filter runs here, never in the client, so nobody else's questions
// reach this screen. Session-authenticated read.

import { route } from "@/lib/api/route";
import { sessionAuthorId } from "@/lib/api/session-actor";
import { listOpenQuestions } from "@/lib/compliance/questions";
import { aclPrincipalFromAuthorized, requireSessionActor } from "@/lib/routing/mutations/actors";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const authorized = await requireSessionActor("task.read");
  const questions = await listOpenQuestions(
    sessionAuthorId(authorized.auditLabel),
    aclPrincipalFromAuthorized(authorized)
  );
  return { questions };
});
