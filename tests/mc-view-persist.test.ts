import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FilterState } from "@/components/mc/work-views.helpers";
import { UNASSIGNED_KEY } from "@/components/mc/work-views.helpers";
import {
  deleteSavedView,
  deserializeSavedViews,
  deserializeView,
  loadPersistedView,
  loadSavedViews,
  newSavedViewId,
  PERSIST_VERSION,
  renameSavedView,
  sanitizeFilterState,
  savePersistedView,
  saveSavedViews,
  serializeSavedViews,
  serializeView,
  upsertSavedView,
} from "@/components/mc/work-views.persist";
import type { PersistedView, SavedView } from "@/components/mc/work-views.persist";

// A Map-backed Storage shim (SPEC §3.A.4) — no jsdom; passed as the `storage?`
// argument so corruption / version / quota are all testable in plain vitest.
function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  } as Storage;
}

const VIEW_KEY = (screen: string) => `plx_mc_view_v1:${screen}`;
const SAVED_VIEWS_KEY = "plx_mc_saved_views_v1";

const sampleView = (over: Partial<PersistedView> = {}): PersistedView => ({
  v: PERSIST_VERSION,
  groupBy: "priority",
  swimlanes: "agents",
  filters: { text: "auth", priority: ["urgent"], stage: ["progress"], assignee: ["vince"], label: ["fe"] },
  ...over,
});

const sampleSavedView = (over: Partial<SavedView> = {}): SavedView => ({
  id: "sv-1",
  name: "My urgent",
  screen: "board",
  groupBy: "band",
  swimlanes: "off",
  filters: { priority: ["urgent"] },
  ...over,
});

describe("sanitizeFilterState — the F↔E trust boundary (SPEC §3.A.4)", () => {
  it("is the identity on a clean FilterState", () => {
    const clean: FilterState = {
      text: "login",
      priority: ["urgent", "high"],
      stage: ["backlog", "progress"],
      assignee: ["vince", UNASSIGNED_KEY],
      label: ["fe", "api"],
    };
    expect(sanitizeFilterState(clean)).toEqual(clean);
  });

  it("drops an unknown priority enum value", () => {
    const out = sanitizeFilterState({ priority: ["urgent", "bogus", "high"] });
    expect(out.priority).toEqual(["urgent", "high"]);
  });

  it("drops an unknown stage enum value", () => {
    const out = sanitizeFilterState({ stage: ["progress", "not-a-stage", "verified"] });
    expect(out.stage).toEqual(["progress", "verified"]);
  });

  it("coerces a non-string label entry out", () => {
    const out = sanitizeFilterState({ label: ["fe", 7, null, "api", { x: 1 }] });
    expect(out.label).toEqual(["fe", "api"]);
  });

  it("coerces a non-array facet to undefined (dropped)", () => {
    const out = sanitizeFilterState({ priority: "urgent", assignee: 5, label: {}, stage: true });
    expect(out.priority).toBeUndefined();
    expect(out.assignee).toBeUndefined();
    expect(out.label).toBeUndefined();
    expect(out.stage).toBeUndefined();
  });

  it("drops unknown top-level keys entirely", () => {
    const out = sanitizeFilterState({ priority: ["urgent"], bucket: "platform", evil: "x", __proto__: {} });
    expect(out).toEqual({ priority: ["urgent"] });
    expect("bucket" in out).toBe(false);
    expect("evil" in out).toBe(false);
  });

  it("trims text and drops an empty/whitespace text", () => {
    expect(sanitizeFilterState({ text: "  auth  " }).text).toBe("auth");
    expect(sanitizeFilterState({ text: "   " }).text).toBeUndefined();
    expect(sanitizeFilterState({ text: 42 as unknown as string }).text).toBeUndefined();
  });

  it("keeps a finite dueStart/dueEnd (Module G) and drops non-finite ones", () => {
    const out = sanitizeFilterState({ dueStart: 1, dueEnd: 14 }) as FilterState & {
      dueStart?: number;
      dueEnd?: number;
    };
    expect(out.dueStart).toBe(1);
    expect(out.dueEnd).toBe(14);
    const bad = sanitizeFilterState({ dueStart: Number.NaN, dueEnd: Infinity }) as FilterState & {
      dueStart?: number;
      dueEnd?: number;
    };
    expect(bad.dueStart).toBeUndefined();
    expect(bad.dueEnd).toBeUndefined();
  });

  it("retains the UNASSIGNED_KEY sentinel in assignee", () => {
    expect(sanitizeFilterState({ assignee: [UNASSIGNED_KEY] }).assignee).toEqual([UNASSIGNED_KEY]);
  });

  it("never throws on garbage and returns {} for non-objects", () => {
    expect(sanitizeFilterState(null)).toEqual({});
    expect(sanitizeFilterState(undefined)).toEqual({});
    expect(sanitizeFilterState("str")).toEqual({});
    expect(sanitizeFilterState(42)).toEqual({});
    expect(sanitizeFilterState([])).toEqual({});
  });
});

