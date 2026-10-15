// Server-side resolution of the human behind a mutating request. In OIDC mode
// the actor is the signed-in Entra session — a caller-supplied actor id is
// never trusted for an authorization decision. Dormant local/test mode has no
// Auth.js session provider, so only there the prototype body `actor` field
// stands in. Server-only (imports Auth.js); the client never calls this.

import { auth, oidcEnabled } from "@/lib/auth";
import { permissionActorFromMcUser } from "@/lib/auth/identity";
import { ACTORS, HUMANS, OPERATOR_ID } from "@/lib/mc-data/data";
import type { Actor, Human } from "@/lib/mc-data/types";
import {
  authorize,
  permissionActorFromDirectoryRole,
  type PermissionResource,
} from "@/lib/permissions";
import { authorizeStaged, recordUnresolvedActorDenial } from "@/lib/permissions/enforcement";
import { findMcUserByEntraOid } from "@/lib/permissions/repository";

import { ApiError } from "./route";

export function actorByEmail(email: string | null | undefined): Actor | undefined {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return undefined;
  return Object.values(ACTORS).find(
    (actor) => actor.kind === "human" && actor.email?.toLowerCase() === normalized
  );
}

// The author id a session-gated write records for the signed-in person: the id
// GET /api/viewer gives them (directory id when the email is listed, else the
// email), so the client's own-comment / own-request checks keep matching.
// `auditLabel` comes from requireSessionActor — never from the request body.
export function sessionAuthorId(auditLabel: string): string {
  const listed = actorByEmail(auditLabel);
  return listed?.kind === "human" ? listed.id : auditLabel;
}

/**
 * Gate a repo.approve action (repo registry, repo request decisions, skill
 * submissions). OIDC: the signed-in session's mc_users row decides — its
 * access_role, kept current from the MC.* Entra app role at sign-in, and its
 * status — in every enforcement mode, since staged modes would otherwise treat
 * every person as admin (TASK-3010). A revoked row is refused.
 *
 * Transitional: until the MC.* app roles exist and approvers have signed in
 * again, a session with no mc_users row falls back to its directory (HUMANS)
 * role, as before TASK-3010, and the fallback is logged. Remove the fallback
 * once every approver has a row (permissions README, TASK-3010 steps).
 *
 * Returns the approver's author id (sessionAuthorId) for self-approval checks.
 * Dormant local/test mode keeps the body actor's directory role.
 */
export async function requireRepoApprover(
  bodyActor: string | undefined,
  deniedMessage: string,
  resource?: PermissionResource
): Promise<{ authorId: string | undefined }> {
  if (!oidcEnabled()) {
    const actor = permissionActorFromDirectoryRole(bodyActor ? ACTORS[bodyActor] : undefined);
    if (!authorize({ actor, capability: "repo.approve" }).allowed) {
      throw new ApiError("not_approver", deniedMessage, 403);
    }
    return { authorId: bodyActor };
  }
  let session: { user?: { oid?: string | null; email?: string | null } } | null;
  try {
    session = (await auth()) as { user?: { oid?: string | null; email?: string | null } } | null;
  } catch {
    throw new ApiError("not_authenticated", "No signed-in session found.", 401);
  }
  const oid = session?.user?.oid?.trim();
  if (!oid) throw new ApiError("not_authenticated", "No signed-in session found.", 401);
  const auditLabel = session?.user?.email?.trim().toLowerCase() || oid;
  const user = await findMcUserByEntraOid(oid);
  if (!user) {
    const directoryActor = actorByEmail(auditLabel);
    if (authorize({ actor: permissionActorFromDirectoryRole(directoryActor), capability: "repo.approve" }).allowed) {
      console.warn("[auth] repo.approve by directory role, no mc_users row (TASK-3010 transitional): %s", auditLabel);
      return { authorId: sessionAuthorId(auditLabel) };
    }
    recordUnresolvedActorDenial({
      site: "repo.approve.session",
      capability: "repo.approve",
      actorKind: "human",
      actorId: oid,
      resource,
      auditLabel,
    });
    throw new ApiError("not_approver", deniedMessage, 403);
  }
  const decision = authorizeStaged({
    site: "repo.approve.session",
    capability: "repo.approve",
    resource,
    auditLabel,
    appliedActor: permissionActorFromMcUser(user),
  });
  if (!decision.allowed) throw new ApiError("not_approver", deniedMessage, 403);
  return { authorId: sessionAuthorId(auditLabel) };
}

// Dormant (no-OIDC) local/test mode has no session provider, so no viewer can
// be read from a session: the hub operator stands in — explicitly, only there.
export const DORMANT_OPERATOR_ID = OPERATOR_ID;

// A signed-in person who is not in the directory (HUMANS) is shown as
// themselves: id = the normalized email (no directory id contains "@", so it
// can never collide with — or impersonate — a listed person), name from the
// Entra session, and the directory's honest default role.
function viewerFromSession(email: string, name: string | null | undefined): Human {
  const display = name?.trim() || email.split("@")[0];
  const words = display.split(/\s+/).filter(Boolean);
  const init = (
    words.length > 1 ? words[0][0] + words[words.length - 1][0] : display.slice(0, 2)
  ).toUpperCase();
  return { id: email, kind: "human", name: display, init, role: "Contributor", online: true, email };
}

// The human behind a page load, for display and client-side attribution (GET
// /api/viewer). OIDC: the signed-in Entra session — their directory record
// when the email is listed, else a viewer built from the session; no readable
// session → null (nobody is borrowed). Dormant mode → the operator. Never an
// authorization input — mutating routes gate on requireRepoApprover or
// requireSessionActor.
export async function resolveViewer(): Promise<Human | null> {
  if (!oidcEnabled()) return HUMANS[DORMANT_OPERATOR_ID] ?? null;
  let session: { user?: { email?: string | null; name?: string | null } } | null;
  try {
    session = (await auth()) as { user?: { email?: string | null; name?: string | null } } | null;
  } catch {
    return null;
  }
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email) return null;
  const listed = actorByEmail(email);
  if (listed?.kind === "human") return listed;
  return viewerFromSession(email, session?.user?.name);
}
