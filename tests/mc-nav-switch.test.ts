// The "Try the new navigation" switch and its one-screen tour (TASK-3855):
// who sees the zoned sidebar (the build flag, else the person's switch, else
// this browser's by-hand opt-in), the read from the server and this browser's
// copy of it, a flip that shows at once and is then saved in order, a refused
// save put back to what the server last confirmed, with a notice, answers and
// other tabs' writes that arrive after a newer change, the tour the first time
// the switch is on, and Switch back. The store is driven directly with a
// stand-in API and window (vitest runs in Node); the tour's markup is rendered
// with renderToStaticMarkup.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ADMIN_FLYOUT, ZONED_NAV_GROUPS } from "@/components/mc/nav-model";
import { NavTour, TOUR_POINTS } from "@/components/mc/nav-tour";
import {
  NAV_ZONES_STORAGE_KEY,
  __navPrefsSettled,
  __resetNavZonesForTests,
  __setNavPrefsClientForTests,
  closeNavTour,
  loadNavPrefs,
  navZonesStore,
  setNavSwitch,
  setNavZonesBuildFlag,
} from "@/components/mc/nav-zones";
import { ApiClientError } from "@/lib/api";
import { activeNotices, resetStore } from "@/lib/mc-data/store";
import type { NavPrefs, NavPrefsChange } from "@/lib/nav-prefs";

// A promise the test settles by hand.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const storage = new Map<string, string>();
let onStorage: ((event: { key: string | null }) => void) | null = null;
let gets: ReturnType<typeof deferred<NavPrefs>>[] = [];
let changes: { change: NavPrefsChange; answer: ReturnType<typeof deferred<NavPrefs>> }[] = [];

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const zoned = () => navZonesStore.zoned();
const tour = () => navZonesStore.tourShown();
const kept = () => storage.get(NAV_ZONES_STORAGE_KEY);
// Another tab of this browser writes the copy, and this tab hears it.
const otherTab = (value: string) => {
  storage.set(NAV_ZONES_STORAGE_KEY, value);
  onStorage?.({ key: NAV_ZONES_STORAGE_KEY });
};

beforeEach(() => {
  storage.clear();
  gets = [];
  changes = [];
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    },
    addEventListener: (type: string, listener: (event: { key: string | null }) => void) => {
      if (type === "storage") onStorage = listener;
    },
    removeEventListener: () => {
      onStorage = null;
    },
  });
  __setNavPrefsClientForTests({
    get: () => {
      const answer = deferred<NavPrefs>();
      gets.push(answer);
      return answer.promise;
    },
    change: (change) => {
      const answer = deferred<NavPrefs>();
      changes.push({ change, answer });
      return answer.promise;
    },
  });
  setNavZonesBuildFlag(false);
  __resetNavZonesForTests();
  resetStore();
});

afterEach(() => {
  __setNavPrefsClientForTests(null);
  __resetNavZonesForTests();
  vi.unstubAllGlobals();
});

describe("who sees the zoned sidebar", () => {
  it.each([
    [undefined, false],
    ["on", true],
    ["off", false],
    ["1", true],
    ["yes", false],
  ])("follows this browser's copy %s before the server answers", (value, shows) => {
    if (value !== undefined) storage.set(NAV_ZONES_STORAGE_KEY, value);
    expect(zoned()).toBe(shows);
  });

  it("shows it for the whole build with the build flag, reads nothing and opens no tour", () => {
    storage.set(NAV_ZONES_STORAGE_KEY, "off");
    setNavZonesBuildFlag(true);
    expect(zoned()).toBe(true);
    loadNavPrefs();
    expect(gets).toHaveLength(0);
    expect(tour()).toBe(false);
  });

  it("starts with the default when storage is blocked", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
      },
    });
    expect(zoned()).toBe(false);
  });
});

