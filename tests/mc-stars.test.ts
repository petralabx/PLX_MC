// Starred (TASK-3842; v2, TASK-3956): the model (which pages can be starred
// and under which key, the rows with their zoned labels, kind icons, slots and
// marks, the g digits, the cap), the client store (each change shows at once and
// goes to the server one at a time; the server's list replaces the copy; a
// refused change is put back with a notice; another device's stars arrive on
// focus; a move reorders), and the zoned shell: the sidebar's Starred zone after
// My work (copies, never lit), each sidebar row's star, the top bar's page
// toggle and the More sheet. No DOM environment (vitest runs in Node): rendered
// with renderToStaticMarkup, which reads the stars store's state as its snapshot.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Sidebar } from "@/components/mc/chrome";
import { MoreSheet } from "@/components/mc/more-sheet";
import { starChanges, starDigit, starKeyOf, starRows, starSlotOf, type NavFlags } from "@/components/mc/nav-model";
import { setNavZonesBuildFlag } from "@/components/mc/nav-zones";
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
import type { Bucket, Project } from "@/lib/mc-data";
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
import { STARS_FULL_MESSAGE, STAR_CAP, applyStarChange, type StarChange } from "@/lib/stars";
import { isStarKey } from "@/lib/stars/store";

const FLAGS: NavFlags = { meetingIntake: false, routingInbox: false };
const PROJECT = "project:PRJ-PORTAL-GOLIVE";
const TEN = ["home", "mine", "approvals", "board", "goals", "help", "dashboard", "feed", "sync", "matrix"].map((s) => `screen:${s}`);

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

// The server's data, live; `projects` and `initiatives` join the seed records.
async function goLive(projects: Project[] = [], initiatives: Bucket[] = []) {
  const seedProjects = allProjects();
  const seedBuckets = allBuckets();
  __setStateLoaderForTests(async () => ({
    tasks: allTasks(),
    risks: [],
    files: [],
    conflicts: openConflicts(),
    errors: openErrors(),
    audit: [],
    counts: {},
    lastSweep: "2026.10.25 · 03:00",
    projects: [...seedProjects, ...projects],
    buckets: [...seedBuckets, ...initiatives],
  }));
  await hydrate();
}

const closedProject = (): Project => ({ ...allProjects()[0], id: "PRJ-DONE", name: "Done project", status: "closed" });
const archivedProject = (): Project => ({ ...allProjects()[0], id: "PRJ-OLD", name: "Archived project", archivedAt: "2026-10-01T00:00:00Z" });
const archivedInitiative = (): Bucket => ({ ...allBuckets()[0], id: "BKT-OLD", name: "Archived initiative", archivedAt: "2026-10-01T00:00:00Z" });

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
    expect(isStarKey("task:TASK-1")).toBe(false);
  });
});

