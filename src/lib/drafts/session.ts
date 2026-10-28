// Draft Projects (step 3, TASK-4071): the signed-in person as a DraftActor, for the
// session routes under /api/drafts. The person is the session's Entra oid and
// email, never a body field. Server-only.

import type { Capability } from "@/lib/permissions";
import { aclPrincipalFromAuthorized, requireSessionActor } from "@/lib/routing/mutations/actors";

import { assertDraftsEnabled } from "./flag";
import type { DraftActor } from "./service";

export async function draftActorFromSession(capability: Capability): Promise<DraftActor> {
  assertDraftsEnabled();
  const authorized = await requireSessionActor(capability);
  return {
    kind: "human",
    email: authorized.auditLabel,
    principalId: authorized.actorId,
    acl: aclPrincipalFromAuthorized(authorized),
  };
}