describe("reading the person's switch", () => {
  it("adopts the server's switch and keeps a copy for the next load, once per page", async () => {
    storage.set(NAV_ZONES_STORAGE_KEY, "off");
    loadNavPrefs();
    loadNavPrefs();
    expect(gets).toHaveLength(1);
    gets[0].resolve({ zones: true, tourSeen: true });
    await flush();
    expect(zoned()).toBe(true);
    expect(kept()).toBe("on");
    expect(tour()).toBe(false);
  });

  it("switches back on this device when the person switched back on another", async () => {
    storage.set(NAV_ZONES_STORAGE_KEY, "on");
    loadNavPrefs();
    gets[0].resolve({ zones: false, tourSeen: true });
    await flush();
    expect(zoned()).toBe(false);
    expect(kept()).toBe("off");
  });

  it("drops a copy the server does not hold: another person signed in on this browser", async () => {
    storage.set(NAV_ZONES_STORAGE_KEY, "on");
    expect(zoned()).toBe(true);
    loadNavPrefs();
    gets[0].resolve({ zones: null, tourSeen: false });
    await flush();
    expect(zoned()).toBe(false);
    expect(kept()).toBeUndefined();
    expect(tour()).toBe(false);
  });

  it("keeps a by-hand opt-in for a person who never used the switch, with no tour", async () => {
    storage.set(NAV_ZONES_STORAGE_KEY, "1");
    loadNavPrefs();
    gets[0].resolve({ zones: null, tourSeen: false });
    await flush();
    expect(zoned()).toBe(true);
    expect(kept()).toBe("1");
    expect(tour()).toBe(false);
  });

  it("puts the person's switch before a by-hand opt-in", async () => {
    storage.set(NAV_ZONES_STORAGE_KEY, "1");
    loadNavPrefs();
    gets[0].resolve({ zones: false, tourSeen: true });
    await flush();
    expect(zoned()).toBe(false);
    expect(kept()).toBe("off");
  });

  it("opens the tour when the switch is on and the tour still unseen", async () => {
    loadNavPrefs();
    gets[0].resolve({ zones: true, tourSeen: false });
    await flush();
    expect(zoned()).toBe(true);
    expect(tour()).toBe(true);
  });

  it("keeps this browser's copy when the read fails, and reads again on the next call", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    storage.set(NAV_ZONES_STORAGE_KEY, "on");
    loadNavPrefs();
    gets[0].reject(new Error("offline"));
    await flush();
    expect(zoned()).toBe(true);
    expect(warn).toHaveBeenCalled();
    // The shell calls it again on window focus.
    loadNavPrefs();
    expect(gets).toHaveLength(2);
    gets[1].resolve({ zones: false, tourSeen: true });
    await flush();
    expect(zoned()).toBe(false);
    warn.mockRestore();
  });

  it("does not undo a flip made while it was in flight", async () => {
    loadNavPrefs();
    setNavSwitch(true);
    gets[0].resolve({ zones: false, tourSeen: false });
    await flush();
    expect(zoned()).toBe(true);
    expect(kept()).toBe("on");
  });

  it("learns what the server held from a read a flip overtook, and a refused flip goes back to it", async () => {
    // A new device: no copy yet, and the server holds the switch on.
    loadNavPrefs();
    setNavSwitch(false);
    gets[0].resolve({ zones: true, tourSeen: true });
    await flush();
    expect(zoned()).toBe(false);
    changes[0].answer.reject(new Error("HTTP 500"));
    await __navPrefsSettled();
    expect(zoned()).toBe(true);
    expect(kept()).toBe("on");
  });

  it("keeps a save confirmed after the read began over the read's older answer", async () => {
    loadNavPrefs();
    setNavSwitch(true);
    await flush();
    changes[0].answer.resolve({ zones: true, tourSeen: false });
    await flush();
    gets[0].resolve({ zones: false, tourSeen: false });
    await flush();
    setNavSwitch(false);
    await flush();
    changes[1].answer.reject(new Error("HTTP 500"));
    await __navPrefsSettled();
    expect(zoned()).toBe(true);
  });

  it("does not read again on focus after a refusal", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    loadNavPrefs();
    gets[0].reject(new ApiClientError("forbidden", "Authenticated session with Entra oid required."));
    await flush();
    loadNavPrefs();
    expect(gets).toHaveLength(1);
    warn.mockRestore();
  });

  it("does not undo a flip made while it was in flight when storage is blocked", async () => {
    const blocked = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("window", {
      localStorage: { getItem: blocked, setItem: blocked, removeItem: blocked },
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    loadNavPrefs();
    setNavSwitch(true);
    gets[0].resolve({ zones: false, tourSeen: false });
    await flush();
    expect(zoned()).toBe(true);
  });

  it("leaves another tab's newer write alone, heard yet or not", async () => {
    const stop = navZonesStore.subscribe(() => {});
    loadNavPrefs();
    otherTab("on");
    expect(zoned()).toBe(true);
    gets[0].resolve({ zones: false, tourSeen: false });
    await flush();
    expect(zoned()).toBe(true);
    expect(kept()).toBe("on");
    stop();
    // Not heard yet: the read still finds the copy changed, and writes nothing.
    __resetNavZonesForTests();
    storage.delete(NAV_ZONES_STORAGE_KEY);
    loadNavPrefs();
    storage.set(NAV_ZONES_STORAGE_KEY, "on");
    gets[1].resolve({ zones: false, tourSeen: false });
    await flush();
    expect(kept()).toBe("on");
  });
});