describe("starRows", () => {
  it("turns keys into rows in the person's order, with the zoned label, target, kind icon and slot", () => {
    const [bucket] = allBuckets();
    const rows = starRows([`bucket:${bucket.id}`, "screen:board", "screen:help", "screen:sync", PROJECT], allProjects(), allBuckets(), FLAGS);
    expect(rows.map((r) => [r.key, r.label, r.target, r.lucide, r.slot, r.mark])).toEqual([
      [`bucket:${bucket.id}`, bucket.name, { screen: "bucket", bucketId: bucket.id }, "Layers", 0, undefined],
      ["screen:board", "All work", { screen: "board" }, "SquareKanban", 1, undefined],
      ["screen:help", "Help and shortcuts", { screen: "help" }, "CircleHelp", 2, undefined],
      ["screen:sync", "SharePoint sync", { screen: "sync" }, "RefreshCw", 3, undefined],
      [PROJECT, "PLX Portal Go-Live", { screen: "project", projectId: "PRJ-PORTAL-GOLIVE" }, "FolderKanban", 4, undefined],
    ]);
  });

  it("marks a closed or archived project and an archived initiative, which still open: the person starred them", () => {
    const projects = [...allProjects(), closedProject(), archivedProject()];
    const initiatives = [...allBuckets(), archivedInitiative()];
    const rows = starRows(["project:PRJ-DONE", "project:PRJ-OLD", "bucket:BKT-OLD"], projects, initiatives, FLAGS);
    expect(rows.map((r) => [r.label, r.mark, r.target])).toEqual([
      ["Done project", "closed", { screen: "project", projectId: "PRJ-DONE" }],
      ["Archived project", "archived", { screen: "project", projectId: "PRJ-OLD" }],
      ["Archived initiative", "archived", { screen: "bucket", bucketId: "BKT-OLD" }],
    ]);
  });

  it("shows a star whose record or screen is gone as gone, in its slot, so the person can remove it", () => {
    const stars = ["project:PRJ-GONE", "bucket:BKT-GONE", "screen:intake", "screen:nowhere", "screen:goals"];
    expect(starRows(stars, allProjects(), allBuckets(), FLAGS).map((r) => [r.key, r.label, r.lucide, r.slot, r.mark])).toEqual([
      ["project:PRJ-GONE", "PRJ-GONE", "FolderKanban", 0, "gone"],
      ["bucket:BKT-GONE", "BKT-GONE", "Layers", 1, "gone"],
      // A screen behind an off flag never shows, but keeps slot 2: flags can differ between devices.
      ["screen:nowhere", "nowhere", "File", 3, "gone"],
      ["screen:goals", "Goals & production", "Target", 4, undefined],
    ]);
    expect(starRows(stars, allProjects(), allBuckets(), { ...FLAGS, meetingIntake: true }).map((r) => [r.key, r.slot])).toContainEqual([
      "screen:intake",
      2,
    ]);
  });

  it("shows nothing as gone until the records are live: seed or cached data would make real ones look gone", () => {
    const stars = ["project:PRJ-GONE", "bucket:BKT-GONE", "screen:nowhere", "screen:goals"];
    expect(starRows(stars, allProjects(), allBuckets(), FLAGS, false).map((r) => [r.key, r.slot])).toEqual([["screen:goals", 3]]);
  });
});

describe("the g digit of a slot", () => {
  it("opens the first nine with g 1 to g 9 and the tenth with g 0", () => {
    expect(Array.from({ length: STAR_CAP }, (_, slot) => starDigit(slot)).join("")).toBe("1234567890");
    for (let slot = 0; slot < STAR_CAP; slot += 1) expect(starSlotOf(starDigit(slot))).toBe(slot);
  });

  it("names no slot for anything but one digit", () => {
    for (const key of ["a", "10", "", " ", "-1"]) expect(starSlotOf(key), key).toBeNull();
  });
});

describe("starChanges", () => {
  it("adds a new star and removes a starred one", () => {
    expect(starChanges(["screen:goals"], "screen:home")).toEqual([{ op: "add", key: "screen:home" }]);
    expect(starChanges(["screen:goals"], "screen:goals")).toEqual([{ op: "remove", key: "screen:goals" }]);
  });

  it("keeps 10, refuses an eleventh, and still unstars", () => {
    expect(STAR_CAP).toBe(10);
    expect(starChanges(TEN.slice(0, 9), "screen:insights")).toEqual([{ op: "add", key: "screen:insights" }]);
    expect(starChanges(TEN, "screen:insights")).toBeNull();
    expect(starChanges(TEN, "screen:home")).toEqual([{ op: "remove", key: "screen:home" }]);
  });

  it("never removes a gone star to make room: it keeps its slot until the person removes it", () => {
    expect(starChanges(["project:PRJ-GONE", ...TEN.slice(0, 9)], "screen:insights")).toBeNull();
  });
});

