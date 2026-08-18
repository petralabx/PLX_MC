export type KnowledgeArticleSource = "seed" | "brain" | "vmc";

/** Portal KH-M-002 article-open DTO. Search hits stay snippet-sized. */
export type KnowledgeArticle = {
  id: string;
  title: string;
  markdown: string;
  tags?: string[];
  project?: string;
  domain?: string;
  namespace: string;
  trustTier: string;
  source: KnowledgeArticleSource;
  versionLabel?: string;
  href?: string;
};

export type BrainAskHit = {
  id: string;
  title: string;
  snippet: string;
  score?: number;
  namespace?: string;
  source: KnowledgeArticleSource;
};

/** Why Ask returned an empty list or a missing article. Zero hits with `ok` is success. */
export type BrainAskUpstreamStatus =
  | "not_configured"
  | "ok"
  | "upstream_unreachable"
  | "upstream_error";

export type BrainAskSearchResult = {
  query: string;
  hits: BrainAskHit[];
  configured: boolean;
  status: BrainAskUpstreamStatus;
};

export type BrainAskOpenResult = {
  article: KnowledgeArticle | null;
  configured: boolean;
  status: BrainAskUpstreamStatus;
};

/** Live VMC search probe for mc_self_check. HTTP status only — never hits or snippets. */
export type BrainAskSearchProbe = {
  configured: boolean;
  ok: boolean;
  status: number;
};
