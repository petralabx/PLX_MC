// Starred (TASK-3842): the model (which pages can be starred and under which
// key, the rows with their zoned labels, the cap and the room a hidden star
// makes), the client store (each change shows at once and goes to the server
// one at a time; the server's list replaces the copy; a refused change is put
// back with a notice; another device's stars arrive on focus), and the zoned
// shell: the sidebar's Starred zone after My work (copies, never lit), the top
// bar's page toggle, the Projects page rows and the More sheet. No DOM
// environment (vitest runs in Node): rendered with renderToStaticMarkup, which
// reads the stars store's state as its snapshot.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Sidebar } from "@/components/mc/chrome";
import { MoreSheet } from "@/components/mc/more-sheet";
import { deadStars, starChanges, starKeyOf, starRows, type NavFlags } from "@/components/mc/nav-model";
import { setNavZonesBuildFlag } from "@/components/mc/nav-zones";
import { ProjectsView } from "@/components/mc/projects-view";
import { SCREEN_VALUES, type Route } from "@/components/mc/route";
import { Topbar } from "@/components/mc/top-bar";
import {
  __resetStarsForTests,
  __setStarsClientForTests,
  __starsSettled,
  loadStars,
  refreshStars,
  useStars,
  type Stars,
} from "@/components/mc/use-stars";
import { ApiClientError } from "@/lib/api";
import {
  __setStateLoaderForTests,
  activeNotices,
  allBuckets,
  allProjects,
  allTasks,
  hydrate,
  openConflicts,
  openErrors,
  resetStore,
} from "@/lib/mc-data/store";
import { STAR_CAP, applyStarChange, type StarChange } from "@/lib/stars";
import { isStarKey } from "@/lib/stars/store";

const FLAGS: NavFlags = { meetingIntake: false, routingInbox: false };
const PROJECT = "project:PRJ-PORTAL-GOLIVE";
const SIX = ["home", "mine", "approvals", "board", "goals", "help"].map((s) => `screen:${s}`);

// The fake server: one person's list, changed one request at a time.
let server: string[] = [];
let sent: StarChange[] = [];
const client = (change?: (c: StarChange) => Promise<string[]>) => ({
  get: async () => [...server],
  change: (c: StarChange) => {
    sent.push(c);
    if (change) return change(c);
    server = applyStarChange(server, c);
    return Promise.resolve([...server]);
  },
});

beforeEach(() => {
  resetStore();
  server = [];
  sent = [];
  __setStarsClientForTests(client());
  __resetStarsForTests();
});

afterEach(() => {
  __setStarsClientForTests(null);
  setNavZonesBuildFlag(false);
});

function Probe({ enabled, onRender }: { enabled: boolean; onRender: (stars: Stars) => void }) {
  onRender(useStars(enabled));
  return null;
}
const probe = (enabled = true): Stars => {
  let rendered: Stars | undefined;
  renderToStaticMarkup(createElement(Probe, { enabled, onRender: (stars) => (rendered = stars) }));
  return rendered!;
};
const keys = (stars: Stars) => stars.rows.map((row) => row.key);
const loaded = (stars: string[]) => {
  server = [...stars];
  __resetStarsForTests(stars);
};

async function goLive() {
  __setStateLoaderForTests(async () => ({
    tasks: allTasks(),
    risks: [],
    files: [],
    conflicts: openConflicts(),
    errors: openErrors(),
    audit: [],
    counts: {},
    lastSweep: "2026.10.25 · 03:00",
    projects: allProjects(),
    buckets: allBuckets(),
  }));
  await hydrate();
}

