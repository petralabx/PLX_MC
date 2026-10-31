// The portal's read-only UAT endpoints. Default OFF
// (PLX_MC_UAT_PORTAL_READ_ENABLED). Both take the same Bearer token:
//   GET <PLX_MC_PORTAL_BASE_URL>/api/internal/uat-feedback/mc-snapshot
//   Authorization: Bearer <PLX_MC_PORTAL_READ_TOKEN>
//   200 { "tickets": PortalTicket[] }  (open tickets + those closed in 30 days)
// for the UAT tickets view and the drift check (TASK-3706; the portal serves it
// since 28 Oct, TASK-3798, portal PR #3052), and
//   GET <portal>/api/internal/uat-feedback/scorecard?week=YYYY-MM-DD
//   200 plx-uat-scorecard/v1 (src/lib/uat-scorecard/schema.ts)
// for the UAT scorecard (TASK-4196), which the portal does not serve yet.
// Never writes to the portal. Every failure is { status: "error" } with a plain
// message the page shows, never an empty snapshot.

import { z } from "zod";
import { portalBaseUrl, portalReadToken, uatPortalReadEnabled } from "@/lib/secrets";
import { PORTAL_TICKET_STATUSES, type PortalRead } from "@/lib/tasks/uat-tickets";
import { weekOf } from "@/lib/uat-scorecard";
import { snapshotSchema as scorecardSchema, type Snapshot as ScorecardSnapshot } from "@/lib/uat-scorecard/schema";

export const PORTAL_SNAPSHOT_PATH = "/api/internal/uat-feedback/mc-snapshot";
export const PORTAL_SCORECARD_PATH = "/api/internal/uat-feedback/scorecard";
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

/** One GET with the read token: the JSON body, or why there is none. */
async function portalGet(path: string, fetchImpl: typeof fetch): Promise<{ ok: true; body: unknown } | { ok: false; message: string }> {
  let token: string;
  try {
    token = portalReadToken();
  } catch {
    return { ok: false, message: "PLX_MC_PORTAL_READ_TOKEN is not set." };
  }
  try {
    const res = await fetchImpl(`${portalBaseUrl()}${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(PORTAL_READ_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, message: `The portal answered HTTP ${res.status}.` };
    return { ok: true, body: await res.json() };
  } catch (err) {
    return { ok: false, message: `Couldn't reach the portal: ${err instanceof Error ? err.message : "unknown error"}.` };
  }
}

export async function readPortalTickets(now = new Date(), fetchImpl: typeof fetch = globalThis.fetch): Promise<PortalRead> {
  if (!uatPortalReadEnabled()) return { status: "off" };
  const at = now.toISOString();
  const fail = (message: string): PortalRead => {
    console.error("[uat-tickets] portal read failed: %s", message);
    return { status: "error", at, message };
  };
  const got = await portalGet(PORTAL_SNAPSHOT_PATH, fetchImpl);
  if (!got.ok) return fail(got.message);
  const parsed = snapshotSchema.safeParse(got.body);
  if (!parsed.success) return fail("The portal's ticket snapshot is not in the expected shape.");
  return { status: "ok", at, tickets: parsed.data.tickets };
}

/** The scorecard read: off (the default), one week's numbers, or why it failed. */
export type PortalScorecardRead =
  | { status: "off" }
  | { status: "ok"; at: string; snapshot: ScorecardSnapshot }
  | { status: "error"; at: string; message: string };

/** One week of the UAT fix loop; `week` is the Monday (Toronto) that starts it, YYYY-MM-DD. */
export async function readPortalScorecard(
  week: string,
  now = new Date(),
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<PortalScorecardRead> {
  if (!uatPortalReadEnabled()) return { status: "off" };
  const at = now.toISOString();
  const fail = (message: string): PortalScorecardRead => {
    console.error("[uat-scorecard] portal read of week %s failed: %s", week, message);
    return { status: "error", at, message };
  };
  const got = await portalGet(`${PORTAL_SCORECARD_PATH}?week=${encodeURIComponent(week)}`, fetchImpl);
  if (!got.ok) return fail(got.message);
  const parsed = scorecardSchema.safeParse(got.body);
  if (!parsed.success) return fail("The portal's scorecard is not in the expected shape.");
  const answered = weekOf(parsed.data.window.start);
  if (answered !== week) return fail(`The portal answered for the week of ${answered}, not ${week}.`);
  return { status: "ok", at, snapshot: parsed.data };
}
