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

export type BrainAskSearchResult = {
  query: string;
  hits: BrainAskHit[];
  configured: boolean;
};

export type BrainAskOpenResult = {
  article: KnowledgeArticle | null;
  configured: boolean;
};
