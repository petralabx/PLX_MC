// Server-only (pulls `pg` through the compliance repo). TASK-3008 shadow
// rollout: where the operator-email rule and the principal-only rule disagree
// on an MCP decision, record one authz.shadow_mismatch event in mc_events.
// Unlike the permissions decision log this is not gated on the enforcement
// mode, so the disagreement log exists before PLX_MC_MCP_PRINCIPAL_AUTHZ is
// flipped. Fail-open: a sink failure never changes the decision.

import { appendEvent } from "@/lib/compliance/repo";

export interface ShadowMismatch {
  /** Call site, e.g. "mcp.release-checkout" or "permissions.project-acl". */
  site: string;
  mode: "shadow" | "enforce";
  /** Audit actor, `runtime:operatorEmail` or the principal id. */
  actor: string;
  repo?: string | null;
  taskId?: string | null;
  operatorAllowed: boolean;
  principalAllowed: boolean;
  [detail: string]: unknown;
}

export async function recordShadowMismatch(entry: ShadowMismatch): Promise<void> {
  const { actor, repo, taskId, ...payload } = entry;
  try {
    await appendEvent({
      kind: "authz.shadow_mismatch",
      actor,
      repo: repo ?? null,
      taskId: taskId ?? null,
      payload,
    });
  } catch (err) {
    console.error(
      "[permissions] could not record authz.shadow_mismatch at %s: %s",
      entry.site,
      err instanceof Error ? err.message : String(err)
    );
  }
}
