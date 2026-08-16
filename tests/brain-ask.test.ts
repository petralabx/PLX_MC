import { describe, expect, it } from "vitest";

import { asArticle, asHit, pickMarkdown, pickSnippet } from "@/lib/brain-ask";
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
