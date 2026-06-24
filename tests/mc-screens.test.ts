// Screen-registry contract (PR-D1). The SCREENS map is `Record<Screen, ...>`,
// so a missing entry already fails `tsc`; these tests lock the runtime shape —
// every Screen is registered, and the new "mine" view reuses WorkViews rather
// than forking a component (SPEC §5 Module D1).
import { describe, expect, it } from "vitest";

import type { Screen } from "@/components/mc/route";
import { SCREENS } from "@/components/mc/screens";

// The exhaustive set of screens. The `satisfies Record<Screen, true>` makes the
// compiler reject this test the moment a Screen is added/removed without
// updating the list — the runtime exhaustiveness assertion below stays honest.
const EXPECTED_SCREENS = {
  home: true,
  board: true,
  list: true,
  timeline: true,
  mine: true,
  insights: true,
  matrix: true,
  feed: true,
  bucket: true,
  repos: true,
  files: true,
  sync: true,
  intake: true,
  task: true,
  "loop-ledgers": true,
  "governance-sops": true,
} satisfies Record<Screen, true>;

describe("SCREENS registry (PR-D1)", () => {
  it("registers a component for every Screen — no gaps, no extras", () => {
    const expected = Object.keys(EXPECTED_SCREENS).sort();
    expect(Object.keys(SCREENS).sort()).toEqual(expected);
    for (const key of expected) {
      expect(SCREENS[key as Screen]).toBeTypeOf("function");
    }
  });

  it("includes the new My Tasks screen", () => {
    expect(Object.keys(SCREENS)).toContain("mine");
    expect(SCREENS.mine).toBeDefined();
  });

  it("routes My Tasks through the SAME WorkViews component as Board/List (reuse, not a fork)", () => {
    // board/list/timeline all render WorkViews; `mine` must be the identical
    // component reference, proving D1 reuses the board/list surface.
    expect(SCREENS.mine).toBe(SCREENS.board);
    expect(SCREENS.mine).toBe(SCREENS.list);
    expect(SCREENS.mine).toBe(SCREENS.timeline);
  });
});
