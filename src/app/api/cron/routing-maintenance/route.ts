// GET /api/cron/routing-maintenance — expire provisional/proposal detail and
// demote breached confirmation cohorts to suggestion-only.
// Outer admission: CRON_SECRET bearer. Writes: durable sp_routing_maintenance
// + routing.maintain only. Final typed links and audit events are preserved.

import { ApiError, route } from "@/lib/api/route";
import {
  ROUTING_MAINTENANCE_SERVICE_PRINCIPAL_ID,
  type PermissionActor,
} from "@/lib/permissions";
import {
  authorizeStaged,
  recordUnresolvedActorDenial,
  resolveStagedServicePrincipal,
} from "@/lib/permissions/enforcement";
import { cronConfigured, cronSecret } from "@/lib/secrets";
import {
  demoteBreachedCohorts,
  listPilotDescriptors,
  loadRolloutConfig,
  maintenanceEnabled,
  type RollingDecision,
} from "@/lib/routing/rollout";
import {
  applyRetentionPlan,
  planRetentionActions,
  type RetentionRecord,
} from "@/lib/routing/retention";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Durable routing-maintenance service principal + routing.maintain.
 * Operator context is never accepted as a grant path.
 */
export async function requireRoutingMaintenance(): Promise<PermissionActor> {
  const staged = await resolveStagedServicePrincipal(
    ROUTING_MAINTENANCE_SERVICE_PRINCIPAL_ID
  );
  if (!staged.actor) {
    recordUnresolvedActorDenial({
      site: "routing.maintenance",
      capability: "routing.maintain",
      actorKind: "service",
      actorId: ROUTING_MAINTENANCE_SERVICE_PRINCIPAL_ID,
      resource: { type: "routing" },
    });
    throw new ApiError(
      "forbidden",
      "Durable sp_routing_maintenance service principal is missing.",
      403
    );
  }
  const decision = authorizeStaged({
    site: "routing.maintenance",
    capability: "routing.maintain",
    resource: { type: "routing" },
    appliedActor: staged.actor,
    shadowActor: staged.shadowActor,
    shadowMissing: staged.shadowMissing,
  });
  if (!decision.allowed) {
    throw new ApiError(
      "forbidden",
      `routing.maintain denied (${decision.reasonCode}).`,
      403
    );
  }
  return staged.actor;
}

export interface MaintenanceInput {
  records?: RetentionRecord[];
  rollingByCohort?: Record<string, RollingDecision[]>;
  now?: Date;
}

export async function runRoutingMaintenance(
  input: MaintenanceInput = {}
): Promise<{
  actorId: string;
  enabled: boolean;
  retention: ReturnType<typeof applyRetentionPlan>;
  demotions: ReturnType<typeof demoteBreachedCohorts>;
  preservedFinalLinks: boolean;
  preservedAudit: boolean;
}> {
  const actor = await requireRoutingMaintenance();
  const config = loadRolloutConfig();
  if (!maintenanceEnabled()) {
    return {
      actorId: actor.id,
      enabled: false,
      retention: {
        expiredProvisional: 0,
        expiredProposalDetail: 0,
        preservedFinalLinks: 0,
        preservedAudit: 0,
        retained: 0,
        items: [],
      },
      demotions: demoteBreachedCohorts(listPilotDescriptors(), {}, config),
      preservedFinalLinks: true,
      preservedAudit: true,
    };
  }

  const records = input.records ?? [];
  const plan = planRetentionActions(records, input.now ?? new Date(), config);
  const retention = applyRetentionPlan(plan);
  const demotions = demoteBreachedCohorts(
    listPilotDescriptors(),
    input.rollingByCohort ?? {},
    config
  );

  return {
    actorId: actor.id,
    enabled: true,
    retention,
    demotions,
    preservedFinalLinks: config.maintenance.preserveFinalLinks,
    preservedAudit: config.maintenance.preserveAudit,
  };
}

export const GET = route(async (req) => {
  if (!cronConfigured()) {
    throw new ApiError(
      "cron_disabled",
      "Scheduled routing maintenance is not configured (CRON_SECRET unset).",
      503
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret()}`) {
    throw new ApiError("unauthorized", "Invalid or missing cron authorization.", 401);
  }

  // Optional JSON body is not used on GET; maintenance runs with empty
  // in-memory record set unless a future durable store is wired. Demotion
  // evaluation still runs against pilot descriptors + any rolling window
  // supplied via query is intentionally unsupported (fail closed / no
  // caller-supplied metrics).
  const result = await runRoutingMaintenance();
  console.log(
    `[routing] maintenance ok — actor=${result.actorId} expiredProvisional=${result.retention.expiredProvisional} expiredDetail=${result.retention.expiredProposalDetail} demoted=${result.demotions.filter((d) => d.demoted).length}`
  );
  return result;
});
