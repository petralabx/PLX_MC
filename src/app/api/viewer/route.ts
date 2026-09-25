// GET /api/viewer — the signed-in human the UI greets and attributes local
// actions to, resolved server-side from the Entra session (resolveViewer).
// Separate from GET /api/state on purpose: it needs no database, so the viewer
// stays correct when the snapshot is unreachable (the offline banner case).

import { route } from "@/lib/api/route";
import { resolveViewer } from "@/lib/api/session-actor";

export const GET = route(async () => ({ viewer: await resolveViewer() }));
