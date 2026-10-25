// The portal's read-only UAT ticket snapshot (TASK-3706). Default OFF
// (PLX_MC_UAT_PORTAL_READ_ENABLED): the portal does not serve it yet. Contract:
//   GET <PLX_MC_PORTAL_BASE_URL>/api/internal/uat-feedback/mc-snapshot
//   Authorization: Bearer <PLX_MC_PORTAL_READ_TOKEN>
//   200 { "tickets": PortalTicket[] }  (open tickets + those closed in 30 days)
// Never writes to the portal. Every failure is { status: "error" } with a plain
// message the page shows, never an empty snapshot.

import { z } from "zod";
import { portalBaseUrl, portalReadToken, uatPortalReadEnabled } from "@/lib/secrets";
import { PORTAL_TICKET_STATUSES, type PortalRead } from "@/lib/tasks/uat-tickets";

export const PORTAL_SNAPSHOT_PATH = "/api/internal/uat-feedback/mc-snapshot";
export const PORTAL_READ_TIMEOUT_MS = 8_000;

const snapshotSchema = z.object({
  tickets: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        status: z.enum(PORTAL_TICKET_STATUSES),
        step: z.string().max(80),
        attempt: z.number().int().min(1).max(99),
        expectsTask: z.boolean(),
        staging: z.string().max(120).nullable(),
        title: z.string().max(200),
        updatedAt: z.string().min(1),
      })
    )
    .max(5_000),
});

export async function readPortalTickets(now = new Date(), fetchImpl: typeof fetch = globalThis.fetch): Promise<PortalRead> {
  if (!uatPortalReadEnabled()) return { status: "off" };
  const at = now.toISOString();
  const fail = (message: string): PortalRead => {
    console.error("[uat-tickets] portal read failed: %s", message);
    return { status: "error", at, message };
  };
  let token: string;
  try {
    token = portalReadToken();
  } catch {
    return fail("PLX_MC_PORTAL_READ_TOKEN is not set.");
  }
  let body: unknown;
  try {
    const res = await fetchImpl(`${portalBaseUrl()}${PORTAL_SNAPSHOT_PATH}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(PORTAL_READ_TIMEOUT_MS),
    });
    if (!res.ok) return fail(`The portal answered HTTP ${res.status}.`);
    body = await res.json();
  } catch (err) {
    return fail(`Couldn't reach the portal: ${err instanceof Error ? err.message : "unknown error"}.`);
  }
  const parsed = snapshotSchema.safeParse(body);
  if (!parsed.success) return fail("The portal's ticket snapshot is not in the expected shape.");
  return { status: "ok", at, tickets: parsed.data.tickets };
}
