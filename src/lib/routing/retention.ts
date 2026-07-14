// Retention + expiry planning for routing control-plane records.
// Final typed links and append-only audit events are never deleted by maintenance.

import {
  loadRolloutConfig,
  type RolloutConfig,
  type RolloutRetentionConfig,
} from "./rollout";

export type RetentionRecordKind =
  | "provisional_session"
  | "proposal_detail"
  | "rejected_candidates"
  | "final_link"
  | "audit_event";

export interface RetentionRecord {
  id: string;
  kind: RetentionRecordKind;
  /** ISO timestamp when the record became eligible for retention clock. */
  resolvedAt?: string | null;
  /** ISO timestamp when provisional/session was created. */
  createdAt?: string | null;
  /** ISO timestamp of last activity (idle TTL). */
  lastActivityAt?: string | null;
  /** Absolute session expiry. */
  absoluteExpiresAt?: string | null;
  /** When true, maintenance must preserve the record. */
  preserve?: boolean;
}

export type RetentionAction =
  | "expire_detail"
  | "expire_provisional"
  | "retain"
  | "preserve_final";

export interface RetentionPlanItem {
  id: string;
  kind: RetentionRecordKind;
  action: RetentionAction;
  reason: string;
}

export interface RetentionRunResult {
  expiredProvisional: number;
  expiredProposalDetail: number;
  preservedFinalLinks: number;
  preservedAudit: number;
  retained: number;
  items: RetentionPlanItem[];
}

const MS_DAY = 24 * 60 * 60 * 1000;

function parseTs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function retentionConfig(
  config: RolloutConfig = loadRolloutConfig()
): RolloutRetentionConfig {
  return config.retention;
}

/**
 * Plan retention actions. Never schedules deletion of final links or audit events.
 * Provisional sessions expire by idle (24h) or absolute (7d) TTL.
 * Proposal/candidate detail expires 90 days after resolution (or 7d unresolved UI).
 */
export function planRetentionActions(
  records: RetentionRecord[],
  now: Date = new Date(),
  config: RolloutConfig = loadRolloutConfig()
): RetentionPlanItem[] {
  const nowMs = now.getTime();
  const detailDays = config.retention.proposalDetailDaysAfterResolution;
  const uiExpireDays = config.sla.expireUnresolvedUiDays;
  const items: RetentionPlanItem[] = [];

  for (const record of records) {
    if (record.kind === "final_link" || record.preserve) {
      items.push({
        id: record.id,
        kind: record.kind,
        action: "preserve_final",
        reason: "final_links_and_marked_preserve_are_retained",
      });
      continue;
    }
    if (record.kind === "audit_event") {
      items.push({
        id: record.id,
        kind: record.kind,
        action: "retain",
        reason: "append_only_audit_retained",
      });
      continue;
    }

    if (record.kind === "provisional_session") {
      const absolute = parseTs(record.absoluteExpiresAt);
      const last = parseTs(record.lastActivityAt) ?? parseTs(record.createdAt);
      const idleExpired = last !== null && nowMs - last >= MS_DAY;
      const absoluteExpired = absolute !== null && nowMs >= absolute;
      if (idleExpired || absoluteExpired) {
        items.push({
          id: record.id,
          kind: record.kind,
          action: "expire_provisional",
          reason: absoluteExpired ? "absolute_ttl_7d" : "idle_ttl_24h",
        });
      } else {
        items.push({
          id: record.id,
          kind: record.kind,
          action: "retain",
          reason: "provisional_still_within_ttl",
        });
      }
      continue;
    }

    // proposal_detail | rejected_candidates
    const resolved = parseTs(record.resolvedAt);
    if (resolved !== null) {
      if (nowMs - resolved >= detailDays * MS_DAY) {
        items.push({
          id: record.id,
          kind: record.kind,
          action: "expire_detail",
          reason: `detail_retention_${detailDays}d_after_resolution`,
        });
      } else {
        items.push({
          id: record.id,
          kind: record.kind,
          action: "retain",
          reason: "within_post_resolution_retention",
        });
      }
      continue;
    }

    // Unresolved UI work — expire detail after SLA window (default 7d).
    const created = parseTs(record.createdAt);
    if (created !== null && nowMs - created >= uiExpireDays * MS_DAY) {
      items.push({
        id: record.id,
        kind: record.kind,
        action: "expire_detail",
        reason: `unresolved_ui_expired_${uiExpireDays}d`,
      });
    } else {
      items.push({
        id: record.id,
        kind: record.kind,
        action: "retain",
        reason: "unresolved_within_sla",
      });
    }
  }

  return items;
}

export function summarizeRetentionPlan(items: RetentionPlanItem[]): RetentionRunResult {
  let expiredProvisional = 0;
  let expiredProposalDetail = 0;
  let preservedFinalLinks = 0;
  let preservedAudit = 0;
  let retained = 0;

  for (const item of items) {
    if (item.action === "expire_provisional") expiredProvisional += 1;
    else if (item.action === "expire_detail") expiredProposalDetail += 1;
    else if (item.action === "preserve_final") preservedFinalLinks += 1;
    else if (item.kind === "audit_event") preservedAudit += 1;
    else retained += 1;
  }

  return {
    expiredProvisional,
    expiredProposalDetail,
    preservedFinalLinks,
    preservedAudit,
    retained,
    items,
  };
}

/**
 * Apply a retention plan in-memory. Callers supply a mutator; this function
 * never touches final links or audit events.
 */
export function applyRetentionPlan(
  items: RetentionPlanItem[],
  mutators: {
    expireProvisional?: (id: string) => void;
    expireDetail?: (id: string) => void;
  } = {}
): RetentionRunResult {
  for (const item of items) {
    if (item.action === "expire_provisional") {
      mutators.expireProvisional?.(item.id);
    } else if (item.action === "expire_detail") {
      mutators.expireDetail?.(item.id);
    }
    // preserve_final / retain — no mutation
  }
  return summarizeRetentionPlan(items);
}

/** SLA age helpers used by inbox + maintenance alerting. */
export function slaAgeHours(createdAt: string, now: Date = new Date()): number {
  const created = parseTs(createdAt);
  if (created === null) return 0;
  return (now.getTime() - created) / (60 * 60 * 1000);
}

export function slaBreachBand(
  ageHours: number,
  config: RolloutConfig = loadRolloutConfig()
): "ok" | "alert" | "expire" {
  if (ageHours >= config.sla.expireUnresolvedUiDays * 24) return "expire";
  if (ageHours >= config.sla.alertUnresolvedHours) return "alert";
  return "ok";
}
