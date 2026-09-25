// Server-side resolution of the human behind a mutating request. In OIDC mode
// the actor is the signed-in Entra session — a caller-supplied actor id is
// never trusted for an authorization decision. Dormant local/test mode has no
// Auth.js session provider, so only there the prototype body `actor` field
// stands in. Server-only (imports Auth.js); the client never calls this.

import { auth, oidcEnabled } from "@/lib/auth";
import { ACTORS, HUMANS, OPERATOR_ID } from "@/lib/mc-data/data";
import type { Actor, Human } from "@/lib/mc-data/types";

import { ApiError } from "./route";

export function actorByEmail(email: string | null | undefined): Actor | undefined {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return undefined;
  return Object.values(ACTORS).find(
    (actor) => actor.kind === "human" && actor.email?.toLowerCase() === normalized
  );
}

export async function resolveRequestActor(bodyActor: string | undefined): Promise<Actor | undefined> {
  if (oidcEnabled()) {
    let session: { user?: { email?: string | null } } | null;
    try {
      session = (await auth()) as { user?: { email?: string | null } } | null;
    } catch {
      throw new ApiError("not_authenticated", "No signed-in session found.", 401);
    }
    const actor = actorByEmail(session?.user?.email);
    if (!actor) {
      throw new ApiError("not_authenticated", "No signed-in session found.", 401);
    }
    return actor;
  }
  return bodyActor ? ACTORS[bodyActor] : undefined;
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
// authorization input — mutating routes gate on resolveRequestActor.
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