describe("the switch", () => {
  it("turns the new navigation on at once, opens the tour the first time, and saves", async () => {
    const told = vi.fn();
    const stop = navZonesStore.subscribe(told);
    expect(setNavSwitch(true)).toBe(true);
    expect(zoned()).toBe(true);
    expect(kept()).toBe("on");
    expect(tour()).toBe(true);
    expect(told).toHaveBeenCalled();
    await flush();
    expect(changes.map((c) => c.change)).toEqual([{ zones: true }]);
    changes[0].answer.resolve({ zones: true, tourSeen: false });
    await __navPrefsSettled();
    expect(zoned()).toBe(true);
    expect(tour()).toBe(true);
    stop();
  });

  it("opens no tour once the person has seen it", async () => {
    loadNavPrefs();
    gets[0].resolve({ zones: false, tourSeen: true });
    await flush();
    expect(setNavSwitch(true)).toBe(false);
    expect(zoned()).toBe(true);
    expect(tour()).toBe(false);
  });

  it("switches back: the default shell at once, the tour closed, and saved in order", async () => {
    setNavSwitch(true);
    setNavSwitch(false);
    expect(zoned()).toBe(false);
    expect(kept()).toBe("off");
    expect(tour()).toBe(false);
    await flush();
    changes[0].answer.resolve({ zones: true, tourSeen: false });
    await flush();
    // The saves go in order: the second waits for the first.
    expect(changes.map((c) => c.change)).toEqual([{ zones: true }, { zones: false }]);
    expect(zoned()).toBe(false);
    changes[1].answer.resolve({ zones: false, tourSeen: false });
    await __navPrefsSettled();
    expect(zoned()).toBe(false);
  });

  it("puts a refused flip back, says so, and keeps the next load right", async () => {
    setNavSwitch(true);
    await flush();
    changes[0].answer.reject(new Error("Database unavailable."));
    await __navPrefsSettled();
    expect(zoned()).toBe(false);
    expect(kept()).toBeUndefined();
    expect(tour()).toBe(false);
    expect(activeNotices().map((n) => n.body)).toEqual([
      "Couldn't save the navigation switch. Database unavailable. Your navigation is as it was.",
    ]);
  });

  it("puts a refused switch-back back to a by-hand opt-in", async () => {
    storage.set(NAV_ZONES_STORAGE_KEY, "1");
    setNavSwitch(false);
    expect(zoned()).toBe(false);
    await flush();
    changes[0].answer.reject(new Error("HTTP 500"));
    await __navPrefsSettled();
    expect(zoned()).toBe(true);
    expect(kept()).toBe("1");
  });

  it("goes back to what the server last confirmed when two flips are refused", async () => {
    setNavSwitch(true);
    setNavSwitch(false);
    await flush();
    // The first is older than the second, so it changes nothing on its own.
    changes[0].answer.reject(new Error("HTTP 500"));
    await flush();
    expect(zoned()).toBe(false);
    changes[1].answer.reject(new Error("HTTP 500"));
    await __navPrefsSettled();
    // Never stored: not the first flip's on, but the copy from before both.
    expect(zoned()).toBe(false);
    expect(kept()).toBeUndefined();
    expect(activeNotices()).toHaveLength(1);
  });

  it("goes back to a confirmed flip when only the later one is refused", async () => {
    setNavSwitch(true);
    setNavSwitch(false);
    await flush();
    changes[0].answer.resolve({ zones: true, tourSeen: false });
    await flush();
    changes[1].answer.reject(new Error("HTTP 500"));
    await __navPrefsSettled();
    expect(zoned()).toBe(true);
    expect(kept()).toBe("on");
  });

  it("keeps saving after a save that went wrong past its own handling", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let boom = false;
    const stop = navZonesStore.subscribe(() => {
      if (boom) {
        boom = false;
        throw new Error("a listener broke");
      }
    });
    setNavSwitch(true);
    await flush();
    boom = true;
    changes[0].answer.reject(new Error("HTTP 500"));
    await __navPrefsSettled();
    expect(error).toHaveBeenCalled();
    setNavSwitch(false);
    await flush();
    expect(changes.map((c) => c.change)).toEqual([{ zones: true }, { zones: false }]);
    stop();
    error.mockRestore();
  });

  it("follows another tab's flip, and another tab's write does not cancel this tab's undo", async () => {
    const stop = navZonesStore.subscribe(() => {});
    otherTab("on");
    expect(zoned()).toBe(true);
    // Other keys are not the switch.
    storage.set(NAV_ZONES_STORAGE_KEY, "off");
    onStorage?.({ key: "mc.nav.recents" });
    expect(zoned()).toBe(true);
    otherTab("on");
    setNavSwitch(false);
    await flush();
    otherTab("off");
    changes[0].answer.reject(new Error("HTTP 500"));
    await __navPrefsSettled();
    expect(activeNotices()).toHaveLength(1);
    expect(zoned()).toBe(false);
    stop();
    expect(onStorage).toBeNull();
  });
});

