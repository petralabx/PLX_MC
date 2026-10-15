// POST /api/repos/validate — validate a self-service repo request against the
// GitHub org (EN-002 / WS-2). Returns the validation outcome; the store records
// it on the request as `verified`. Persistence/approval stays client-side until
// the registry is mirrored to the system of record (see WS2-NOTES.md). Needs
// repo.request on the signed-in session (TASK-3011): the probe spends the
// server's GITHUB_TOKEN.

import { z } from "zod";
import { parseBody, route } from "@/lib/api/route";
import { requireSessionActor } from "@/lib/routing/mutations/actors";
import { validateRepoInOrg } from "@/lib/sync";
import { REPO_ORG } from "@/lib/mc-data/data";

const validateRepoSchema = z.object({
  name: z.string().min(1),
  owner: z.string().min(1).optional(),
});

export const POST = route(async (req) => {
  const { name, owner } = await parseBody(req, validateRepoSchema);
  await requireSessionActor("repo.request");
  return validateRepoInOrg(owner ?? REPO_ORG, name);
});