describe("which pages can be starred, and under which key", () => {
  it("stars every screen by its zoned row, and Board, List and Timeline as one All work star", () => {
    for (const screen of SCREEN_VALUES.filter((s) => s !== "task" && s !== "project" && s !== "bucket")) {
      const key = starKeyOf({ screen });
      expect(key, screen).toBe(screen === "list" || screen === "timeline" ? "screen:board" : `screen:${screen}`);
    }
  });

  it("agrees with the server on which screens a new star may name", () => {
    for (const screen of SCREEN_VALUES) {
      expect(isStarKey(`screen:${screen}`), screen).toBe(starKeyOf({ screen }) === `screen:${screen}`);
    }
  });

  it("stars a project and an initiative by their record, and never a task", () => {
    expect(starKeyOf({ screen: "project", projectId: "PRJ-PORTAL-GOLIVE" })).toBe(PROJECT);
    expect(starKeyOf({ screen: "bucket", bucketId: "BKT-WMS" })).toBe("bucket:BKT-WMS");
    expect(starKeyOf({ screen: "task", taskId: "TASK-1" })).toBeNull();
    expect(starKeyOf({ screen: "project" })).toBeNull();
  });
});

describe("starRows", () => {
  it("turns keys into rows in the person's order, with the zoned label, target and icon", () => {
    const [bucket] = allBuckets();
    const rows = starRows([`bucket:${bucket.id}`, "screen:board", "screen:help", "screen:sync", PROJECT], allProjects(), allBuckets(), FLAGS);
    expect(rows.map((r) => [r.key, r.label, r.target])).toEqual([
      [`bucket:${bucket.id}`, bucket.name, { screen: "bucket", bucketId: bucket.id }],
      ["screen:board", "All work", { screen: "board" }],
      ["screen:help", "Help and shortcuts", { screen: "help" }],
      ["screen:sync", "SharePoint sync", { screen: "sync" }],
      [PROJECT, "PLX Portal Go-Live", { screen: "project", projectId: "PRJ-PORTAL-GOLIVE" }],
    ]);
    expect(rows[1].lucide).toBe("SquareKanban");
    expect(rows[0].health).toBe(bucket.health);
  });

  it("still shows a closed or archived project: the person starred it", () => {
    const [project] = allProjects();
    const closed = { ...project, id: "PRJ-DONE", name: "Done project", status: "closed" as const };
    const archived = { ...project, id: "PRJ-OLD", name: "Archived project", archivedAt: "2026-10-01T00:00:00Z" };
    const rows = starRows(["project:PRJ-DONE", "project:PRJ-OLD"], [project, closed, archived], allBuckets(), FLAGS);
    expect(rows.map((r) => r.label)).toEqual(["Done project", "Archived project"]);
  });

  it("leaves out a star whose record is gone, a screen behind an off flag, and a malformed key", () => {
    const stars = ["project:PRJ-GONE", "bucket:BKT-GONE", "screen:intake", "screen:nowhere", "task:TASK-1", "screen:goals"];
    expect(starRows(stars, allProjects(), allBuckets(), FLAGS).map((r) => r.key)).toEqual(["screen:goals"]);
    expect(starRows(stars, allProjects(), allBuckets(), { ...FLAGS, meetingIntake: true }).map((r) => r.key)).toEqual([
      "screen:intake",
      "screen:goals",
    ]);
  });
});

describe("deadStars", () => {
  it("names the stars that can never show, but not a screen behind an off flag", () => {
    const [project] = allProjects();
    const closed = { ...project, id: "PRJ-DONE", status: "closed" as const };
    const stars = ["project:PRJ-GONE", "bucket:BKT-GONE", "screen:intake", "screen:nowhere", "task:TASK-1", "project:PRJ-DONE", "screen:goals", PROJECT];
    expect([...deadStars(stars, [project, closed], allBuckets())]).toEqual([
      "project:PRJ-GONE",
      "bucket:BKT-GONE",
      "screen:nowhere",
      "task:TASK-1",
    ]);
  });
});

