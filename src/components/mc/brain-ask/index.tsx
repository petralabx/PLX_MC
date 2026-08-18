"use client";

import { FormEvent, useEffect, useState } from "react";

import { ApiClientError, api } from "@/lib/api";
import {
  openStatusMessage,
  searchStatusMessage,
  type BrainAskHit,
  type BrainAskOpenResult,
  type BrainAskSearchResult,
  type KnowledgeArticle,
} from "@/lib/brain-ask";

import type { ScreenProps } from "../route";

import "./brain-ask.css";

export function BrainAskView({ route, nav }: ScreenProps) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<BrainAskHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [article, setArticle] = useState<KnowledgeArticle | null>(null);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  useEffect(() => {
    const nodeId = route.node?.trim();
    if (!nodeId) return;
    void openHit(nodeId);
    // Deep-link open only; search list stays as last query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.node]);

  async function runSearch(event: FormEvent) {
    event.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    setOpenError(null);
    try {
      const result = await api<BrainAskSearchResult>(
        `/brain-ask/search?q=${encodeURIComponent(q)}`,
      );
      setHits(result.hits);
      setSearchError(searchStatusMessage(result));
    } catch (error) {
      setHits([]);
      setSearchError(error instanceof ApiClientError ? error.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  }

  async function openHit(id: string) {
    setOpening(true);
    setOpenError(null);
    nav("brain-ask", { node: id });
    try {
      const result = await api<BrainAskOpenResult>(
        `/brain-ask/article?id=${encodeURIComponent(id)}`,
      );
      setArticle(result.article);
      setOpenError(openStatusMessage(result));
    } catch (error) {
      setArticle(null);
      setOpenError(error instanceof ApiClientError ? error.message : "Open failed.");
    } finally {
      setOpening(false);
    }
  }

  return (
    <section className="brain-ask">
      <header className="brain-ask-head">
        <span className="kk">System of record · Ask the Brain</span>
        <h1 className="brain-ask-title">Ask</h1>
        <p className="brain-ask-lead">
          Search stays snippet-sized. Opening a hit loads the full article body.
          Portal Hub how-tos stay on{" "}
          <a href="https://staging.plxcustomer.io/admin/knowledge">
            staging.plxcustomer.io/admin/knowledge
          </a>
          .
        </p>
      </header>

      <form className="brain-ask-form" onSubmit={runSearch}>
        <label className="brain-ask-label" htmlFor="brain-ask-q">
          Query
        </label>
        <div className="brain-ask-row">
          <input
            id="brain-ask-q"
            className="brain-ask-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the company brain"
          />
          <button className="brain-ask-submit" type="submit" disabled={searching}>
            {searching ? "Searching" : "Search"}
          </button>
        </div>
      </form>

      {searchError ? <p className="brain-ask-status">{searchError}</p> : null}

      <div className="brain-ask-split">
        <ol className="brain-ask-hits">
          {hits.map((hit) => (
            <li key={hit.id}>
              <button
                type="button"
                className={hit.id === article?.id || hit.id === route.node ? "is-open" : undefined}
                onClick={() => void openHit(hit.id)}
              >
                <strong>{hit.title}</strong>
                <span className="brain-ask-snippet">{hit.snippet}</span>
              </button>
            </li>
          ))}
        </ol>

        <article className="brain-ask-page">
          {opening ? <p className="brain-ask-status">Opening article…</p> : null}
          {openError ? <p className="brain-ask-status">{openError}</p> : null}
          {article ? (
            <>
              <h2 className="brain-ask-page-title">{article.title}</h2>
              <div className="brain-ask-chips">
                <span>{article.source}</span>
                <span>{article.namespace}</span>
                <span>{article.trustTier}</span>
                {article.versionLabel ? <span>{article.versionLabel}</span> : null}
              </div>
              <div className="brain-ask-body">
                {article.markdown.split(/\n{2,}/).map((block, index) => (
                  <p key={index}>{block}</p>
                ))}
              </div>
            </>
          ) : (
            <p className="brain-ask-status">Select a hit to open the full page.</p>
          )}
        </article>
      </div>
    </section>
  );
}
