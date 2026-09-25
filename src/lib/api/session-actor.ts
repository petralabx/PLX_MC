// Server-side resolution of the human behind a mutating request. In OIDC mode
// the actor is the signed-in Entra session — a caller-supplied actor id is
// never trusted for an authorization decision. Dormant local/test mode has no
// Auth.js session provider, so only there the prototype body `actor` field
// stands in. Server-only (imports Auth.js); the client never calls this.

import { auth, oidcEnabled } from "@/lib/auth";
import { ACTORS } from "@/lib/mc-data/data";
import type { Actor } from "@/lib/mc-data/types";

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
