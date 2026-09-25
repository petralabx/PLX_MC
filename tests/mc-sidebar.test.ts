// Wave 6 — colleague UX: the sidebar renders the shared nav model as a labelled
// <nav> of real links (open in a new tab / copy URL), with decorative icons
// hidden from assistive tech and Admin & health collapsed by default. ADR-005:
// the icons are Lucide and the badges speak the honest count vocabulary.
// No DOM environment (vitest runs in Node) — rendered with renderToStaticMarkup.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { Sidebar, type NavCounts } from "@/components/mc/chrome";
import type { Route } from "@/components/mc/route";
import { resetStore } from "@/lib/mc-data/store";

beforeEach(() => resetStore());

const render = (route: Route, counts: NavCounts = {}) =>
  renderToStaticMarkup(
    createElement(Sidebar, {
      route,
      nav: () => {},
      counts,
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

  it("hides decorative icons and health ticks from assistive tech", () => {
    const html = render({ screen: "home" });
    const svgs = html.match(/<svg[^>]*>/g) ?? [];
    expect(svgs.length).toBeGreaterThan(20); // one Lucide icon per nav item, plus controls
    for (const svg of svgs) expect(svg).toContain('aria-hidden="true"');
    expect(html).not.toMatch(/<span class="hl [a-z]+">/);
  });

  it("speaks honest counts: exact, a lower bound, unknown — and hides a confirmed zero", () => {
    const html = render(
      { screen: "home" },
      {
        needs: { n: 3, exact: false },
        approvals: { n: null, exact: false },
        agents: { n: 0, exact: true, unit: "live" },
        sync: { n: 2, exact: true, tone: "warn" },
      }
    );
    expect(html).toContain('<span class="badge unk"><span aria-hidden="true">3+</span><span class="vh">, at least 3</span></span>');
    expect(html).toContain('<span class="badge unk"><span aria-hidden="true">—</span><span class="vh">, count loading</span></span>');
    expect(html).toContain('<span class="badge warn"><span aria-hidden="true">2</span><span class="vh">, 2</span></span>');
    expect(html).not.toContain("0 live");
    expect(html).not.toMatch(/aria-hidden="true">0</);
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
    expect(html).toContain('<div id="mc-nav-admin" class="grp-body" hidden="">');
    // The items are still in the document (so the disclosure has something to reveal).
    expect(html).toContain("SharePoint sync issues");
  });
});
