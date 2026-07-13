// Microsoft Graph client for the sync engine (TS sibling of the client in
// scripts/provision-sharepoint.py): client-credentials token with caching,
// JSON fetch helpers, and site/list id resolution for the configured site.

import { graphCredentials } from "@/lib/secrets";

const GRAPH = "https://graph.microsoft.com/v1.0";
const SITE_HOSTNAME = "petrasoap.sharepoint.com";

// Production SoR is the default (provisioned 2026-07-13). Override for the
// staging sandbox with PLX_MC_SHAREPOINT_SITE_PATH=/sites/plx-mission-control-dev.
export function sitePath(): string {
  return process.env.PLX_MC_SHAREPOINT_SITE_PATH ?? "/sites/plx-mission-control";
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
    signal: AbortSignal.timeout(30_000),
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
    // Never let a sweep hang on a stalled socket (same failure class as the
    // DB pool timeouts in src/lib/db).
    signal: AbortSignal.timeout(60_000),
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

// Optional lists resolved only when provisioned (a missing one must NOT block
// the core sweep). Push-only mirrors: Repo Registry (EN-002), Projects (P2).
export const REPO_REGISTRY_DISPLAY = "Repo Registry";
export const REPO_REGISTRY_KEY = "reporegistry";
export const PROJECTS_DISPLAY = "Projects";
export const PROJECTS_KEY = "projects";
export const ROADMAP_KEY = "roadmap";

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
  // Optional lists: resolved when present, never required (a missing one can't
  // block the core sweep). Push-only mirrors: Repo Registry (Item 2), Projects (P2).
  const repoRegistry = byName.get(REPO_REGISTRY_DISPLAY);
  if (repoRegistry) listIds[REPO_REGISTRY_KEY] = repoRegistry;
  const projects = byName.get(PROJECTS_DISPLAY);
  if (projects) listIds[PROJECTS_KEY] = projects;
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

// ─── Site-user resolution for Person columns ─────────────────────────────────

// SharePoint Person columns store a user's id in the site's hidden User
// Information List (UIL), written as `<Column>LookupId` — not an email. We read
// the UIL once per site and cache both directions. App-only client-credentials
// CANNOT call `_api/web/ensureUser` ("Unsupported app only token"), so a user
// not already present in the UIL resolves to null; the engine then skips that
// person column and records an honest audit note (never fabricates a person).
interface UilCache {
  byEmail: Map<string, number>;
  byId: Map<number, string>;
}
interface UilItemsPage {
  value: { id: string; fields?: Record<string, unknown> }[];
  "@odata.nextLink"?: string;
}
const uilCacheBySite = new Map<string, UilCache>();

async function loadUil(ctx: SiteContext): Promise<UilCache> {
  const cached = uilCacheBySite.get(ctx.siteId);
  if (cached) return cached;
  const cache: UilCache = { byEmail: new Map(), byId: new Map() };
  // The UIL is addressable by its (hidden) display name.
  const list = await graphFetch<{ id: string }>(
    `/sites/${ctx.siteId}/lists/User%20Information%20List?$select=id`
  );
  let url: string | undefined =
    `/sites/${ctx.siteId}/lists/${list.id}/items?$expand=fields($select=EMail,UserName)&$select=id&$top=200`;
  while (url) {
    const page: UilItemsPage = await graphFetch<UilItemsPage>(url);
    for (const item of page.value) {
      const id = Number(item.id);
      const email = String(item.fields?.EMail ?? item.fields?.UserName ?? "").toLowerCase();
      if (!Number.isNaN(id) && email) {
        cache.byEmail.set(email, id);
        cache.byId.set(id, email);
      }
    }
    url = page["@odata.nextLink"];
  }
  uilCacheBySite.set(ctx.siteId, cache);
  return cache;
}

// email → site-user lookup id (null when the user is not yet in the UIL).
export async function resolveSiteUserLookupId(ctx: SiteContext, email: string): Promise<number | null> {
  const cache = await loadUil(ctx);
  return cache.byEmail.get(email.toLowerCase()) ?? null;
}

// lookup id → email (inbound assignee mirroring).
export async function resolveEmailByLookupId(ctx: SiteContext, lookupId: number): Promise<string | null> {
  const cache = await loadUil(ctx);
  return cache.byId.get(lookupId) ?? null;
}

// Test/ops seam: drop the UIL cache (the sweep process is long-lived).
export function clearUilCache(): void {
  uilCacheBySite.clear();
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
