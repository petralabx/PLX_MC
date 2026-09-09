// GET /api/state — full mirror snapshot for store hydration.
// Restricted projects (and their buckets/tasks/comments) are stripped for
// callers who are not on the project member allowlist.

import { route } from "@/lib/api/route";
import { aclPrincipalFromSession } from "@/lib/routing/mutations/actors";
import { snapshot } from "@/lib/sync";
import { filterStateSideChannels, hiddenHierarchyIds } from "@/lib/permissions/project-acl";
import { scopeHierarchy } from "@/lib/permissions/project-acl-guard";

export const GET = route(async () => {
  const snap = await snapshot();
  const principal = await aclPrincipalFromSession();
  const scoped = scopeHierarchy({
    tasks: snap.tasks,
    buckets: snap.buckets,
    projects: snap.projects,
    principal,
  });
  const visibleBucketIds = new Set(scoped.buckets.map((bucket) => bucket.id));
  const bucketComments = Object.fromEntries(
    Object.entries(snap.bucketComments ?? {}).filter(([bucketId]) => visibleBucketIds.has(bucketId))
  );
  const side = filterStateSideChannels({
    conflicts: snap.conflicts,
    errors: snap.errors,
    audit: snap.audit,
    hiddenIds: hiddenHierarchyIds({
      tasks: snap.tasks,
      buckets: snap.buckets,
      projects: snap.projects,
      visible: scoped,
    }),
  });
  return {
    ...snap,
    tasks: scoped.tasks,
    buckets: scoped.buckets,
    projects: scoped.projects,
    bucketComments,
    conflicts: side.conflicts,
    errors: side.errors,
    audit: side.audit,
  };
});
