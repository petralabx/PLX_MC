// POST /api/repos — file a self-service repo request (EN-005 / WS-5). Persisted
// server-side and validated against the GitHub org; an approver promotes it to
// the registry via POST /api/repos/{id}/approve. The registry itself hydrates
// through GET /api/state (the snapshot now carries repos + repoRequests).

import { z } from "zod";
import { parseBody, route } from "@/lib/api/route";
import { createRepoRequest } from "@/lib/sync";

const requestRepoSchema = z.object({
  name: z.string().min(1),
  owner: z.string().min(1).optional(),
  scope: z.string().optional(),
  requestedBy: z.string().min(1),
});

export const POST = route(async (req) => createRepoRequest(await parseBody(req, requestRepoSchema)));
