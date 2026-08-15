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
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asSource(value: unknown): KnowledgeArticleSource {
  if (value === "seed" || value === "brain" || value === "vmc") return value;
  return "vmc";
}

export function pickSnippet(raw: BrainAskRawNode): string {
  const snippet = asString(raw.snippet) || asString(raw.excerpt) || asString(raw.text);
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
  const id = asString(raw.id);
  if (!id) return null;
  const title = asString(raw.title) || asString(raw.name) || id;
  return {
    id,
    title,
    snippet: pickSnippet(raw) || "Graph node",
    score: typeof raw.score === "number" ? raw.score : undefined,
    namespace: asString(raw.namespace) || undefined,
    source: asSource(raw.source),
  };
}

export function asArticle(raw: BrainAskRawNode): KnowledgeArticle | null {
  const id = asString(raw.id);
  if (!id) return null;
  const markdown = pickMarkdown(raw);
  if (!markdown) return null;
  const tags = Array.isArray(raw.tags)
    ? raw.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
    : undefined;
  return {
    id,
    title: asString(raw.title) || asString(raw.name) || id,
    markdown,
    tags: tags && tags.length > 0 ? tags : undefined,
    project: asString(raw.project) || undefined,
    domain: asString(raw.domain) || undefined,
    namespace: asString(raw.namespace) || "company/",
    trustTier: asString(raw.trustTier) || "advisory",
    source: asSource(raw.source),
    versionLabel: asString(raw.versionLabel) || undefined,
    href: asString(raw.url) || asString(raw.href) || undefined,
  };
}

export function extractNodes(payload: unknown): BrainAskRawNode[] {
  if (!payload || typeof payload !== "object") return [];
  const body = payload as Record<string, unknown>;
  const bags = [body.items, body.hits, body.results, body.nodes, body.data];
  for (const bag of bags) {
    if (Array.isArray(bag)) return bag as BrainAskRawNode[];
  }
  if (body.data && typeof body.data === "object" && !Array.isArray(body.data)) {
    const nested = body.data as Record<string, unknown>;
    if (typeof nested.id === "string") return [nested];
  }
  if (typeof body.id === "string") return [body];
  return [];
}
