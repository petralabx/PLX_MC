// The server's verification of a self-service repo request (EN-002): an
// allowed org and a GitHub lookup. POST /api/repos/requests and
// /api/repos/validate record it on the request (TASK-3011, TASK-3043); an
// approval reads only that recorded result, never the client's.

import { ALLOWED_REPO_ORGS } from "@/lib/mc-data/data";
import { isAllowedRepoOrg } from "@/lib/mc-data/repos";
import type { RepoRequest } from "@/lib/mc-data/types";
import { validateRepoInOrg } from "./github";

export type RepoRequestVerification = Pick<RepoRequest, "verified" | "note" | "visibility" | "def" | "lang">;

export async function verifyRepoRequest(owner: string, name: string): Promise<RepoRequestVerification> {
  if (!isAllowedRepoOrg(owner)) {
    return { verified: false, note: `Org ${owner} is not allowed — permitted orgs: ${ALLOWED_REPO_ORGS.join(", ")}.` };
  }
  const result = await validateRepoInOrg(owner, name);
  if (!result.ok) return { verified: false, note: result.note ?? "Could not be validated against the org." };
  return {
    verified: true,
    note: `Validated against ${owner} on GitHub.`,
    visibility: result.visibility,
    def: result.def,
    lang: result.lang,
  };
}