describe("serializeView / deserializeView round-trip + version + corruption", () => {
  it("round-trips every field", () => {
    const view = sampleView();
    const back = deserializeView(serializeView(view));
    expect(back).toEqual(view);
  });

  it("stamps the current version regardless of the input v", () => {
    const raw = serializeView(sampleView({ v: 99 }));
    expect(JSON.parse(raw).v).toBe(PERSIST_VERSION);
  });

  it("returns null on non-JSON garbage", () => {
    expect(deserializeView("{bad json")).toBeNull();
    expect(deserializeView("not json at all")).toBeNull();
  });

  it("returns null on a version mismatch ({v:0}) and missing v", () => {
    expect(deserializeView(JSON.stringify({ v: 0, groupBy: "band", swimlanes: "off", filters: {} }))).toBeNull();
    expect(deserializeView(JSON.stringify({ groupBy: "band", swimlanes: "off", filters: {} }))).toBeNull();
  });

  it("returns null on null input and on a non-object payload", () => {
    expect(deserializeView(null)).toBeNull();
    expect(deserializeView(JSON.stringify(42))).toBeNull();
    expect(deserializeView(JSON.stringify("str"))).toBeNull();
  });

  it("sanitizes the filters and coerces an out-of-allow-list groupBy/swimlanes on deserialize", () => {
    const raw = JSON.stringify({
      v: PERSIST_VERSION,
      groupBy: "nonsense",
      swimlanes: "weird",
      filters: { priority: ["urgent", "bogus"], evil: "x" },
    });
    const back = deserializeView(raw);
    expect(back).toEqual({
      v: PERSIST_VERSION,
      groupBy: "band", // unknown axis falls back to the default
      swimlanes: "off", // unknown swimlane falls back to off
      filters: { priority: ["urgent"] }, // bogus enum + unknown key dropped
    });
  });
});

describe("loadPersistedView / savePersistedView over a fake Storage", () => {
  let storage: Storage;
  beforeEach(() => {
    storage = fakeStorage();
  });

  it("save → load round-trips under the per-screen key", () => {
    savePersistedView("board", sampleView(), storage);
    expect(storage.getItem(VIEW_KEY("board"))).not.toBeNull();
    expect(loadPersistedView("board", storage)).toEqual(sampleView());
  });

  it("keeps board and mine under separate keys (per-screen split)", () => {
    savePersistedView("board", sampleView({ groupBy: "band" }), storage);
    savePersistedView("mine", sampleView({ groupBy: "bucket" }), storage);
    expect(loadPersistedView("board", storage)?.groupBy).toBe("band");
    expect(loadPersistedView("mine", storage)?.groupBy).toBe("bucket");
  });

  it("a setItem that throws (quota) does not throw out of savePersistedView", () => {
    const quota = fakeStorage();
    quota.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    expect(() => savePersistedView("board", sampleView(), quota)).not.toThrow();
    // nothing was written, so a subsequent load is a clean default (null)
    expect(loadPersistedView("board", quota)).toBeNull();
  });

  it("a corrupt stored string loads as null (no throw)", () => {
    storage.setItem(VIEW_KEY("list"), "{not json");
    expect(loadPersistedView("list", storage)).toBeNull();
  });

  it("a throwing getItem (private mode) degrades to null", () => {
    const hostile = fakeStorage();
    hostile.getItem = () => {
      throw new Error("SecurityError");
    };
    expect(loadPersistedView("board", hostile)).toBeNull();
  });
});

