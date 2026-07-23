// Contextual predicates applied after a capability grant matches.
// Keep these typed and explicit — no expression language / policy DSL.

import type {
  AuthorizeInput,
  DenyReasonCode,
  PermissionActor,
} from "./types";

export function evaluateContext(
  actor: PermissionActor,
  input: AuthorizeInput
): DenyReasonCode | null {
  const { resource, context, capability } = input;

  if (
    resource?.type === "task" &&
    context?.repositoryId &&
    Array.isArray(resource.repos) &&
    resource.repos.length > 0 &&
    !resource.repos.includes(context.repositoryId)
  ) {
    return "repository_mismatch";
  }

  // Human-only planning mutations never succeed for service principals even if
  // a future registry mistake listed them — defense in depth beside grants.
  if (
    actor.kind === "service" &&
    (capability === "bucket.create" ||
      capability === "bucket.update" ||
      capability === "project.create" ||
      capability === "project.update" ||
      capability === "permissions.manage" ||
      capability === "repo.approve" ||
      capability === "approval.decide")
  ) {
    return "context_denied";
  }

  return null;
}
