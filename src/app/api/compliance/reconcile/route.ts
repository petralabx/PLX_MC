// POST /api/compliance/reconcile — replay the fail-closed reconciliation queue
// (EN-007 decision 10). Driven on recovery, by a scheduler, or manually. Returns
// { processed, resolved, failed }.

import { route } from "@/lib/api/route";
import { reconcileSweep } from "@/lib/compliance/service";

export const POST = route(async () => reconcileSweep());
