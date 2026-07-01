import { z } from "zod";

import { ApiError, route } from "@/lib/api/route";
import { listSkillSubmissions, type SkillSubmissionStatus } from "@/lib/skills-directory";

const statusSchema = z.enum(["pending", "approved", "rejected"]);

export const GET = route(async (req) => {
  const rawStatus = new URL(req.url).searchParams.get("status");
  let status: SkillSubmissionStatus | undefined;
  if (rawStatus) {
    const parsed = statusSchema.safeParse(rawStatus);
    if (!parsed.success) {
      throw new ApiError("invalid_status", "status must be pending, approved, or rejected.");
    }
    status = parsed.data;
  }
  return listSkillSubmissions(status);
});
