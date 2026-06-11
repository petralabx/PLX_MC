// Microsoft Graph client for the sync engine (TS sibling of the client in
// scripts/provision-sharepoint.py): client-credentials token with caching,
// JSON fetch helpers, and site/list id resolution for the configured site.

import { graphCredentials } from "@/lib/secrets";

const GRAPH = "https://graph.microsoft.com/v1.0";
const SITE_HOSTNAME = "petrasoap.sharepoint.com";

// Staging until the production site is provisioned; overridable per env.
export function sitePath(): string {
  return process.env.PLX_MC_SHAREPOINT_SITE_PATH ?? "/sites/plx-mission-control-dev";
}

export class GraphError extends Error {
  constructor(
    public status: number,
    public body: string,
    url: string
  ) {
    super(`graph ${status} on ${url}: ${body.slice(0, 300)}`);
  }
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.token;
  const { tenantId, clientId, clientSecret } = graphCredentials();
  const resp = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!resp.ok) throw new GraphError(resp.status, await resp.text(), "token endpoint");
  const json = (await resp.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cachedToken.token;
}

// `url` may be a Graph-relative path ("/sites/...") or an absolute URL
// (delta nextLink/deltaLink come back absolute).
export async function graphFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const absolute = url.startsWith("https://") ? url : `${GRAPH}${url}`;
  const token = await getToken();
  const resp = await fetch(absolute, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  if (!resp.ok) throw new GraphError(resp.status, await resp.text(), absolute);
  if (resp.status === 204) return undefined as T;
  return (await resp.json()) as T;
}

// ─── Site + list resolution ──────────────────────────────────────────────────

// Keys ↔ display names per config/sharepoint-schema.json (kept aligned).
export const LIST_DISPLAY_NAMES: Record<string, string> = {
  roadmap: "Roadmap",
  todos: "ToDos",
  milestones: "Milestone Register",
  risks: "Risk Register",
  documents: "Project Documents",
};

export interface SiteContext {
  siteId: string;
  listIds: Record<string, string>;
}

let cachedSite: SiteContext | null = null;

export async function siteContext(): Promise<SiteContext> {
  if (cachedSite) return cachedSite;
  const site = await graphFetch<{ id: string }>(`/sites/${SITE_HOSTNAME}:${sitePath()}`);
  const lists = await graphFetch<{ value: { id: string; displayName: string }[] }>(
    `/sites/${site.id}/lists?$select=id,displayName&$top=200`
  );
  const byName = new Map(lists.value.map((l) => [l.displayName, l.id]));
  const listIds: Record<string, string> = {};
  for (const [key, displayName] of Object.entries(LIST_DISPLAY_NAMES)) {
    const id = byName.get(displayName);
    if (!id) throw new Error(`list "${displayName}" not found on ${sitePath()} — run the provisioner`);
    listIds[key] = id;
  }
  cachedSite = { siteId: site.id, listIds };
  return cachedSite;
}

// ─── List item operations used by the engine ─────────────────────────────────

export interface SpListItem {
  id: string;
  fields?: Record<string, unknown>;
  deleted?: { state: string };
}

export async function createListItem(
  ctx: SiteContext,
  listKey: string,
  fields: Record<string, unknown>
): Promise<string> {
  const created = await graphFetch<{ id: string }>(
    `/sites/${ctx.siteId}/lists/${ctx.listIds[listKey]}/items`,
    { method: "POST", body: JSON.stringify({ fields }) }
  );
  return created.id;
}

export async function patchListItemFields(
  ctx: SiteContext,
  listKey: string,
  itemId: string,
  fields: Record<string, unknown>
): Promise<void> {
  await graphFetch(`/sites/${ctx.siteId}/lists/${ctx.listIds[listKey]}/items/${itemId}/fields`, {
    method: "PATCH",
    body: JSON.stringify(fields),
  });
}

export async function findItemByField(
  ctx: SiteContext,
  listKey: string,
  fieldName: string,
  value: string
): Promise<SpListItem | null> {
  const escaped = value.replaceAll("'", "''");
  const result = await graphFetch<{ value: SpListItem[] }>(
    `/sites/${ctx.siteId}/lists/${ctx.listIds[listKey]}/items?` +
      `$expand=fields&$filter=fields/${fieldName} eq '${escaped}'`
  );
  return result.value[0] ?? null;
}

// Walk a delta query to completion: returns every changed item plus the next
// deltaLink to persist (SHAREPOINT_INTEGRATION.md §6 inbound).
export async function listDelta(
  ctx: SiteContext,
  listKey: string,
  storedDeltaLink: string | null
): Promise<{ items: SpListItem[]; deltaLink: string }> {
  let url =
    storedDeltaLink ??
    `/sites/${ctx.siteId}/lists/${ctx.listIds[listKey]}/items/delta?expand=fields`;
  const items: SpListItem[] = [];
  for (;;) {
    const page = await graphFetch<{
      value: SpListItem[];
      "@odata.nextLink"?: string;
      "@odata.deltaLink"?: string;
    }>(url);
    items.push(...page.value);
    if (page["@odata.deltaLink"]) return { items, deltaLink: page["@odata.deltaLink"] };
    if (!page["@odata.nextLink"]) throw new Error(`delta walk for ${listKey} ended without a deltaLink`);
    url = page["@odata.nextLink"];
  }
}
