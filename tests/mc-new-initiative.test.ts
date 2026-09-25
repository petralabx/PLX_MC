// Wave 2 follow-up — e2e/new-initiative.spec.ts regression triage.
// (a) Late hydrate results (a failing /api/state, a late /api/viewer) must not
//     drop an optimistically created bucket or change where it routes.
// (b) The create modals' owner default follows the viewer as it resolves,
//     until the user explicitly picks (or clears) someone.
// (c) The bucket detail must render an owner outside the fixture roster (an
//     unresolved or unlisted viewer) instead of crashing the whole app.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { BucketDetail } from "@/components/mc/bucket-detail";
import { HUMANS, type Bucket } from "@/lib/mc-data";
import {
  __bucketCreateSettled,
  __setBucketCreateMirrorForTests,
  __setStateLoaderForTests,
  __setViewerLoaderForTests,
  activeNotices,
  addBucket,
  bucketById,
  dataSource,
  hydrate,
  ownerOrViewerDefault,
  resetStore,
  UNRESOLVED_VIEWER_ID,
  viewerId,
} from "@/lib/mc-data/store";

beforeEach(() => resetStore());

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("(a) an optimistic bucket vs. late hydrate results", () => {
  it("survives a failing state load and a late viewer load, and keeps its routing id", async () => {
    const stateLoad = deferred<never>();
    const viewerLoad = deferred<typeof HUMANS.vince>();
    const create = deferred<Bucket>();
    __setStateLoaderForTests(() => stateLoad.promise);
    __setViewerLoaderForTests(() => viewerLoad.promise);
    __setBucketCreateMirrorForTests(() => create.promise);

    const hydrating = hydrate(); // the modal opens before either load lands
    const created = addBucket({ name: "E2E Test Initiative" });
    expect(bucketById(created.id)?.name).toBe("E2E Test Initiative");

    stateLoad.reject(new Error("HTTP 500"));
    viewerLoad.resolve(HUMANS.vince);
    await hydrating;
    expect(dataSource()).toBe("offline");
    expect(viewerId()).toBe("vince");
    expect(bucketById(created.id)?.name).toBe("E2E Test Initiative");
    expect(created.id).toBe("BKT-E2E-TEST-INITIATIVE");

    // What the dormant e2e server actually does next: POST /api/buckets 403s
    // (no Entra session) and the create is rolled back with a notice — the same
    // on main; the spec only ever saw the bucket inside that window.
    create.reject(new Error("Authenticated session with Entra oid required."));
    await __bucketCreateSettled();
    expect(bucketById(created.id)).toBeUndefined();
    expect(activeNotices()[0].body).toContain("rolled back");
  });
});

describe("(b) owner default follows the viewer until an explicit pick", () => {
  it("tracks the viewer while untouched, and honours an explicit pick or clear", async () => {
    expect(ownerOrViewerDefault(undefined)).toBeNull(); // viewer not resolved yet

    __setViewerLoaderForTests(async () => HUMANS.vince);
    await hydrate();
    expect(ownerOrViewerDefault(undefined)).toBe("vince"); // follows the late viewer

    expect(ownerOrViewerDefault("greg")).toBe("greg"); // explicit pick wins
    expect(ownerOrViewerDefault(null)).toBeNull(); // explicit clear stays cleared
  });

  it("never defaults to an unlisted viewer (not assignable)", async () => {
    __setViewerLoaderForTests(async () => ({ ...HUMANS.greg, id: "jane@petrasoap.com", name: "Jane" }));
    await hydrate();
    expect(ownerOrViewerDefault(undefined)).toBeNull();
  });
});

describe("(c) bucket detail with an owner outside the roster", () => {
  it("renders the bucket instead of throwing", () => {
    const created = addBucket({ name: "Owned by nobody yet" });
    expect(created.owner).toBe(UNRESOLVED_VIEWER_ID);
    const html = renderToStaticMarkup(
      createElement(BucketDetail, { route: { screen: "bucket", bucketId: created.id }, nav: () => {} })
    );
    expect(html).toContain("Owned by nobody yet");
    expect(html).toContain(UNRESOLVED_VIEWER_ID);
  });
});
