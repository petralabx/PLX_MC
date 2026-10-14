// Goals & Production access: Viewers see and export; Editors also refresh and
// manage manual entries. The roles are Entra app roles on Mission Control's
// sign-in app (values below), assigned to the two Entra groups. They ride in
// the session from sign-in (src/lib/auth) and are checked on the server for
// every request; a role change applies at the user's next sign-in. Server-only.
//
// Without Entra sign-in configured, the report follows the middleware's own
// dormant rule: the Basic break-glass gate gets read-only access, and fully
// open local dev / tests get both roles.

import { ApiError } from "@/lib/api/route";
import { auth, oidcEnabled } from "@/lib/auth";
import { appendEvent } from "@/lib/compliance/repo";
import { basicAuthConfigured, databaseConfigured } from "@/lib/secrets";

export const GOALS_VIEWER_ROLE = "Goals.Viewer";
export const GOALS_EDITOR_ROLE = "Goals.Editor";

export type GoalsRole = "viewer" | "editor";

export interface GoalsActor {
  /** Who acted, for audit fields (the signed-in email). */
  label: string;
  roles: GoalsRole[];
  mode: "entra" | "break-glass" | "local";
}

/** Map Entra app-role values to report roles (Editor implies Viewer). */
export function goalsRolesFromClaims(roles: readonly string[] | null | undefined): GoalsRole[] {
  const assigned = new Set(roles ?? []);
  if (assigned.has(GOALS_EDITOR_ROLE)) return ["viewer", "editor"];
  if (assigned.has(GOALS_VIEWER_ROLE)) return ["viewer"];
  return [];
}

export async function resolveGoalsActor(): Promise<GoalsActor | null> {
  if (!oidcEnabled()) {
    return basicAuthConfigured()
      ? { label: "break-glass", roles: ["viewer"], mode: "break-glass" }
      : { label: "local-dev", roles: ["viewer", "editor"], mode: "local" };
  }
  let session: { user?: { email?: string | null; roles?: string[] } } | null;
  try {
    session = (await auth()) as typeof session;
  } catch {
    return null;
  }
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email) return null;
  return { label: email, roles: goalsRolesFromClaims(session?.user?.roles), mode: "entra" };
}

/** The signed-in actor if they hold `role`; otherwise 401/403 (refused writes are logged). */
export async function requireGoalsRole(role: GoalsRole): Promise<GoalsActor> {
  const actor = await resolveGoalsActor();
  if (!actor) throw new ApiError("not_authenticated", "Sign in to see Goals & production.", 401);
  if (actor.roles.includes(role)) return actor;
  if (role === "editor" && databaseConfigured()) {
    try {
      await appendEvent({ kind: "reporting.goals.denied", actor: `human:${actor.label}`, payload: { role, mode: actor.mode } });
    } catch (err) {
      console.error("[reporting-goals] could not record a refused write: %s", err instanceof Error ? err.message : String(err));
    }
  }
  throw new ApiError(
    "forbidden",
    role === "editor"
      ? `Only Goals & production Editors can do this (Entra app role ${GOALS_EDITOR_ROLE}).`
      : `Goals & production needs the ${GOALS_VIEWER_ROLE} or ${GOALS_EDITOR_ROLE} Entra app role.`,
    403
  );
}