describe("starChanges", () => {
  const none = new Set<string>();

  it("adds a new star and removes a starred one", () => {
    expect(starChanges(["screen:goals"], none, "screen:home")).toEqual([{ op: "add", key: "screen:home" }]);
    expect(starChanges(["screen:goals"], none, "screen:goals")).toEqual([{ op: "remove", key: "screen:goals" }]);
  });

  it("refuses a new star once STAR_CAP are kept and none is dead, but still unstars", () => {
    expect(starChanges(SIX, none, "screen:insights")).toBeNull();
    expect(starChanges(SIX, none, "screen:home")).toEqual([{ op: "remove", key: "screen:home" }]);
  });

  it("when full, first removes as few dead stars as make room", () => {
    const stars = ["project:PRJ-GONE", "task:TASK-1", ...SIX.slice(0, 4)];
    expect(starChanges(stars, new Set(["project:PRJ-GONE", "task:TASK-1"]), "screen:insights")).toEqual([
      { op: "remove", key: "project:PRJ-GONE" },
      { op: "add", key: "screen:insights" },
    ]);
  });
});

describe("applyStarChange", () => {
  it("adds last, and adding or removing twice changes nothing", () => {
    expect(applyStarChange(["a"], { op: "add", key: "screen:b" })).toEqual(["a", "screen:b"]);
    expect(applyStarChange(["screen:b"], { op: "add", key: "screen:b" })).toEqual(["screen:b"]);
    expect(applyStarChange(["screen:b"], { op: "remove", key: "screen:c" })).toEqual(["screen:b"]);
  });
});

