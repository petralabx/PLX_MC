// GET /api/approvals — the Approvals inbox source (TASK-631): every pending
// runtime approval gate across tasks. Session-authenticated read.

import { listPendingApprovals } from "@/lib/compliance/approvals";
import { route } from "@/lib/api/route";
import { requireSessionActor } from "@/lib/routing/mutations/actors";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  await requireSessionActor("task.read");
  const approvals = await listPendingApprovals();
  return { approvals };
});
