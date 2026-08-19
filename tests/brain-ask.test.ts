import { afterEach, describe, expect, it, vi } from "vitest";

import {
  asArticle,
  asHit,
  extractNodes,
  openBrainAskArticle,
  openStatusMessage,
  pickMarkdown,
  pickSnippet,
  probeBrainAskSearch,
  searchBrainAsk,
  searchStatusMessage,
} from "@/lib/brain-ask";
import { SCREEN_VALUES, routeToUrl, urlToRoute } from "@/components/mc/route";
import { SCREENS } from "@/components/mc/screens";

describe("brain ask DTO mapping", () => {
  it("keeps search hits snippet-sized and never uses content as the list body", () => {
    const hit = asHit({
      id: "node-1",
      title: "Lot hold",
      snippet: "Short excerpt",
      content: "A".repeat(4000),
      namespace: "company/",
    });
    expect(hit?.snippet).toBe("Short excerpt");
    expect(hit?.snippet.length).toBeLessThanOrEqual(280);
    expect(pickSnippet({ snippet: "x".repeat(400), content: "full" }).length).toBe(280);
  });

  it("opens full markdown and refuses snippet-only payloads", () => {
    const article = asArticle({
      id: "node-1",
      title: "Lot hold",
      markdown: "# Lot hold\n\nFull body from include=content.",
      namespace: "company/",
      trustTier: "advisory",
      source: "vmc",
      versionLabel: "graph",
    });
    expect(article?.markdown).toContain("Full body from include=content");
    expect(article?.source).toBe("vmc");
    expect(article?.namespace).toBe("company/");
    expect(article?.trustTier).toBe("advisory");
    expect(asArticle({ id: "node-2", snippet: "only a search excerpt" })).toBeNull();
    expect(pickMarkdown({ snippet: "excerpt only" })).toBe("");
  });

  it("maps the live VMC agent-search envelope (data.results + nested item)", () => {
    const envelope = {
      data: {
        query: "architecture",
        source: "memory+documents",
        mode: "hybrid",
        total: 1,
        partial: false,
        memoryDegraded: false,
        documentsDegraded: false,
        results: [
          {
            id: "document:repo-plx-mc-architecture",
            kind: "document",
            score: 0.82,
            rawScore: 12,
            item: {
              title: "PLX_MC architecture source-map",
              description: "C4 catalog and generated consumers of Git authority.",
            },
            sourcePath: "docs/architecture/source-map.json",
            projectSlug: "plx-mc",
          },
        ],
      },
    };
    const nodes = extractNodes(envelope);
    expect(nodes).toHaveLength(1);
    const hit = asHit(nodes[0]);
    expect(hit).toEqual({
      id: "document:repo-plx-mc-architecture",
      title: "PLX_MC architecture source-map",
      snippet: "C4 catalog and generated consumers of Git authority.",
      score: 0.82,
      source: "vmc",
    });
  });
});

describe("brain-ask screen", () => {
  it("registers the Ask screen and deep-links a node", () => {
    expect(SCREEN_VALUES).toContain("brain-ask");
    expect(SCREENS["brain-ask"]).toBeTypeOf("function");
    expect(routeToUrl({ screen: "brain-ask", node: "node-1" })).toBe(
      "/?screen=brain-ask&node=node-1",
    );
    expect(urlToRoute("/?screen=brain-ask&node=node-1")).toEqual({
      screen: "brain-ask",
      node: "node-1",
    });
  });
});