describe("the stars store", () => {
  it("loads once; a failed load leaves Starred off until a retry loads it", async () => {
    server = ["screen:goals"];
    const get = vi.fn(async () => [...server]);
    __setStarsClientForTests({ ...client(), get });
    expect(probe().ready).toBe(false);
    loadStars();
    loadStars();
    await vi.waitFor(() => expect(probe().ready).toBe(true));
    expect(get).toHaveBeenCalledTimes(1);
    expect(keys(probe())).toEqual(["screen:goals"]);

    __resetStarsForTests();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let fail = true;
    __setStarsClientForTests({ ...client(), get: async () => (fail ? Promise.reject(new Error("503")) : [...server]) });
    loadStars();
    await vi.waitFor(() => expect(probe().off).toBe(true));
    expect(probe().rows).toEqual([]);
    expect(warn).toHaveBeenCalled();
    // Back on the window, it tries again.
    fail = false;
    refreshStars();
    await vi.waitFor(() => expect(probe().ready).toBe(true));
    expect(keys(probe())).toEqual(["screen:goals"]);
    warn.mockRestore();
  });

  it("shows a change at once, sends just that change, and takes the server's list back", async () => {
    loaded(["screen:goals"]);
    // Another device starred Help since this page loaded.
    server = [...server, "screen:help"];
    probe().toggle("screen:home");
    expect(keys(probe())).toEqual(["screen:goals", "screen:home"]);
    await __starsSettled();
    expect(sent).toEqual([{ op: "add", key: "screen:home" }]);
    expect(keys(probe())).toEqual(["screen:goals", "screen:help", "screen:home"]);
  });

  it("sends changes one at a time, in order", async () => {
    loaded(["screen:goals"]);
    let release: () => void = () => {};
    __setStarsClientForTests(
      client(
        (c) =>
          new Promise((resolve) => {
            release = () => {
              server = applyStarChange(server, c);
              resolve([...server]);
            };
          })
      )
    );
    probe().toggle("screen:home");
    probe().toggle("screen:goals");
    await Promise.resolve();
    expect(sent).toEqual([{ op: "add", key: "screen:home" }]);
    expect(keys(probe())).toEqual(["screen:home"]);
    release();
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toEqual({ op: "remove", key: "screen:goals" });
    release();
    await __starsSettled();
    expect(server).toEqual(["screen:home"]);
    expect(keys(probe())).toEqual(["screen:home"]);
  });

  it("puts back only the change the server refused, says so, and still sends the next one", async () => {
    loaded(["screen:goals"]);
    __setStarsClientForTests(
      client(async (c) => {
        if (c.key === "screen:home") throw new ApiClientError("http_error", "The server said no.");
        server = applyStarChange(server, c);
        return [...server];
      })
    );
    probe().toggle("screen:home");
    probe().toggle("screen:help");
    await __starsSettled();
    expect(sent).toEqual([
      { op: "add", key: "screen:home" },
      { op: "add", key: "screen:help" },
    ]);
    expect(keys(probe())).toEqual(["screen:goals", "screen:help"]);
    expect(activeNotices()).toHaveLength(1);
    expect(activeNotices()[0]).toMatchObject({ tone: "error" });
    expect(activeNotices()[0].body).toBe("Couldn't save your star. The server said no. Starred shows what is saved.");
  });

  it("reads the list again after a failure, since a lost answer may still have been saved", async () => {
    loaded(["screen:goals"]);
    __setStarsClientForTests(
      client(async (c) => {
        server = applyStarChange(server, c);
        throw new ApiClientError("bad_response", "The connection dropped.");
      })
    );
    probe().toggle("screen:home");
    await __starsSettled();
    expect(server).toEqual(["screen:goals", "screen:home"]);
    expect(keys(probe())).toEqual(["screen:goals", "screen:home"]);
  });

  it("drops the rest of a star when its first change fails: one notice, no add after a failed remove", async () => {
    const stars = ["project:PRJ-GONE", ...SIX.slice(0, 5)];
    await goLive();
    loaded(stars);
    __setStarsClientForTests(
      client(async (c) => {
        if (c.op === "remove") throw new ApiClientError("http_error", "The server said no.");
        server = applyStarChange(server, c);
        return [...server];
      })
    );
    probe().toggle("screen:insights");
    await __starsSettled();
    expect(sent).toEqual([{ op: "remove", key: "project:PRJ-GONE" }]);
    expect(activeNotices()).toHaveLength(1);
    expect(keys(probe())).toEqual(SIX.slice(0, 5));
  });

  it("says the list is full when another device filled it first", async () => {
    loaded(SIX.slice(0, 5));
    __setStarsClientForTests(
      client(async () => {
        throw new ApiClientError("stars_full", "You can keep up to 6 stars. Unstar one first.");
      })
    );
    probe().toggle("screen:insights");
    await __starsSettled();
    expect(keys(probe())).toEqual(SIX.slice(0, 5));
    expect(activeNotices()[0]).toMatchObject({ tone: "info", body: `You can keep up to ${STAR_CAP} stars. Unstar one first.` });
  });

  it("refuses a star past STAR_CAP with a notice, and sends nothing", async () => {
    loaded(SIX);
    expect(probe().full).toBe(true);
    probe().toggle("screen:insights");
    await __starsSettled();
    expect(sent).toEqual([]);
    expect(keys(probe())).toEqual(SIX);
    expect(activeNotices()[0]).toMatchObject({ tone: "info", body: `You can keep up to ${STAR_CAP} stars. Unstar one first.` });
  });

  it("never removes a screen behind an off flag to make room: other devices may show it", async () => {
    await goLive();
    loaded(["screen:intake", ...SIX.slice(0, 5)]);
    expect(keys(probe())).toEqual(SIX.slice(0, 5));
    expect(probe().full).toBe(true);
    probe().toggle("screen:insights");
    await __starsSettled();
    expect(sent).toEqual([]);
    expect(activeNotices()[0]).toMatchObject({ tone: "info" });
  });

  it("makes room from a dead star, but only once the data is live", async () => {
    const stars = ["project:PRJ-GONE", ...SIX.slice(0, 5)];
    loaded(stars);
    expect(probe().full).toBe(true);
    probe().toggle("screen:insights");
    expect(sent).toEqual([]);

    await goLive();
    loaded(stars);
    expect(probe().full).toBe(false);
    probe().toggle("screen:insights");
    await __starsSettled();
    expect(sent).toEqual([
      { op: "remove", key: "project:PRJ-GONE" },
      { op: "add", key: "screen:insights" },
    ]);
    expect(server).toEqual([...SIX.slice(0, 5), "screen:insights"]);
  });

  it("ignores a read that began before a change, even when the change lands first", async () => {
    loaded(["screen:goals"]);
    let answer: () => void = () => {};
    const slowGet = {
      ...client(),
      get: () => {
        const then = [...server];
        return new Promise<string[]>((resolve) => {
          answer = () => resolve(then);
        });
      },
    };
    __setStarsClientForTests(slowGet);
    refreshStars();
    probe().toggle("screen:home");
    await __starsSettled();
    answer();
    await Promise.resolve();
    await Promise.resolve();
    expect(keys(probe())).toEqual(["screen:goals", "screen:home"]);
  });

  it("picks up another device's stars on focus, but not over a change still on its way", async () => {
    loaded(["screen:goals"]);
    server = ["screen:goals", "screen:help"];
    refreshStars();
    await vi.waitFor(() => expect(keys(probe())).toEqual(["screen:goals", "screen:help"]));

    let release: () => void = () => {};
    const slow = client(
      (c) =>
        new Promise((resolve) => {
          release = () => {
            server = applyStarChange(server, c);
            resolve([...server]);
          };
        })
    );
    const get = vi.spyOn(slow, "get");
    __setStarsClientForTests(slow);
    probe().toggle("screen:home");
    refreshStars();
    expect(get).not.toHaveBeenCalled();
    release();
    await __starsSettled();
    expect(keys(probe())).toEqual(["screen:goals", "screen:help", "screen:home"]);
  });

  it("stays off outside the zoned shell", () => {
    loaded(["screen:goals"]);
    expect(probe(false)).toMatchObject({ off: true, ready: false, rows: [] });
  });
});