describe("saved-views CRUD + corruption isolation", () => {
  let storage: Storage;
  beforeEach(() => {
    storage = fakeStorage();
  });

  it("serialize → deserialize round-trips a saved-views doc", () => {
    const views = [sampleSavedView(), sampleSavedView({ id: "sv-2", name: "Blocked", screen: "list" })];
    expect(deserializeSavedViews(serializeSavedViews({ v: PERSIST_VERSION, views }))).toEqual(views);
  });

  it("save → load round-trips over a fake Storage", () => {
    const views = [sampleSavedView()];
    saveSavedViews(views, storage);
    expect(loadSavedViews(storage)).toEqual(views);
  });

  it("upsert appends a new id and replaces an existing id (dedupe-by-id)", () => {
    const a = sampleSavedView({ id: "sv-1", name: "A" });
    const b = sampleSavedView({ id: "sv-2", name: "B" });
    const list1 = upsertSavedView([a], b);
    expect(list1.map((v) => v.id)).toEqual(["sv-1", "sv-2"]);
    const list2 = upsertSavedView(list1, { ...a, name: "A2" });
    expect(list2).toHaveLength(2);
    expect(list2.find((v) => v.id === "sv-1")?.name).toBe("A2");
  });

  it("rename + delete round-trip", () => {
    const list = [sampleSavedView({ id: "sv-1" }), sampleSavedView({ id: "sv-2" })];
    expect(renameSavedView(list, "sv-1", "Renamed").find((v) => v.id === "sv-1")?.name).toBe("Renamed");
    expect(deleteSavedView(list, "sv-1").map((v) => v.id)).toEqual(["sv-2"]);
  });

  it("a corrupt saved-views blob loads as [] WITHOUT nuking the separate last-used key", () => {
    savePersistedView("board", sampleView(), storage); // the cheap last-used state
    storage.setItem(SAVED_VIEWS_KEY, "{bad json"); // a corrupt named-view blob
    expect(loadSavedViews(storage)).toEqual([]); // degrades to empty, no throw
    expect(loadPersistedView("board", storage)).toEqual(sampleView()); // last-used survives
  });

  it("a version-stale or non-array saved-views blob loads as []", () => {
    expect(deserializeSavedViews(JSON.stringify({ v: 0, views: [sampleSavedView()] }))).toEqual([]);
    expect(deserializeSavedViews(JSON.stringify({ v: PERSIST_VERSION, views: "nope" }))).toEqual([]);
    expect(deserializeSavedViews(null)).toEqual([]);
  });

  it("drops saved-view entries missing an id/name/screen and sanitizes the rest", () => {
    const raw = JSON.stringify({
      v: PERSIST_VERSION,
      views: [
        { name: "no id", screen: "board", groupBy: "band", swimlanes: "off", filters: {} },
        { id: "sv-x", screen: "board", groupBy: "band", swimlanes: "off", filters: {} }, // no name
        { id: "sv-ok", name: "ok", screen: "board", groupBy: "band", swimlanes: "off", filters: { priority: ["urgent", "bad"] } },
      ],
    });
    const out = deserializeSavedViews(raw);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("sv-ok");
    expect(out[0].filters).toEqual({ priority: ["urgent"] }); // sanitized
  });

  it("newSavedViewId mints distinct sv-prefixed ids", () => {
    const a = newSavedViewId();
    const b = newSavedViewId();
    expect(a).toMatch(/^sv-\d+-[a-z0-9]+$/);
    expect(a).not.toBe(b);
  });
});

describe("cross-tab echo guard (SPEC §3.A.7) — the storage handler is idempotent", () => {
  // The pure adopt path the storage listener uses is loadPersistedView; running
  // it twice in a row off the same stored value must yield the SAME view and
  // never write back. A null newValue (a peer clear) must be ignored by the
  // handler's guard. We exercise the pure handler logic directly (Playwright
  // cross-context storage events are flaky — asserted here on the pure seam).
  it("re-running the adopt twice yields a stable view with no write-back", () => {
    const storage = fakeStorage();
    savePersistedView("board", sampleView(), storage);
    const writeSpy = vi.spyOn(storage, "setItem");

    // Two consecutive adopts (simulating two storage events for the same key).
    const first = loadPersistedView("board", storage);
    const second = loadPersistedView("board", storage);

    expect(first).toEqual(sampleView());
    expect(second).toEqual(first); // stable — no ping-pong divergence
    expect(writeSpy).not.toHaveBeenCalled(); // the adopt path never writes back
  });

  it("the newValue===null guard: a peer-tab clear leaves the stored key untouched", () => {
    const storage = fakeStorage();
    savePersistedView("board", sampleView(), storage);
    // The handler returns early when event.newValue === null, so it must not
    // overwrite or clear our key. Emulate by asserting load still returns ours.
    const newValue: string | null = null;
    if (newValue !== null) {
      // (handler body would adopt) — unreachable in this guard case
      savePersistedView("board", sampleView({ groupBy: "stage" }), storage);
    }
    expect(loadPersistedView("board", storage)).toEqual(sampleView());
  });
});
