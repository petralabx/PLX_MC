// GET /api/state — full mirror snapshot for store hydration.

import { route } from "@/lib/api/route";
import { snapshot } from "@/lib/sync";

export const GET = route(async () => snapshot());
