// POST /api/compliance/reconcile — replay the fail-closed reconciliation queue
// (EN-007 decision 10). Driven on recovery, by a scheduler, or manually. Returns
// { processed, resolved, failed }. Needs compliance.reconcile on the signed-in
// session (TASK-3011); the scheduled run is GET /api/cron/reconcile.

import { route } from "@/lib/api/route";
import { reconcileSweep } from "@/lib/compliance/service";
import { requireSessionActor } from "@/lib/routing/mutations/actors";

export const POST = route(async () => {
  await requireSessionActor("compliance.reconcile");
  return reconcileSweep();
});
