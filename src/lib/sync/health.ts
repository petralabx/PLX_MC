// Missed-tick detection + alerting (TASK-624). The sweep cannot detect its
// own absence. Callers:
//   1. GET /api/cron/missed-tick — GitHub Actions sweep-redundancy.yml.
//      That workflow is the independent scheduler. It is the path that still
//      raises the alert when Vercel Cron is down. The route is intentionally
//      absent from vercel.json.
//   2. GET /api/cron/reconcile — Vercel Cron observer. Covers the case where
//      the Actions secret is unset; it goes silent with Vercel Cron.
// Both callers share checkMissedTick, so one sync.missed_tick episode stays
// deduped. Everything here is fail-open — alerting must never break the
// caller.

import { appendEvent, latestEventAt } from "@/lib/compliance/repo";
import { getRegisterInboundCompletions } from "./repo";

/** 3 × the 5-minute cadence: one late tick is noise, three is an outage. */
export const MISSED_TICK_THRESHOLD_MS = 15 * 60_000;

/** One alert per stale episode per hour — re-alerts if the outage persists. */
export const MISSED_TICK_ALERT_DEDUP_MS = 60 * 60_000;

/**
 * Watchdog route. GitHub Actions calls it; vercel.json must not schedule it,
 * or a Vercel Cron outage would silence the alert again.
 */
export const MISSED_TICK_WATCHDOG_PATH = "/api/cron/missed-tick";

/** Production origin the redundancy workflow always pings. */
export const SWEEP_REDUNDANCY_PRODUCTION_ORIGIN = "https://mc.plxcustomer.io";

/**
 * GitHub Actions repo variable. Empty/unset → the staging leg no-ops.
 * Expected value: https://mc-staging.plxcustomer.io (no path).
 */
export const SWEEP_REDUNDANCY_STAGING_URL_VAR = "PLX_MC_STAGING_SWEEP_URL";

/**
 * Added only on the pre-sweep redundancy call. The Actions cadence is the
 * same 15 minutes as the outage threshold, so checking immediately before
 * that tick would report a healthy redundancy-only interval as an outage.
 * One extra 5-minute Vercel slot separates "our last redundancy sweep" from
 * "neither scheduler has run". The strict 15-minute threshold still applies
 * to the reconcile cron and to watchdog-only drill calls.
 */
export const MISSED_TICK_REDUNDANCY_GRACE_MS = 5 * 60_000;

const HEALTH_ACTOR = "scribe";

export interface SweepHealth {
  stale: boolean;
  /** Age of the newest completed inbound stamp; null = no sweep ever completed. */
  ageMs: number | null;
  lastCompleteAt: string | null;
}

/** Pure: newest completion across registers vs the missed-tick threshold. */
export function evaluateSweepHealth(
  completions: Record<string, Date | null>,
  now: Date = new Date(),
  thresholdMs: number = MISSED_TICK_THRESHOLD_MS
): SweepHealth {
  let newest: Date | null = null;
  for (const stamp of Object.values(completions)) {
    if (stamp && (!newest || stamp.getTime() > newest.getTime())) newest = stamp;
  }
  if (!newest) {
    // Never-synced deployments are "stale" only once sync is meant to be live;
    // callers gate on cron being configured, so report stale with no age.
    return { stale: true, ageMs: null, lastCompleteAt: null };
  }
  const ageMs = Math.max(0, now.getTime() - newest.getTime());
  return { stale: ageMs > thresholdMs, ageMs, lastCompleteAt: newest.toISOString() };
}

export function alertWebhookUrl(): string {
  return (process.env.PLX_MC_ALERT_WEBHOOK_URL ?? "").trim();
}

async function postAlertWebhook(text: string): Promise<boolean> {
  const url = alertWebhookUrl();
  if (!url) return false;
  try {
    const resp = await fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    return resp.ok;
  } catch (err) {
    console.error(
      "[sync] missed-tick alert webhook failed (fail-open): %s",
      err instanceof Error ? err.message : String(err)
    );
    return false;
  }
}

export interface MissedTickCheck {
  stale: boolean;
  alerted: boolean;
  ageMs: number | null;
}

export interface MissedTickOptions {
  now?: Date;
  /** Defaults to MISSED_TICK_THRESHOLD_MS. The pre-sweep caller adds the grace. */
  thresholdMs?: number;
  loadCompletions?: () => Promise<Record<string, Date | null>>;
  latestAlertAt?: (kind: string) => Promise<string | null>;
  append?: (e: Parameters<typeof appendEvent>[0]) => Promise<unknown>;
  notify?: (text: string) => Promise<boolean>;
}

/**
 * Evaluate sweep health and raise one deduped missed-tick alert per episode.
 * Never throws — the hosting cron must survive an alerting failure.
 */
export async function checkMissedTick(opts: MissedTickOptions = {}): Promise<MissedTickCheck> {
  const now = opts.now ?? new Date();
  const thresholdMs = opts.thresholdMs ?? MISSED_TICK_THRESHOLD_MS;
  try {
    const completions = await (opts.loadCompletions ?? getRegisterInboundCompletions)();
    const health = evaluateSweepHealth(completions, now, thresholdMs);
    if (!health.stale) return { stale: false, alerted: false, ageMs: health.ageMs };

    const lastAlert = await (opts.latestAlertAt ?? latestEventAt)("sync.missed_tick");
    if (lastAlert && now.getTime() - Date.parse(lastAlert) < MISSED_TICK_ALERT_DEDUP_MS) {
      return { stale: true, alerted: false, ageMs: health.ageMs };
    }

    const ageText =
      health.ageMs == null ? "never" : `${Math.round(health.ageMs / 60_000)} min ago`;
    const text = `PLX MC sync missed-tick: last complete inbound sweep ${ageText} (threshold ${
      thresholdMs / 60_000
    } min). Check Vercel Cron, the sweep-redundancy workflow, and /api/cron/sweep.`;
    await (opts.append ?? appendEvent)({
      kind: "sync.missed_tick",
      actor: HEALTH_ACTOR,
      payload: {
        ageMs: health.ageMs,
        lastCompleteAt: health.lastCompleteAt,
        thresholdMs,
      },
    });
    await (opts.notify ?? postAlertWebhook)(text);
    return { stale: true, alerted: true, ageMs: health.ageMs };
  } catch (err) {
    console.error(
      "[sync] missed-tick check failed (fail-open): %s",
      err instanceof Error ? err.message : String(err)
    );
    return { stale: false, alerted: false, ageMs: null };
  }
}
