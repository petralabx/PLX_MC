// Wave 6 — colleague UX: the sidebar renders the shared nav model as a labelled
// <nav> of real links (open in a new tab / copy URL), with decorative glyphs
// hidden from assistive tech and Admin & health collapsed by default.
// No DOM environment (vitest runs in Node) — rendered with renderToStaticMarkup.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { Sidebar } from "@/components/mc/chrome";
import type { Route } from "@/components/mc/route";
import { resetStore } from "@/lib/mc-data/store";

beforeEach(() => resetStore());

const render = (route: Route) =>
  renderToStaticMarkup(
    createElement(Sidebar, {
      route,
      nav: () => {},
      onNewProject: () => {},
      onNewInitiative: () => {},
    })
  );

describe("Sidebar", () => {
  it("is one labelled <nav> whose groups are labelled by their headings", () => {
    const html = render({ screen: "home" });
    expect(html).toMatch(/^<nav class="mc-side" id="mc-nav" aria-label="Main"/);
    for (const [id, label] of [
      ["my-work", "My work"],
      ["plan", "Plan"],
      ["knowledge", "Knowledge"],
    ]) {
      expect(html).toContain(`role="group" aria-labelledby="mc-nav-h-${id}"`);
      expect(html).toContain(`id="mc-nav-h-${id}">${label}</div>`);
    }
  });

  it("renders items as real links carrying their URL, with the current one marked", () => {
    const html = render({ screen: "board" });
    expect(html).toContain('href="/?screen=board" class="item active" aria-current="page"');
    expect(html).toContain('href="/" class="item"');
    expect(html).toContain('href="/?screen=approvals"');
    expect(html).toContain('href="/?screen=help"');
    // Projects and initiatives are links too, under Plan.
    expect(html).toContain('href="/?screen=project&amp;projectId=');
    expect(html).toContain('href="/?screen=bucket&amp;bucketId=BKT-');
  });

  it("hides decorative glyphs and health ticks from assistive tech", () => {
    const html = render({ screen: "home" });
    expect(html).not.toMatch(/<span class="ic">/);
    expect(html).not.toMatch(/<span class="hl [a-z]+">/);
    expect(html).toContain('<span class="ic" aria-hidden="true">');
  });

  it("names initiatives, never buckets, and keeps New project / New initiative as buttons", () => {
    const html = render({ screen: "home" });
    expect(html).toContain(">Initiatives</div>");
    // No visible text says bucket (hrefs keep the bucketId param).
    expect(html).not.toMatch(/>[^<]*bucket[^<]*</i);
    expect(html).toMatch(/<button type="button" class="item side-new-initiative"[^>]*>.*New project/);
    expect(html).toMatch(/<button type="button" class="item side-new-initiative"[^>]*>.*New initiative/);
  });

  it("collapses Admin & health by default behind a disclosure button", () => {
    const html = render({ screen: "home" });
    expect(html).toContain(
      'id="mc-nav-h-admin" aria-expanded="false" aria-controls="mc-nav-admin"'
    );
    expect(html).toContain('<div id="mc-nav-admin" hidden="">');
    // The items are still in the document (so the disclosure has something to reveal).
    expect(html).toContain("SharePoint sync issues");
  });
});