describe("brain ask credentials", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fail-opens empty search when VMC_API_KEY is unset", async () => {
    vi.stubEnv("VMC_API_KEY", "");
    const result = await searchBrainAsk("portal interoperability");
    expect(result.configured).toBe(false);
    expect(result.status).toBe("not_configured");
    expect(result.hits).toEqual([]);
    expect(searchStatusMessage(result)).toMatch(/VMC_API_KEY/);
    expect(searchStatusMessage(result)).not.toMatch(/still works/i);
  });

  it("labels a fetch throw as unreachable, not as zero hits", async () => {
    vi.stubEnv("VMC_API_KEY", "test-vmc-key");
    vi.stubEnv("VMC_BASE_URL", "https://vmc.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const result = await searchBrainAsk("portal interoperability");
    expect(result.configured).toBe(true);
    expect(result.status).toBe("upstream_unreachable");
    expect(result.hits).toEqual([]);
    expect(searchStatusMessage(result)).toMatch(/unreachable/i);
  });

  it("labels a VMC 5xx as upstream_error, not as zero hits", async () => {
    vi.stubEnv("VMC_API_KEY", "test-vmc-key");
    vi.stubEnv("VMC_BASE_URL", "https://vmc.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        status: 503,
        json: async () => null,
      })),
    );
    const result = await searchBrainAsk("portal interoperability");
    expect(result.configured).toBe(true);
    expect(result.status).toBe("upstream_error");
    expect(result.hits).toEqual([]);
    expect(searchStatusMessage(result)).toMatch(/returned an error/i);
  });

  it("maps HTTP 200 live VMC data.results into hits, not an empty ok list", async () => {
    vi.stubEnv("VMC_API_KEY", "test-vmc-key");
    vi.stubEnv("VMC_BASE_URL", "https://vmc.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        status: 200,
        json: async () => ({
          data: {
            query: "architecture",
            results: [
              {
                id: "document:repo-plx-mc-architecture",
                score: 0.82,
                item: {
                  title: "PLX_MC architecture source-map",
                  description: "C4 catalog and generated consumers of Git authority.",
                },
              },
            ],
          },
        }),
      })),
    );
    const result = await searchBrainAsk("architecture");
    expect(result.status).toBe("ok");
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]?.title).toBe("PLX_MC architecture source-map");
    expect(result.hits[0]?.snippet).toMatch(/C4 catalog/);
  });

  it("treats HTTP 200 with an empty list as ok zero hits", async () => {
    vi.stubEnv("VMC_API_KEY", "test-vmc-key");
    vi.stubEnv("VMC_BASE_URL", "https://vmc.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        status: 200,
        json: async () => ({ hits: [] }),
      })),
    );
    const result = await searchBrainAsk("no such node");
    expect(result.configured).toBe(true);
    expect(result.status).toBe("ok");
    expect(result.hits).toEqual([]);
    expect(searchStatusMessage(result)).toBe("No hits for this query.");
  });

  it("probe reports HTTP status only and never forwards hits", async () => {
    vi.stubEnv("VMC_API_KEY", "test-vmc-key");
    vi.stubEnv("VMC_BASE_URL", "https://vmc.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        status: 200,
        json: async () => ({
          hits: [{ id: "secret-node", snippet: "must not leak" }],
        }),
      })),
    );
    const probe = await probeBrainAskSearch();
    expect(probe).toEqual({ configured: true, ok: true, status: 200 });
    expect(probe).not.toHaveProperty("hits");
    expect(JSON.stringify(probe)).not.toContain("must not leak");
  });

  it("opens document: catalog ids via /agent/document, not /agent/node", async () => {
    vi.stubEnv("VMC_API_KEY", "test-vmc-key");
    vi.stubEnv("VMC_BASE_URL", "https://vmc.test");
    const fetchMock = vi.fn(async (url: string) => {
      const href = String(url);
      if (href.includes("/agent/document/")) {
        return {
          status: 200,
          json: async () => ({
            data: {
              id: "document:repo-docs/modules/royale/ARCHITECTURE.md",
              title: "ARCHITECTURE",
              markdown: "# ARCHITECTURE\n\nEnd-to-end data flow.",
              source: "vmc",
            },
          }),
        };
      }
      return { status: 404, json: async () => null };
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await openBrainAskArticle(
      "document:repo-docs/modules/royale/ARCHITECTURE.md",
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/agent/document/");
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("/agent/node/");
    expect(result.status).toBe("ok");
    expect(result.article?.title).toBe("ARCHITECTURE");
    expect(result.article?.markdown).toContain("End-to-end data flow");
  });

  it("still opens graph node ids via /agent/node?include=content", async () => {
    vi.stubEnv("VMC_API_KEY", "test-vmc-key");
    vi.stubEnv("VMC_BASE_URL", "https://vmc.test");
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain("/agent/node/");
      expect(url).toContain("include=content");
      return {
        status: 200,
        json: async () => ({
          data: {
            id: "node-1",
            title: "Lot hold",
            markdown: "# Lot hold\n\nGraph body.",
          },
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await openBrainAskArticle("graph:node-1");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.article?.markdown).toContain("Graph body");
  });

  it("labels a document open 404 as upstream_error, not as an empty ok article", async () => {
    vi.stubEnv("VMC_API_KEY", "test-vmc-key");
    vi.stubEnv("VMC_BASE_URL", "https://vmc.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ status: 404, json: async () => null })),
    );
    const result = await openBrainAskArticle(
      "document:repo-docs/modules/royale/ARCHITECTURE.md",
    );
    expect(result.article).toBeNull();
    expect(result.status).toBe("upstream_error");
    expect(openStatusMessage(result)).toMatch(/failed to load/i);
  });

  it("open copy names not-found only when VMC answered ok", () => {
    expect(
      openStatusMessage({ article: null, configured: true, status: "ok" }),
    ).toMatch(/not found/i);
    expect(
      openStatusMessage({
        article: null,
        configured: true,
        status: "upstream_unreachable",
      }),
    ).toMatch(/unreachable/i);
  });
});