describe("applyStarChange", () => {
  it("adds last, and adding or removing twice changes nothing", () => {
    expect(applyStarChange(["a"], { op: "add", key: "screen:b" })).toEqual(["a", "screen:b"]);
    expect(applyStarChange(["screen:b"], { op: "add", key: "screen:b" })).toEqual(["screen:b"]);
    expect(applyStarChange(["screen:b"], { op: "remove", key: "screen:c" })).toEqual(["screen:b"]);
  });

  it("moves a star to a place, 0 first; past the end means last; a star not kept changes nothing", () => {
    const abc = ["a", "b", "c"];
    expect(applyStarChange(abc, { op: "move", key: "c", to: 0 })).toEqual(["c", "a", "b"]);
    expect(applyStarChange(abc, { op: "move", key: "a", to: 1 })).toEqual(["b", "a", "c"]);
    expect(applyStarChange(abc, { op: "move", key: "a", to: 2 })).toEqual(["b", "c", "a"]);
    expect(applyStarChange(abc, { op: "move", key: "a", to: 9 })).toEqual(["b", "c", "a"]);
    expect(applyStarChange(abc, { op: "move", key: "b", to: 1 })).toEqual(abc);
    expect(applyStarChange(abc, { op: "move", key: "x", to: 0 })).toEqual(abc);
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

  it("says the list is full when another device filled it first", async () => {
    loaded(TEN.slice(0, 9));
    __setStarsClientForTests(
      client(async () => {
        throw new ApiClientError("stars_full", STARS_FULL_MESSAGE);
      })
    );
    probe().toggle("screen:insights");
    await __starsSettled();
    expect(keys(probe())).toEqual(TEN.slice(0, 9));
    expect(activeNotices()[0]).toMatchObject({ tone: "info", body: "Starred is full. Unstar one to add another." });
  });

  it("refuses an eleventh star with a notice, and sends nothing", async () => {
    loaded(TEN);
    expect(probe().full).toBe(true);
    probe().toggle("screen:insights");
    await __starsSettled();
    expect(sent).toEqual([]);
    expect(keys(probe())).toEqual(TEN);
    expect(activeNotices()[0]).toMatchObject({ tone: "info", body: "Starred is full. Unstar one to add another." });
  });

  it("counts a screen behind an off flag, which keeps its slot: other devices may show it", async () => {
    await goLive();
    loaded(["screen:intake", ...TEN.slice(0, 9)]);
    const stars = probe();
    expect(keys(stars)).toEqual(TEN.slice(0, 9));
    expect(stars.rows.map((r) => r.slot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect([stars.count, stars.full]).toEqual([10, true]);
    stars.toggle("screen:insights");
    await __starsSettled();
    expect(sent).toEqual([]);
    expect(activeNotices()[0]).toMatchObject({ tone: "info" });
  });

  it("keeps a gone star in its slot until the person removes it, and shows it only once the data is live", async () => {
    const stars = ["project:PRJ-GONE", ...TEN.slice(0, 9)];
    loaded(stars);
    expect(keys(probe())).toEqual(TEN.slice(0, 9));
    expect(probe().full).toBe(true);

    await goLive();
    loaded(stars);
    expect(probe().rows[0]).toMatchObject({ key: "project:PRJ-GONE", slot: 0, mark: "gone" });
    probe().toggle("screen:insights");
    await __starsSettled();
    expect(sent).toEqual([]);
    probe().toggle("project:PRJ-GONE");
    await __starsSettled();
    expect(sent).toEqual([{ op: "remove", key: "project:PRJ-GONE" }]);
    expect(probe().full).toBe(false);
    expect(server).toEqual(TEN.slice(0, 9));
  });

  it("moves a star: the new order shows at once, and one move goes to the server", async () => {
    loaded(["screen:goals", "screen:help", PROJECT]);
    probe().move(PROJECT, 0);
    expect(keys(probe())).toEqual([PROJECT, "screen:goals", "screen:help"]);
    expect(probe().rows.map((r) => r.slot)).toEqual([0, 1, 2]);
    await __starsSettled();
    expect(sent).toEqual([{ op: "move", key: PROJECT, to: 0 }]);
    expect(server).toEqual([PROJECT, "screen:goals", "screen:help"]);
  });

  it("sends no move for a star not kept, or one already in its place", async () => {
    loaded(["screen:goals", "screen:help"]);
    probe().move("screen:home", 0);
    probe().move("screen:goals", 0);
    await __starsSettled();
    expect(sent).toEqual([]);
  });

  it("puts a refused move back, and says so", async () => {
    loaded(["screen:goals", "screen:help"]);
    __setStarsClientForTests(
      client(async () => {
        throw new ApiClientError("http_error", "The server said no.");
      })
    );
    probe().move("screen:help", 0);
    await __starsSettled();
    expect(keys(probe())).toEqual(["screen:goals", "screen:help"]);
    expect(activeNotices()[0]).toMatchObject({ tone: "error" });
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
    // The heading counts every star kept, out of 10 (portal ADR-011 v2, Starred 1).
    expect(starred).toContain(
      '<div class="h" id="mc-nav-h-starred"><span>Starred</span><span class="h-cnt"><span aria-hidden="true">2 / 10</span><span class="vh">, 2 of 10</span></span></div>'
    );
    // Each copy is a row of the sidebar's keyboard tree (TASK-3955), keyed apart
    // from the item's own row, and carries its key and slot for Alt ↑ ↓ and Shift S.
    const links = [
      ...starred.matchAll(/<a data-tree-key="star:([^"]+)" tabindex="-1" data-star-key="([^"]+)" data-star-slot="(\d)" href="([^"]+)" class="([^"]+)"/g),
    ].map((m) => m.slice(1));
    expect(links).toEqual([
      ["screen:goals", "screen:goals", "0", "/?screen=goals", "item"],
      [PROJECT, PROJECT, "1", "/?screen=project&amp;projectId=PRJ-PORTAL-GOLIVE", "item"],
    ]);
    expect(starred).not.toContain("aria-current");
    // The item's own row is the one current row.
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain('href="/?screen=goals" class="item active" aria-current="page" title="Goals &amp; production"');
  });

  it("shows each copy's kind, the digit g opens it with, and an Unstar button out of the Tab order", () => {
    loaded(["screen:goals", PROJECT, "bucket:BKT-WMS"]);
    const starred = zone(sidebar({ screen: "home" }));
    // The icon rail's Starred button, then each copy's kind and its star.
    expect([...starred.matchAll(/class="lucide lucide-([a-z-]+)[^"]* ic"/g)].map((m) => m[1])).toEqual([
      "star",
      "target",
      "star",
      "folder-kanban",
      "star",
      "layers",
      "star",
    ]);
    expect([...starred.matchAll(/<span class="cnt key" title="g then (\d)"><span aria-hidden="true">(\d)<\/span><span class="vh">, g then (\d)<\/span><\/span>/g)].map((m) => m[1])).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(starred).toContain(
      '<button type="button" class="row-act star-act" tabindex="-1" aria-pressed="true" aria-label="Unstar Goals &amp; production" title="Unstar">'
    );
    expect(starred.match(/class="lucide lucide-grip-vertical grip"/g)).toHaveLength(3);
  });

  it("marks a closed, archived or gone star; a gone one has no digit and offers Remove", async () => {
    await goLive([closedProject(), archivedProject()]);
    loaded(["project:PRJ-DONE", "project:PRJ-OLD", "project:PRJ-GONE", "screen:goals"]);
    const starred = zone(sidebar({ screen: "home" }));
    expect([...starred.matchAll(/<div class="(tree-row star-row[^"]*)">/g)].map((m) => m[1])).toEqual([
      "tree-row star-row closed",
      "tree-row star-row archived",
      "tree-row star-row gone",
      "tree-row star-row",
    ]);
    expect(starred).toContain('<span class="nm">Done project<span class="mark"> · closed</span></span>');
    expect(starred).toContain('title="Archived project (archived)"');
    expect(starred).toContain('<span class="nm">PRJ-GONE<span class="mark"> · deleted</span></span>');
    // The gone star keeps slot 2, so Goals is still g 4.
    expect([...starred.matchAll(/title="g then (\d)"/g)].map((m) => m[1])).toEqual(["1", "2", "4"]);
    expect(starred).toContain(
      '<button type="button" class="row-act star-act" tabindex="-1" aria-label="Remove PRJ-GONE from Starred" title="Remove">'
    );
  });

  it("gives every sidebar row a star out of the Tab order, pressed when starred, except the Projects row's +", () => {
    loaded(["screen:goals", PROJECT]);
    const html = nav(sidebar({ screen: "home" }));
    expect(html).toContain(
      '<a data-tree-key="screen:board" tabindex="-1" data-star-key="screen:board" href="/?screen=board" class="item" title="All work">'
    );
    expect(html).toContain('<button type="button" class="row-act star-act star-toggle" aria-label="Star All work" aria-pressed="false" title="Star" tabindex="-1">');
    expect(html).toContain('aria-label="Star Goals &amp; production" aria-pressed="true" title="Unstar" tabindex="-1"');
    expect(html).toContain('aria-label="Star PLX Portal Go-Live" aria-pressed="true" title="Unstar" tabindex="-1"');
    expect(html).toContain('aria-label="Star WMS Integration" aria-pressed="false"');
    expect(html).not.toContain('aria-label="Star Projects"');
    // Every star in the sidebar stays out of the Tab order.
    expect(html.match(/class="row-act star-act[^"]*"[^>]*>/g)!.every((tag) => tag.includes('tabindex="-1"'))).toBe(true);
  });

  it("has no row stars in the default shell, or while Starred is off", async () => {
    loaded(["screen:goals"]);
    setNavZonesBuildFlag(false);
    expect(sidebar({ screen: "home" })).not.toContain("star-act");
    setNavZonesBuildFlag(true);
    __resetStarsForTests();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    __setStarsClientForTests({ ...client(), get: () => Promise.reject(new Error("503")) });
    loadStars();
    await vi.waitFor(() => expect(probe().off).toBe(true));
    expect(sidebar({ screen: "home" })).not.toContain("star-act");
    warn.mockRestore();
  });

  it("gives the icon rail one Starred button that opens the labelled drawer", () => {
    loaded(["screen:goals"]);
    expect(zone(sidebar({ screen: "home" }))).toContain(
      '<button type="button" class="item star-rail" data-tree-key="star-rail" tabindex="-1" title="Starred" aria-controls="mc-nav" aria-expanded="false">'
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

  it("has no top bar toggle on a deleted project's page, even with live data", async () => {
    await goLive();
    loaded(["project:PRJ-GONE"]);
    expect(topbar({ screen: "project", projectId: "PRJ-GONE" })).not.toContain("star-toggle");
  });

  it("says when the stars are full, and disables the toggle while they load", () => {
    loaded(TEN);
    expect(topbar({ screen: "insights" })).toContain('aria-pressed="false" title="Starred is full: unstar one to add another"');
    __resetStarsForTests();
    expect(topbar({ screen: "insights" })).toMatch(/aria-label="Star Insights" aria-pressed="false" title="Star" disabled=""/);
  });

  it("has no star toggle in the default shell", () => {
    loaded(["screen:goals"]);
    setNavZonesBuildFlag(false);
    expect(topbar({ screen: "goals" })).not.toContain("star-toggle");
  });

  it("opens the phone More sheet with Starred, as links with their kind that are never lit", () => {
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
    expect([...starred.matchAll(/class="lucide lucide-([a-z-]+)[^"]* ic"/g)].map((m) => m[1])).toEqual(["target", "folder-kanban"]);
    expect(starred).not.toContain("aria-current");
  });
});
