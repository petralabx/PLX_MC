// POST /api/sync/sweep — run an outbound+inbound sweep now (the Sync
// console's "Sync now"); returns new counts (spec §6).

import { z } from "zod";
import { parseBody, route } from "@/lib/api/route";
import { runSweep } from "@/lib/sync";

const sweepSchema = z.object({ actor: z.string().min(1) });

export const POST = route(async (req) => runSweep((await parseBody(req, sweepSchema)).actor));
