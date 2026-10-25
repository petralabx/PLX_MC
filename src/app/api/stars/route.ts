// GET /api/stars — the signed-in person's stars, in their order.
// PATCH /api/stars — one change, { op: "add" | "remove", key }, and the stored
// list back. A new star is a screen, project or initiative (isStarKey in
// src/lib/stars/store.ts) and goes last; adding to a full list (STAR_CAP)
// answers 409 stars_full.
// One change at a time, never a whole list, so a device never overwrites
// another's stars. Stars are a personal preference (TASK-3842): anyone who can
// read Mission Control (task.read) keeps their own, under their Entra object
// id, which survives an email or directory change; the body never names the
// person (sessionPersonId). Dormant local/test mode has no session, so the
// operator stands in, as GET /api/viewer does (resolveViewer).

import { z } from "zod";

import { ApiError, parseBody, route } from "@/lib/api/route";
import { sessionPersonId } from "@/lib/api/session-actor";
import type { StarChange } from "@/lib/stars";
import { MAX_STAR_KEY_LENGTH, StarsFullError, changeStars, isStarKey, readStars } from "@/lib/stars/store";

export const dynamic = "force-dynamic";

// A remove takes any stored key, so a star that no longer checks out can go.
const changeSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), key: z.string().refine(isStarKey, "not a screen, project or initiative") }),
  z.object({ op: z.literal("remove"), key: z.string().min(1).max(MAX_STAR_KEY_LENGTH) }),
]);

export const GET = route(async () => ({ stars: await readStars(await sessionPersonId()) }));

export const PATCH = route(async (req) => {
  const owner = await sessionPersonId();
  const change = await parseBody(req, changeSchema);
  try {
    return { stars: await changeStars(owner, change as StarChange) };
  } catch (err) {
    if (err instanceof StarsFullError) throw new ApiError("stars_full", err.message, 409);
    throw err;
  }
});
