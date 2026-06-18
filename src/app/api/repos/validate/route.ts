// POST /api/repos/validate — validate a self-service repo request against the
// GitHub org (EN-002 / WS-2). Returns the validation outcome; the store records
// it on the request as `verified`. Persistence/approval stays client-side until
// the registry is mirrored to the system of record (see WS2-NOTES.md).

import { z } from "zod";
import { parseBody, route } from "@/lib/api/route";
import { validateRepoInOrg } from "@/lib/sync";
import { REPO_ORG } from "@/lib/mc-data/data";

const validateRepoSchema = z.object({
  name: z.string().min(1),
  owner: z.string().min(1).optional(),
});

export const POST = route(async (req) => {
  const { name, owner } = await parseBody(req, validateRepoSchema);
  return validateRepoInOrg(owner ?? REPO_ORG, name);
});