describe("the tour", () => {
  it("Got it closes it and records it, and the new navigation stays", async () => {
    setNavSwitch(true);
    closeNavTour();
    expect(tour()).toBe(false);
    expect(zoned()).toBe(true);
    await flush();
    changes[0].answer.resolve({ zones: true, tourSeen: false });
    await flush();
    expect(changes.map((c) => c.change)).toEqual([{ zones: true }, { tourSeen: true }]);
    changes[1].answer.resolve({ zones: true, tourSeen: true });
    await __navPrefsSettled();
    // Seen: switching off and on again opens no tour.
    setNavSwitch(false);
    setNavSwitch(true);
    expect(tour()).toBe(false);
  });

  it("Switch back closes it, shows the default shell and saves both", async () => {
    setNavSwitch(true);
    closeNavTour({ switchBack: true });
    expect(tour()).toBe(false);
    expect(zoned()).toBe(false);
    expect(kept()).toBe("off");
    await flush();
    changes[0].answer.resolve({ zones: true, tourSeen: false });
    await flush();
    expect(changes.map((c) => c.change)).toEqual([{ zones: true }, { zones: false, tourSeen: true }]);
  });

  it("a refused Switch back keeps the new navigation and the tour unseen", async () => {
    setNavSwitch(true);
    closeNavTour({ switchBack: true });
    await flush();
    changes[0].answer.resolve({ zones: true, tourSeen: false });
    await flush();
    changes[1].answer.reject(new Error("HTTP 500"));
    await __navPrefsSettled();
    expect(zoned()).toBe(true);
    expect(tour()).toBe(false);
    expect(activeNotices()).toHaveLength(1);
    // The server never heard it was seen, so the next time on shows it again.
    setNavSwitch(false);
    setNavSwitch(true);
    expect(tour()).toBe(true);
  });

  it("a refused Got it keeps the tour closed, only warns, and leaves it unseen", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    storage.set(NAV_ZONES_STORAGE_KEY, "1");
    closeNavTour();
    await flush();
    changes[0].answer.reject(new Error("offline"));
    await __navPrefsSettled();
    expect(tour()).toBe(false);
    expect(zoned()).toBe(true);
    expect(activeNotices()).toEqual([]);
    expect(warn).toHaveBeenCalled();
    setNavSwitch(false);
    setNavSwitch(true);
    expect(tour()).toBe(true);
    warn.mockRestore();
  });

  it("closes a tour opened before the server said it was seen: by the read or by the save", async () => {
    loadNavPrefs();
    setNavSwitch(true);
    expect(tour()).toBe(true);
    gets[0].resolve({ zones: false, tourSeen: true });
    await flush();
    expect(tour()).toBe(false);
    expect(zoned()).toBe(true);
    __resetNavZonesForTests();
    setNavSwitch(true);
    expect(tour()).toBe(true);
    await flush();
    changes.at(-1)!.answer.resolve({ zones: true, tourSeen: true });
    await __navPrefsSettled();
    expect(tour()).toBe(false);
  });

  it("is one dialog: each zone, where the switch is, Switch back and Got it", () => {
    const html = renderToStaticMarkup(createElement(NavTour));
    expect(html).toMatch(/role="dialog" aria-modal="true" aria-labelledby="mc-nav-tour-h"/);
    expect(html).toContain('<h2 id="mc-nav-tour-h">Here is what <em>moved</em></h2>');
    for (const point of TOUR_POINTS) expect(html).toContain(`<b>${point.zone.replace("&", "&amp;")}</b>`);
    expect(html).toContain("Switch back at any time from the account menu.");
    expect(html).toMatch(/<button type="button" class="btn ghost">Switch back<\/button>/);
    expect(html).toMatch(/<button type="button" class="btn acc" data-autofocus="true">Got it<\/button>/);
  });

  it("names the sidebar's zones in their order, and only labels the sidebar has", () => {
    expect(TOUR_POINTS.map((p) => p.zone)).toEqual(["My work", "Starred", "Plan", "Reporting", "Admin & health", "Search"]);
    // My work, Plan and Reporting keep the sidebar's order.
    const groups = ZONED_NAV_GROUPS.map((g) => g.label);
    expect(groups.indexOf("My work")).toBeLessThan(groups.indexOf("Plan"));
    expect(groups.indexOf("Plan")).toBeLessThan(groups.indexOf("Reporting"));
    for (const point of TOUR_POINTS) {
      const group = ZONED_NAV_GROUPS.find((g) => g.label === point.zone);
      const real =
        point.zone === "Admin & health" ? ADMIN_FLYOUT.map((s) => s.label) : (group?.items.map((i) => i.label) ?? []);
      for (const label of point.labels) {
        expect(real, `${point.zone}: ${label}`).toContain(label);
        expect(point.text).toContain(label);
      }
    }
  });
});
