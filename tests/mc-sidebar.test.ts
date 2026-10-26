// Wave 6 — colleague UX: the sidebar renders the shared nav model as a labelled
// <nav> of real links (open in a new tab / copy URL), with decorative icons
// hidden from assistive tech and Admin & health collapsed by default. ADR-005:
// the icons are Lucide and the badges speak the honest count vocabulary.
// No DOM environment (vitest runs in Node) — rendered with renderToStaticMarkup.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Sidebar, approvalsBadge, useNavCounts, type NavCounts } from "@/components/mc/chrome";
import { CountBadge } from "@/components/mc/count-badge";
import { setNavZonesBuildFlag } from "@/components/mc/nav-zones";
import type { Route } from "@/components/mc/route";
import type { Task } from "@/lib/mc-data/types";
import {
  __setStateLoaderForTests,
  allBuckets,
  allProjects,
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

  // TASK-3837: an initiative page also lights its parent project, but the
  // initiative stays the only current row.
  it("marks the open initiative's parent project as on-path, not current", () => {
    const html = render({ screen: "bucket", bucketId: "BKT-WMS" });
    expect(html).toContain('href="/?screen=bucket&amp;bucketId=BKT-WMS" class="item active" aria-current="page"');
    expect(html).toContain('href="/?screen=project&amp;projectId=PRJ-PORTAL-GOLIVE" class="item on-path"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    // The project page itself is current, as before; nothing is on-path.
    const project = render({ screen: "project", projectId: "PRJ-PORTAL-GOLIVE" });
    expect(project).toContain('projectId=PRJ-PORTAL-GOLIVE" class="item active" aria-current="page"');
    expect(project).not.toContain("on-path");
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

// TASK-3840: the zoned sidebar, built on (NEXT_PUBLIC_PLX_MC_NAV_ZONES=1 or
// the localStorage opt-in; tests stand in for the build flag).
describe("Sidebar — zoned", () => {
  beforeEach(() => setNavZonesBuildFlag(true));
  afterEach(() => setNavZonesBuildFlag(false));

  const nav = (html: string) => html.slice(0, html.indexOf("</nav>"));
  const flyout = (html: string) => html.slice(html.indexOf('<div id="mc-nav-admin-flyout"'));

  it("reads My work, Plan, Reporting, Knowledge, then a footer with Admin & health and Help", () => {
    const html = nav(render({ screen: "home" }));
    const headings = [...html.matchAll(/id="mc-nav-h-([a-z-]+)"/g)].map((m) => m[1]);
    expect(headings).toEqual(["my-work", "plan", "reporting", "knowledge"]);
    expect(html).not.toContain("mc-nav-h-admin");
    // HTML attribute names are case-insensitive: React writes popoverTarget.
    expect(html).toMatch(
      /<div class="side-foot"><button type="button" class="item foot-toggle" data-tree-key="admin" tabindex="-1" title="Admin &amp; health" popovertarget="mc-nav-admin-flyout" aria-controls="mc-nav-admin-flyout" aria-expanded="false">/i
    );
    expect(html).toContain('href="/?screen=help" class="item" title="Help and shortcuts"');
  });

  // TASK-3843: one All work row for Board, List and Timeline.
  it("shows one All work row, lit on Board, List and Timeline, each at its own URL", () => {
    for (const screen of ["board", "list", "timeline"] as const) {
      const html = nav(render({ screen }));
      // Lit, it stays on the view: a click never swaps List for Board.
      expect(html).toContain(`href="/?screen=${screen}" class="item active" aria-current="page" title="All work"`);
      expect(html.match(/aria-current="page"/g)).toHaveLength(1);
      expect(html).not.toMatch(/title="(Board|List|Timeline)"/);
    }
    expect(nav(render({ screen: "projects" }))).toContain('href="/?screen=board" class="item" title="All work"');
  });

  it("collapses Knowledge by default behind a disclosure button", () => {
    const html = render({ screen: "home" });
    expect(html).toContain('id="mc-nav-h-knowledge" aria-expanded="false" aria-controls="mc-nav-knowledge"');
    expect(html).toContain('<div id="mc-nav-knowledge" class="grp-body" hidden="">');
    expect(html).toContain("Skills directory");
  });

  it("puts the system screens in a popover beside the nav, in three labelled sections", () => {
    const html = render({ screen: "home" });
    expect(html.indexOf("</nav>")).toBeLessThan(html.indexOf('id="mc-nav-admin-flyout"'));
    const panel = flyout(html);
    expect(panel).toMatch(/^<div id="mc-nav-admin-flyout" popover="auto" class="mc-flyout" role="group" aria-label="Admin &amp; health">/);
    for (const [slug, label] of [
      ["operations", "Operations"],
      ["sync-and-data", "Sync and data"],
      ["engineering", "Engineering"],
    ]) {
      expect(panel).toContain(`<div class="fly-sec" role="group" aria-labelledby="mc-fly-h-${slug}"><p class="fly-h" id="mc-fly-h-${slug}">${label}</p>`);
    }
    for (const screen of ["feed", "sync", "files", "loop-ledgers", "repos", "activity", "matrix"]) {
      expect(panel).toContain(`href="/?screen=${screen}"`);
      expect(nav(html)).not.toContain(`href="/?screen=${screen}"`);
    }
    expect(panel).toContain('<span class="nm">SharePoint sync</span>');
  });

  it("marks an Admin & health screen current in the flyout and lights its toggle", () => {
    const html = render({ screen: "repos" });
    expect(flyout(html)).toContain('href="/?screen=repos" class="item active" aria-current="page"');
    expect(nav(html)).toContain('class="item foot-toggle on-path"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(render({ screen: "home" })).not.toContain("foot-toggle on-path");
  });

  it("carries the sync count on the toggle, so a closed flyout still shows it", () => {
    const html = render({ screen: "home" }, { sync: { n: 2, exact: true, tone: "warn" } });
    // The sidebar shows a figure in the count column (portal ADR-011 v2,
    // Counts), then the › of a row that opens a flyout; the flyout keeps its badge.
    const figure = '<span class="cnt warn"><span aria-hidden="true">2</span><span class="vh">, 2</span></span>';
    const start = html.indexOf('class="item foot-toggle"');
    expect(html.slice(start, html.indexOf("</button>", start))).toMatch(
      new RegExp(`Admin &amp; health</span>${figure}<svg[^>]*class="lucide lucide-chevron-right act"`)
    );
    expect(flyout(html)).toContain('<span class="badge warn"><span aria-hidden="true">2</span><span class="vh">, 2</span></span>');
  });

  // TASK-3841: initiatives sit under their project in the tree.
  it("nests initiatives under their project, collapsed until that project is open", () => {
    const html = nav(render({ screen: "home" }));
    expect(html).toContain('<div class="tree" role="group" aria-label="Projects">');
    expect(html).toContain('href="/?screen=projects" class="item" title="Projects"');
    expect(html).not.toContain("mc-nav-h-projects");
    expect(html).toContain('href="/?screen=project&amp;projectId=PRJ-PORTAL-GOLIVE" class="item"');
    // The link says whether it is open too: → and ← open it with focus on the link.
    expect(html).toContain('data-tree-key="project:PRJ-PORTAL-GOLIVE" data-tree-open="false" tabindex="-1" aria-expanded="false" href=');
    expect(html).toContain(
      'aria-expanded="false" aria-controls="mc-nav-tree-PRJ-PORTAL-GOLIVE" aria-label="Initiatives in PLX Portal Go-Live"'
    );
    expect(html).toContain('<div id="mc-nav-tree-PRJ-PORTAL-GOLIVE" class="tree-kids" hidden="">');
    expect(html).not.toContain("View all");
    // One + on the Projects row, out of the Tab order, opens New project or
    // New initiative (portal ADR-011 v2, Lists 4).
    expect(html).not.toContain("side-new-initiative");
    expect(html).toContain(
      '<button type="button" class="row-act" tabindex="-1" title="New project or initiative" aria-label="New project or initiative" popoverTarget="mc-nav-new-menu" aria-controls="mc-nav-new-menu" aria-expanded="false" data-tree-menu-for="screen:projects">'
    );
    const full = render({ screen: "home" });
    const menu = full.slice(full.indexOf('<div id="mc-nav-new-menu"'));
    expect(menu).toMatch(/^<div id="mc-nav-new-menu" popover="auto" class="mc-flyout drop new-menu" role="group" aria-label="New">/);
    expect(menu).toMatch(/New project.*New initiative/);
  });

  it("lists every active project A to Z, then a Closed row; archived ones never show", async () => {
    const [project] = allProjects();
    const [bucket] = allBuckets();
    const projects = Array.from({ length: 8 }, (_, i) => ({ ...project, id: `PRJ-${i + 1}`, name: `Project ${i + 1}` }));
    __setStateLoaderForTests(async () => ({
      tasks: allTasks().slice(0, 1),
      risks: [],
      files: [],
      conflicts: openConflicts(),
      errors: openErrors(),
      audit: [],
      counts: {},
      lastSweep: "2026.10.24 · 12:00",
      projects: [
        ...projects,
        { ...project, id: "PRJ-DONE", name: "Done project", status: "closed" as const },
        { ...project, id: "PRJ-OLD", name: "Archived project", archivedAt: "2026-10-01T00:00:00Z" },
      ],
      buckets: [{ ...bucket, id: "BKT-8", name: "Eighth work", project: "PRJ-8" }],
    }));
    await hydrate();
    const rows = (html: string) => [...html.matchAll(/data-tree-key="project:(PRJ-[^"]+)"/g)].map((m) => m[1]);
    const home = nav(render({ screen: "home" }));
    expect(rows(home)).toEqual(["PRJ-1", "PRJ-2", "PRJ-3", "PRJ-4", "PRJ-5", "PRJ-6", "PRJ-7", "PRJ-8"]);
    expect(home).not.toContain("View all");
    expect(home).not.toContain("Archived project");
    // Closed (1), collapsed; its project is a muted leaf under it.
    expect(home).toContain(
      '<button type="button" class="item" data-tree-key="closed" data-tree-open="false" tabindex="-1" data-tree-toggles="closed" aria-expanded="false" aria-controls="mc-nav-closed">'
    );
    expect(home).toMatch(/<span class="nm">Closed<\/span><span class="cnt"><span aria-hidden="true">1<\/span><span class="vh">, (<!-- -->)?1(<!-- -->)? project/);
    expect(home).toContain('<div id="mc-nav-closed" class="tree-kids" hidden="">');
    expect(home).toContain('data-tree-key="closed:PRJ-DONE" data-tree-parent="closed"');
    // The open initiative's project opens; a closed project opens the Closed row.
    const initiative = nav(render({ screen: "bucket", bucketId: "BKT-8" }));
    expect(initiative).toContain('aria-expanded="true" aria-controls="mc-nav-tree-PRJ-8"');
    expect(initiative).toContain('href="/?screen=bucket&amp;bucketId=BKT-8" class="item active" aria-current="page"');
    const closed = nav(render({ screen: "project", projectId: "PRJ-DONE" }));
    expect(closed).toContain('<div id="mc-nav-closed" class="tree-kids">');
    expect(closed).toContain('href="/?screen=project&amp;projectId=PRJ-DONE" class="item active" aria-current="page"');
  });

  // TASK-3955: counts are figures in the count column (portal ADR-011 v2, Counts).
  it("shows counts as figures: an action count, open tasks, at risk; zero and unknown show nothing", async () => {
    const [project] = allProjects();
    const [bucket] = allBuckets();
    const [first] = allTasks();
    __setStateLoaderForTests(async () => ({
      tasks: [
        { ...first, id: "T-1", bucket: "BKT-A", stage: "approved" as const },
        { ...first, id: "T-2", bucket: "BKT-A", stage: "verified" as const },
      ],
      risks: [],
      files: [],
      conflicts: openConflicts(),
      errors: openErrors(),
      audit: [],
      counts: {},
      lastSweep: "2026.10.24 · 12:00",
      projects: [
        { ...project, id: "PRJ-A", name: "Alpha", health: "risk" as const },
        { ...project, id: "PRJ-B", name: "Beta", health: "track" as const },
        { ...project, id: "PRJ-C", name: "Gamma", health: "off" as const },
      ],
      buckets: [{ ...bucket, id: "BKT-A", name: "Alpha work", project: "PRJ-A", health: "track" as const }],
    }));
    await hydrate();
    const html = nav(
      render({ screen: "project", projectId: "PRJ-A" }, { needs: { n: 3, exact: false }, approvals: { n: null, exact: false } })
    );
    expect(html).toContain(
      '<span class="nm">Home</span><span class="cnt acc"><span aria-hidden="true">3+</span><span class="vh">, at least 3</span></span>'
    );
    // Unknown shows nothing, no dash.
    expect(html).toMatch(/<span class="nm">Approvals<\/span><\/a>/);
    expect(html).not.toContain("—");
    expect(html).toMatch(
      /<span class="nm">Alpha<\/span><span class="cnt tasks risk"><span class="sq" aria-hidden="true"><\/span><span aria-hidden="true">1<\/span><span class="vh">, (<!-- -->)?at risk, 1 open task<\/span><\/span>/
    );
    expect(html).toContain('<span class="nm">Beta</span></a>');
    // Off track has its own colour class, apart from at risk, and says so.
    expect(html).toMatch(
      /<span class="nm">Gamma<\/span><span class="cnt tasks off"><span class="sq" aria-hidden="true"><\/span><span class="vh">, (<!-- -->)?off track<\/span><\/span>/
    );
    expect(html).toContain('<span class="nm">Alpha work</span><span class="cnt tasks"><span aria-hidden="true">1</span>');
  });

  // TASK-3955: one keyboard tree (portal ADR-011 v2, Keys 4–7).
  it("makes every row a tree row out of the Tab order until it is the stop, with a labelled filter", () => {
    const html = nav(render({ screen: "home" }));
    const rows = [...html.matchAll(/<(a|button)[^>]*data-tree-key="[^"]+"[^>]*>/g)].map((m) => m[0]);
    expect(rows.length).toBeGreaterThan(15);
    for (const row of rows) expect(row).toContain('tabindex="-1"');
    // Chevrons and the + stay out of the Tab order and outside the tree.
    expect(html).toMatch(/<button type="button" class="tree-toggle" tabindex="-1"/);
    expect(html).toContain('<input type="search" class="tree-q" aria-label="Filter projects and initiatives"');
    expect(html).toContain('<p class="tree-none" role="status"></p>');
    expect(html).toContain('data-tree-key="screen:brain-ask" data-tree-parent="group:knowledge"');
    expect(html).toContain('data-tree-key="group:knowledge" data-tree-open="false" tabindex="-1" data-tree-toggles="group:knowledge"');
  });

  it("opens the current project, and the open initiative's project, with one current row", () => {
    for (const route of [
      { screen: "project", projectId: "PRJ-PORTAL-GOLIVE" },
      { screen: "bucket", bucketId: "BKT-WMS" },
    ] as Route[]) {
      const html = nav(render(route));
      expect(html).toContain('aria-expanded="true" aria-controls="mc-nav-tree-PRJ-PORTAL-GOLIVE"');
      expect(html).toContain('<div id="mc-nav-tree-PRJ-PORTAL-GOLIVE" class="tree-kids">');
      expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    }
    const initiative = nav(render({ screen: "bucket", bucketId: "BKT-WMS" }));
    expect(initiative).toContain('href="/?screen=bucket&amp;bucketId=BKT-WMS" class="item active" aria-current="page"');
    expect(initiative).toContain('projectId=PRJ-PORTAL-GOLIVE" class="item on-path"');
  });

  it("renders the classic sidebar when the flag is off: no footer, no flyout, no tree", () => {
    setNavZonesBuildFlag(false);
    const html = render({ screen: "home" });
    expect(html).toContain('id="mc-nav-h-admin"');
    expect(html).not.toContain("side-foot");
    expect(html).not.toContain("mc-flyout");
    expect(html).not.toMatch(/data-tree-|tabindex|class="cnt/);
    expect(html).toMatch(/<\/nav>$/);
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
    // No viewer on the server render → the Home count is unknown.
    expect(live.needs).toEqual({ n: null, exact: false });
  });

  // Questions are per viewer, and the server render has none: a live store's
  // pending gates still show, as a lower bound.
  it("counts Approvals gates alone until the viewer is known", async () => {
    const [task] = allTasks();
    __setStateLoaderForTests(async () => ({
      tasks: [{ ...task, approvalGates: [PENDING_GATE] }],
      risks: [],
      files: [],
      conflicts: openConflicts(),
      errors: openErrors(),
      audit: [],
      counts: {},
      lastSweep: "2026.10.24 · 12:00",
    }));
    await hydrate();
    expect(dataSource()).toBe("live");
    expect(counts().approvals).toEqual({ n: 1, exact: false });
  });
});

const PENDING_GATE = {
  id: "apg_test",
  reason: "Approve the deploy",
  requestedBy: "agent:test",
  requestedAt: "2026-10-24T12:00:00Z",
  status: "pending" as const,
};

// TASK-3837: once live and the viewer is known, Approvals is an attention
// badge. Its page reads GET /api/approvals and /api/questions, not the store,
// so a shown count is a lower bound, never exact; with nothing waiting it is
// hidden, not "—".
describe("approvalsBadge", () => {
  const viewer = { id: "vince" };
  const question = (addressee: string, status: "open" | "answered" = "open") => ({
    id: `q_${addressee}_${status}`,
    addressee,
    text: "Ship it?",
    options: [],
    askedBy: "agent:test",
    askedByPrincipal: "sp_test",
    askedAt: "2026-10-24T12:00:00Z",
    status,
  });
  const task = (extra: Partial<Task>): Task => ({ ...allTasks()[0], approvalGates: [], questions: [], ...extra });

  it("is unknown until the store is live", () => {
    expect(approvalsBadge(false, viewer, [task({ approvalGates: [PENDING_GATE] })])).toEqual({ n: null, exact: false });
  });

  it("counts gates alone until the viewer is known, and never hides then", () => {
    expect(approvalsBadge(true, null, [task({ approvalGates: [PENDING_GATE] })])).toEqual({ n: 1, exact: false });
    expect(approvalsBadge(true, null, [task({ questions: [question("vince")] })])).toEqual({ n: null, exact: false });
  });

  it("is hidden while nothing waits on the viewer", () => {
    const badge = approvalsBadge(true, viewer, [task({ questions: [question("greg"), question("vince", "answered")] })]);
    expect(badge).toBeUndefined();
    expect(renderToStaticMarkup(createElement(CountBadge, { count: badge }))).toBe("");
  });

  it("counts pending gates and the viewer's open questions as a lower bound", () => {
    expect(approvalsBadge(true, viewer, [task({ approvalGates: [PENDING_GATE], questions: [question("vince")] })])).toEqual({
      n: 2,
      exact: false,
    });
  });
});