describe("Starred in the zoned shell", () => {
  beforeEach(() => setNavZonesBuildFlag(true));

  const sidebar = (route: Route) =>
    renderToStaticMarkup(
      createElement(Sidebar, { route, nav: () => {}, counts: {}, onNewProject: () => {}, onNewInitiative: () => {} })
    );
  const nav = (html: string) => html.slice(0, html.indexOf("</nav>"));
  const zone = (html: string) => {
    const start = html.indexOf('<div class="grp stars"');
    return start < 0 ? "" : html.slice(start, html.indexOf('aria-labelledby="mc-nav-h-plan"', start));
  };
  const topbar = (route: Route) =>
    renderToStaticMarkup(
      createElement(Topbar, { route, nav: () => {}, dark: false, setDark: () => {}, onOpenPalette: () => {} })
    );

  it("puts Starred right after My work, the person's order, as copies that are never lit", () => {
    loaded(["screen:goals", PROJECT]);
    const html = nav(sidebar({ screen: "goals" }));
    const headings = [...html.matchAll(/id="mc-nav-h-([a-z-]+)"/g)].map((m) => m[1]);
    expect(headings).toEqual(["my-work", "starred", "plan", "reporting", "knowledge"]);
    const starred = zone(html);
    expect(starred).toContain('<div class="h" id="mc-nav-h-starred">Starred</div>');
    const links = [...starred.matchAll(/<a href="([^"]+)" class="([^"]+)"/g)].map((m) => [m[1], m[2]]);
    expect(links).toEqual([
      ["/?screen=goals", "item"],
      ["/?screen=project&amp;projectId=PRJ-PORTAL-GOLIVE", "item"],
    ]);
    expect(starred).not.toContain("aria-current");
    // The item's own row is the one current row.
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain('href="/?screen=goals" class="item active" aria-current="page" title="Goals &amp; production"');
  });

  it("gives the icon rail one Starred button that opens the labelled drawer", () => {
    loaded(["screen:goals"]);
    expect(zone(sidebar({ screen: "home" }))).toContain(
      '<button type="button" class="item star-rail" title="Starred" aria-controls="mc-nav" aria-expanded="false">'
    );
  });

  it("leaves Starred out with no stars, and in the default shell", () => {
    expect(nav(sidebar({ screen: "home" }))).not.toContain("mc-nav-h-starred");
    loaded(["screen:goals"]);
    setNavZonesBuildFlag(false);
    expect(sidebar({ screen: "home" })).not.toContain("mc-nav-h-starred");
  });

  it("gives the top bar a star toggle for the page, pressed when starred", () => {
    loaded(["screen:goals", PROJECT, "screen:board"]);
    expect(topbar({ screen: "goals" })).toContain('aria-label="Star Goals &amp; production" aria-pressed="true" title="Unstar"');
    expect(topbar({ screen: "home" })).toContain('aria-label="Star Home" aria-pressed="false" title="Star"');
    expect(topbar({ screen: "timeline" })).toContain('aria-label="Star All work" aria-pressed="true"');
    expect(topbar({ screen: "project", projectId: "PRJ-PORTAL-GOLIVE" })).toContain(
      'aria-label="Star PLX Portal Go-Live" aria-pressed="true"'
    );
    expect(topbar({ screen: "task", taskId: allTasks()[0].id })).not.toContain("star-toggle");
    expect(topbar({ screen: "project", projectId: "PRJ-GONE" })).not.toContain("star-toggle");
  });

  it("says when the stars are full, and disables the toggle while they load", () => {
    loaded(SIX);
    expect(topbar({ screen: "insights" })).toContain('aria-pressed="false" title="Stars are full: unstar one first"');
    __resetStarsForTests();
    expect(topbar({ screen: "insights" })).toMatch(/aria-label="Star Insights" aria-pressed="false" title="Star" disabled=""/);
  });

  it("has no star toggle in the default shell", () => {
    loaded(["screen:goals"]);
    setNavZonesBuildFlag(false);
    expect(topbar({ screen: "goals" })).not.toContain("star-toggle");
  });

  it("puts a star toggle on each Projects row: the project and each initiative", () => {
    const [bucket] = allBuckets();
    loaded([`bucket:${bucket.id}`]);
    const html = renderToStaticMarkup(createElement(ProjectsView, { route: { screen: "projects" }, nav: () => {} }));
    expect(html).toContain('class="pj-star star-toggle" aria-label="Star PLX Portal Go-Live" aria-pressed="false"');
    for (const b of allBuckets()) {
      expect(html).toContain(`aria-label="Star ${b.name}" aria-pressed="${b.id === bucket.id}"`);
    }
    setNavZonesBuildFlag(false);
    expect(renderToStaticMarkup(createElement(ProjectsView, { route: { screen: "projects" }, nav: () => {} }))).not.toContain(
      "star-toggle"
    );
  });

  it("opens the phone More sheet with Starred, as links that are never lit", () => {
    loaded(["screen:goals", PROJECT]);
    const html = renderToStaticMarkup(
      createElement(MoreSheet, {
        open: true,
        onClose: () => {},
        onAllScreens: () => {},
        route: { screen: "goals" },
        nav: () => {},
        flags: FLAGS,
        counts: {},
        dark: false,
        setDark: () => {},
      })
    );
    const body = html.slice(html.indexOf('<div class="sheet-body">'));
    const groups = [...body.matchAll(/<div class="grp-h" id="[^"]+-([a-z-]+)">([^<]+)<\/div>/g)].map((m) => m[2]);
    expect(groups[0]).toBe("Starred");
    const starred = body.slice(0, body.indexOf(">Reporting<"));
    expect([...starred.matchAll(/<a class="row" href="([^"]+)"/g)].map((m) => m[1])).toEqual([
      "/?screen=goals",
      "/?screen=project&amp;projectId=PRJ-PORTAL-GOLIVE",
    ]);
    expect(starred).not.toContain("aria-current");
  });
});
