// Shared session + CSRF + kill-switch guards for Routing Inbox session APIs.

import { ApiError } from "@/lib/api/route";
import { routingInboxEnabled } from "@/components/mc/routing-inbox/flag";
import {
  requireSessionActor,
  type AuthorizedActor,
} from "@/lib/routing";
import type { Capability, PermissionContext, PermissionResource } from "@/lib/permissions";

export function assertRoutingInboxEnabled(): void {
  if (!routingInboxEnabled()) {
    throw new ApiError(
      "routing_inbox_disabled",
      "Routing Inbox is disabled (PLX_MC_ROUTING_INBOX_ENABLED != 1).",
      503
    );
  }
}

/**
 * Same-origin / CSRF gate for mutating session APIs.
 * Accepts Sec-Fetch-Site same-origin|none, or Origin/Referer matching Host.
 * Never trusts a caller-supplied actor field.
 */
export function assertSameOriginMutation(req: Request): void {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;

  const site = (req.headers.get("sec-fetch-site") ?? "").toLowerCase();
  if (site === "same-origin" || site === "none") return;
  if (site === "cross-site") {
    throw new ApiError("csrf_rejected", "Cross-site mutation rejected.", 403);
  }

  const host = req.headers.get("host");
  if (!host) {
    throw new ApiError("csrf_rejected", "Missing Host for CSRF check.", 403);
  }

  const origin = req.headers.get("origin");
  if (origin) {
    try {
      const o = new URL(origin);
      if (o.host === host) return;
    } catch {
      /* fall through */
    }
    throw new ApiError("csrf_rejected", "Origin does not match Host.", 403);
  }

  const referer = req.headers.get("referer");
  if (referer) {
    try {
      const r = new URL(referer);
      if (r.host === host) return;
    } catch {
      /* fall through */
    }
    throw new ApiError("csrf_rejected", "Referer does not match Host.", 403);
  }

  throw new ApiError(
    "csrf_rejected",
    "Mutating request requires same-origin (Sec-Fetch-Site, Origin, or Referer).",
    403
  );
}

export async function requireInboxActor(
  capability: Capability,
  resource?: PermissionResource,
  context?: PermissionContext
): Promise<AuthorizedActor> {
  assertRoutingInboxEnabled();
  return requireSessionActor(capability, resource, context);
}
