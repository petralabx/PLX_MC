import type {
  BrainAskHit,
  KnowledgeArticle,
  KnowledgeArticleSource,
} from "./types";

const SNIPPET_MAX = 280;

export type BrainAskRawNode = {
  id?: unknown;
  title?: unknown;
  name?: unknown;
  text?: unknown;
  snippet?: unknown;
  excerpt?: unknown;
  description?: unknown;
  content?: unknown;
  markdown?: unknown;
  body?: unknown;
  namespace?: unknown;
  url?: unknown;
  href?: unknown;
  score?: unknown;
  tags?: unknown;
  project?: unknown;
  domain?: unknown;
  trustTier?: unknown;
  versionLabel?: unknown;
  source?: unknown;
  item?: unknown;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asSource(value: unknown): KnowledgeArticleSource {
  if (value === "seed" || value === "brain" || value === "vmc") return value;
  return "vmc";
}

function flattenItem(raw: BrainAskRawNode): BrainAskRawNode {
  if (!raw.item || typeof raw.item !== "object" || Array.isArray(raw.item)) {
    return raw;
  }
  const item = raw.item as Record<string, unknown>;
  return {
    ...raw,
    title: raw.title ?? item.title,
    name: raw.name ?? item.name,
    snippet: raw.snippet ?? item.snippet ?? item.description,
    excerpt: raw.excerpt ?? item.excerpt,
    description: raw.description ?? item.description,
    text: raw.text ?? item.text,
    content: raw.content ?? item.content,
    markdown: raw.markdown ?? item.markdown,
    body: raw.body ?? item.body,
    namespace: raw.namespace ?? item.namespace,
    url: raw.url ?? item.url,
    href: raw.href ?? item.href,
    tags: raw.tags ?? item.tags,
    project: raw.project ?? item.project ?? item.projectSlug,
    domain: raw.domain ?? item.domain,
    trustTier: raw.trustTier ?? item.trustTier,
    versionLabel: raw.versionLabel ?? item.versionLabel,
    source: raw.source ?? item.source,
  };
}

export function pickSnippet(raw: BrainAskRawNode): string {
  const snippet =
    asString(raw.snippet) ||
    asString(raw.excerpt) ||
    asString(raw.description) ||
    asString(raw.text);
  return snippet.slice(0, SNIPPET_MAX);
}

export function pickMarkdown(raw: BrainAskRawNode): string {
  const candidates = [raw.markdown, raw.content, raw.body, raw.text];
  for (const value of candidates) {
    const text = asString(value);
    if (text) return text;
  }
  return "";
}

export function asHit(raw: BrainAskRawNode): BrainAskHit | null {
  const node = flattenItem(raw);
  const id = asString(node.id);
  if (!id) return null;
  const title = asString(node.title) || asString(node.name) || id;
  return {
    id,
    title,
    snippet: pickSnippet(node) || "Graph node",
    score: typeof node.score === "number" ? node.score : undefined,
    namespace: asString(node.namespace) || undefined,
    source: asSource(node.source),
  };
}

export function asArticle(raw: BrainAskRawNode): KnowledgeArticle | null {
  const node = flattenItem(raw);
  const id = asString(node.id);
  if (!id) return null;
  const markdown = pickMarkdown(node);
  if (!markdown) return null;
  const tags = Array.isArray(node.tags)
    ? node.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
    : undefined;
  return {
    id,
    title: asString(node.title) || asString(node.name) || id,
    markdown,
    tags: tags && tags.length > 0 ? tags : undefined,
    project: asString(node.project) || undefined,
    domain: asString(node.domain) || undefined,
    namespace: asString(node.namespace) || "company/",
    trustTier: asString(node.trustTier) || "advisory",
    source: asSource(node.source),
    versionLabel: asString(node.versionLabel) || undefined,
    href: asString(node.url) || asString(node.href) || undefined,
  };
}

function nodesFromBags(record: Record<string, unknown>): BrainAskRawNode[] | null {
  for (const key of ["items", "hits", "results", "nodes"] as const) {
    const bag = record[key];
    if (Array.isArray(bag)) return bag as BrainAskRawNode[];
  }
  return null;
}

export function extractNodes(payload: unknown): BrainAskRawNode[] {
  if (!payload || typeof payload !== "object") return [];
  const body = payload as Record<string, unknown>;
  const top = nodesFromBags(body);
  if (top) return top;
  if (Array.isArray(body.data)) return body.data as BrainAskRawNode[];
  if (body.data && typeof body.data === "object") {
    const nested = body.data as Record<string, unknown>;
    const inner = nodesFromBags(nested);
    if (inner) return inner;
    if (typeof nested.id === "string") return [nested];
  }
  if (typeof body.id === "string") return [body];
  return [];
}
