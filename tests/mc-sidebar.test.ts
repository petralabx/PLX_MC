// Wave 6 — colleague UX: the sidebar renders the shared nav model as a labelled
// <nav> of real links (open in a new tab / copy URL), with decorative icons
// hidden from assistive tech and Admin & health collapsed by default. ADR-005:
// the icons are Lucide and the badges speak the honest count vocabulary.
// No DOM environment (vitest runs in Node) — rendered with renderToStaticMarkup.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { Sidebar, useNavCounts, type NavCounts } from "@/components/mc/chrome";
import { CountBadge } from "@/components/mc/count-badge";
import type { Route } from "@/components/mc/route";
import {
  __setStateLoaderForTests,
  allTasks,
  dataSource,
  hydrate,
  openConflicts,
  openErrors,
  resetStore,
} from "@/lib/mc-data/store";

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
    expect(html).toContain('<span class="badge unk"><span aria-hidden="true">—</span><span class="vh">, count unknown</span></span>');
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

// Review round 1: counts computed from cached or demo data (store offline) are
// not confirmed — they read "—", never a hidden "confirmed" zero.
describe("useNavCounts", () => {
  const Probe = () => createElement("pre", null, JSON.stringify(useNavCounts()));
  const counts = () => JSON.parse(renderToStaticMarkup(createElement(Probe)).replace(/^<pre>|<\/pre>$/g, "").replace(/&quot;/g, '"')) as NavCounts;

  it("is unknown while the store is on seed data or offline", async () => {
    expect(counts().approvals).toEqual({ n: null, exact: false });
    __setStateLoaderForTests(async () => {
      throw new Error("HTTP 500");
    });
    await hydrate();
    expect(dataSource()).toBe("offline");
    const offline = counts();
    expect(offline.approvals).toEqual({ n: null, exact: false });
    expect(offline.agents).toEqual({ n: null, exact: false });
    expect(offline.needs).toEqual({ n: null, exact: false });
    expect(offline.sync).toBeUndefined();
  });
});

// Review round 2: a lower bound of zero says nothing — it reads "—", not "0+".
describe("CountBadge", () => {
  const badge = (n: number | null, exact: boolean) => renderToStaticMarkup(createElement(CountBadge, { count: { n, exact } }));
  it("renders a partial zero as unknown, and hides only a confirmed zero", () => {
    expect(badge(0, false)).toContain('<span aria-hidden="true">—</span>');
    expect(badge(0, false)).toContain("count unknown");
    expect(badge(0, true)).toBe("");
    expect(badge(4, false)).toContain('<span aria-hidden="true">4+</span>');
  });
});

describe("useNavCounts once the store is live", () => {
  const Probe = () => createElement("pre", null, JSON.stringify(useNavCounts()));
  const counts = () => JSON.parse(renderToStaticMarkup(createElement(Probe)).replace(/^<pre>|<\/pre>$/g, "").replace(/&quot;/g, '"')) as NavCounts;

  it("reports exact store-only counts, and lower bounds where the page reads another source", async () => {
    __setStateLoaderForTests(async () => ({
      tasks: allTasks().slice(0, 2),
      risks: [],
      files: [],
      conflicts: openConflicts(),
      errors: openErrors(),
      audit: [],
      counts: {},
      lastSweep: "2026.09.25 · 12:00",
    }));
    await hydrate();
    expect(dataSource()).toBe("live");
    const live = counts();
    // Live agents are derived from the store alone: exact.
    expect(live.agents).toMatchObject({ exact: true, unit: "live" });
    expect(typeof live.agents?.n).toBe("number");
    // Approvals come from GET /api/approvals on their page; the store's gates
    // are not the same source, so the badge is never claimed exact.
    expect(live.approvals?.exact).toBe(false);
    // No viewer on the server render → the Home count is unknown.
    expect(live.needs).toEqual({ n: null, exact: false });
  });
});
