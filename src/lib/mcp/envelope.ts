// Standard MCP cursor response envelope — { data, meta } with deep links.

import { randomUUID } from "node:crypto";
import type { McpIdentity } from "./auth";

export interface McpSyncMeta {
  status: "pushed" | "queued" | "conflict" | "synced";
  conflictId?: string;
  link?: string;
}

export interface McpResponseMeta {
  requestId: string;
  ts: string;
  actor: McpIdentity;
  links: {
    mcBase: string;
    task?: string;
    checkoutStamp?: string;
    events?: string;
    conflicts?: string;
  };
  evidence?: Record<string, unknown>;
  audit: { eventSeq?: string; kinds: string[] };
  sync?: McpSyncMeta;
}

export function publicMcBaseUrl(): string {
  return (process.env.PLX_MC_PUBLIC_URL ?? "https://mc.plxcustomer.io").replace(/\/+$/, "");
}

export function taskLink(taskId: string): string {
  return `${publicMcBaseUrl()}/tasks/${encodeURIComponent(taskId)}`;
}

export function buildMeta(
  identity: McpIdentity,
  partial: Partial<Omit<McpResponseMeta, "requestId" | "ts" | "actor">> = {}
): McpResponseMeta {
  const base = publicMcBaseUrl();
  return {
    requestId: randomUUID(),
    ts: new Date().toISOString(),
    actor: identity,
    links: {
      mcBase: base,
      events: `${base}/api/events`,
      ...partial.links,
    },
    audit: partial.audit ?? { kinds: [] },
    evidence: partial.evidence,
    sync: partial.sync,
  };
}

export function wrapMcpResponse<T>(data: T, meta: McpResponseMeta): { data: T; meta: McpResponseMeta } {
  return { data, meta };
}
