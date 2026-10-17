// TASK-3176 — pages tier by <main>'s own width, not the viewport, so opening
// the nav, pane or live column re-tiers the page (design handoff, Shell).
import { describe, expect, it } from "vitest";

import { contentTier } from "@/components/mc/shell-prefs";

describe("contentTier", () => {
  it("puts each boundary width in the handoff's tier", () => {
    expect(contentTier(0)).toBe("phone");
    expect(contentTier(640)).toBe("phone");
    expect(contentTier(641)).toBe("tablet");
    expect(contentTier(1024)).toBe("tablet");
    expect(contentTier(1025)).toBe("desktop");
    expect(contentTier(1799)).toBe("desktop");
    expect(contentTier(1800)).toBe("ultra");
  });

  it("re-tiers the same viewport when the side nav takes room", () => {
    // 1200px viewport: rail closed vs the 240px sidebar beside main.
    expect(contentTier(1200)).toBe("desktop");
    expect(contentTier(1200 - 240)).toBe("tablet");
  });

  it("treats sub-pixel widths by their side of the boundary", () => {
    expect(contentTier(640.5)).toBe("tablet");
    expect(contentTier(1799.5)).toBe("desktop");
  });
});
