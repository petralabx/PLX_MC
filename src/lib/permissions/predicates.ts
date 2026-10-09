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

  // Administrative mutations remain human-only even if a future registry
  // mistake listed them. Reviewed agents may create and patch buckets
  // (mc_update_bucket / bucket.update) and steward-edit projects
  // (mc_update_project / project.update) but cannot manage permissions/approvals.
  if (
    actor.kind === "service" &&
    (capability === "permissions.manage" ||
      capability === "repo.approve" ||
      capability === "approval.decide")
  ) {
    return "context_denied";
  }

  if (context?.projectVisibility === "restricted") {
    const members = new Set(
      (context.projectMembers ?? []).map((token) => token.trim().toLowerCase()).filter(Boolean)
    );
    const tokens = (context.principalTokens ?? []).map((token) => token.trim().toLowerCase());
    if (members.size === 0 || !tokens.some((token) => members.has(token))) {
      return "context_denied";
    }
  }

  return null;
}
