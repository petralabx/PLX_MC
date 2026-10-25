// GET /api/nav-prefs — the signed-in person's navigation preferences,
// { zones, tourSeen } (TASK-3855). PATCH /api/nav-prefs — change one or both,
// and the stored preferences back. `zones` is the "Try the new navigation"
// switch: true, false, or null to forget it (the build's default applies).
// `tourSeen` is true once the person closes the one-screen tour; false shows it
// again. A field the body leaves out keeps its value, so two devices changing
// different preferences both land. Like stars, these are the person's own:
// anyone who can read Mission Control keeps theirs, under the session's Entra
// object id, never a name from the body (sessionPersonId).

import { z } from "zod";

import { parseBody, route } from "@/lib/api/route";
import { sessionPersonId } from "@/lib/api/session-actor";
import { changeNavPrefs, readNavPrefs } from "@/lib/nav-prefs/store";

export const dynamic = "force-dynamic";

const changeSchema = z
  .object({ zones: z.boolean().nullable().optional(), tourSeen: z.boolean().optional() })
  .strict()
  .refine((change) => change.zones !== undefined || change.tourSeen !== undefined, "give zones, tourSeen or both");

export const GET = route(async () => readNavPrefs(await sessionPersonId()));

export const PATCH = route(async (req) => {
  const person = await sessionPersonId();
  return changeNavPrefs(person, await parseBody(req, changeSchema));
});
