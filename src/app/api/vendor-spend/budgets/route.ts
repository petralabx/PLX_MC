// GET /api/vendor-spend/budgets — list budgets. Auth: middleware gate.
// PATCH /api/vendor-spend/budgets — upsert one vendor's monthly budget
// (Zod-validated; vendor must exist in the registry). Needs vendor_spend.write
// on the signed-in session, which is recorded as updatedBy (never the body).

import { z } from "zod";

import { ApiError, parseBody, route } from "@/lib/api/route";
import { requireSessionActor } from "@/lib/routing/mutations/actors";
import { listBudgets, loadVendorRegistry, upsertBudget } from "@/lib/vendor-spend";

export const dynamic = "force-dynamic";

const budgetSchema = z
  .object({
    vendorId: z.string().min(1),
    monthlyBudgetCents: z.number().int().min(0),
    warnPct: z.number().gt(0).max(1).optional(),
    criticalPct: z.number().gt(0).max(1).optional(),
  })
  .refine(
    (b) => b.warnPct === undefined || b.criticalPct === undefined || b.criticalPct >= b.warnPct,
    { message: "criticalPct must be >= warnPct" }
  );

export const GET = route(async () => listBudgets());

export const PATCH = route(async (req) => {
  const body = await parseBody(req, budgetSchema);
  const authorized = await requireSessionActor("vendor_spend.write");
  const loaded = loadVendorRegistry();
  if (!loaded.ok) {
    throw new ApiError("invalid_registry", loaded.error, 500);
  }
  if (!loaded.registry.vendors.some((v) => v.id === body.vendorId)) {
    throw new ApiError("unknown_vendor", `Vendor "${body.vendorId}" is not in the registry.`, 404);
  }
  return upsertBudget({ ...body, updatedBy: authorized.auditLabel });
});
