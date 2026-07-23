// Durable permissions decision audit (TASK-620). Every enforcement call site
// records allowed/reasonCode/policyVersion plus the enforcement mode in
// effect. Recording is fail-open — an audit sink failure must never block or
// change an authorization outcome — and is a no-op in mode "off" so local
// dev/builds stay DB-free.

import { permissionsEnforcementMode } from "@/lib/auth/identity";
import type { IdentityQuery } from "./types";

export interface PermissionDecisionLogEntry {
  /** Stable call-site tag, e.g. "routing.session" or "mcp.actor". */
  site: string;
  actorKind: "human" | "service";
  actorId: string;
  capability: string;
  resourceType?: string;
  resourceId?: string;
  allowed: boolean;
  reasonCode: string;
  policyVersion: string;
  /** Real-identity verdict while staged modes still apply legacy behavior. */
  shadowAllowed?: boolean;
  shadowReasonCode?: string;
  /** Display / audit label (email or service id) — never a grant input. */
  auditLabel?: string;
}

async function defaultDecisionQuery(
  text: string,
  params: unknown[] = []
): Promise<Record<string, unknown>[]> {
  const { query } = await import("@/lib/db");
  return query(text, params);
}

/**
 * Record one decision row. Never throws; resolves false when recording was
 * skipped (mode off) or the sink failed.
 */
export async function recordPermissionDecision(
  entry: PermissionDecisionLogEntry,
  runQuery: IdentityQuery = defaultDecisionQuery
): Promise<boolean> {
  const mode = permissionsEnforcementMode();
  if (mode === "off") return false;
  try {
    await runQuery(
      `INSERT INTO permissions_decision_log
         (site, actor_kind, actor_id, capability, resource_type, resource_id,
          allowed, reason_code, policy_version, enforcement_mode,
          shadow_allowed, shadow_reason_code, audit_label)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        entry.site,
        entry.actorKind,
        entry.actorId,
        entry.capability,
        entry.resourceType ?? null,
        entry.resourceId ?? null,
        entry.allowed,
        entry.reasonCode,
        entry.policyVersion,
        mode,
        entry.shadowAllowed ?? null,
        entry.shadowReasonCode ?? null,
        entry.auditLabel ?? null,
      ]
    );
    return true;
  } catch (err) {
    console.error(
      "[permissions] decision audit write failed (fail-open): %s",
      err instanceof Error ? err.message : String(err)
    );
    return false;
  }
}
