// Pure-helper tests for the shared LabelEditor (used by the New Task modal and
// task detail). The component itself is presentational; its normalize/add/remove
// rules are exported so the contract is verified without rendering React (the
// repo's tests are pure-function/store only — vitest.config.ts has no DOM env).
import { describe, expect, it } from "vitest";

import { addLabelTo, normalizeLabel, removeLabelFrom } from "@/components/mc/label-editor";

describe("normalizeLabel", () => {
  it("trims surrounding whitespace and lowercases", () => {
    expect(normalizeLabel("  Go-Live ")).toBe("go-live");
    expect(normalizeLabel("API")).toBe("api");
  });

  it("collapses a blank/whitespace-only draft to the empty string", () => {
    expect(normalizeLabel("   ")).toBe("");
    expect(normalizeLabel("")).toBe("");
  });
});

describe("addLabelTo", () => {
  it("appends a normalized label", () => {
    expect(addLabelTo(["api"], " Finance ")).toEqual(["api", "finance"]);
  });

  it("returns the SAME array reference for a blank draft (cheap no-op detect)", () => {
    const labels = ["api"];
    expect(addLabelTo(labels, "   ")).toBe(labels);
  });

  it("returns the SAME array reference when the (normalized) label already exists", () => {
    const labels = ["api", "go-live"];
    expect(addLabelTo(labels, "API")).toBe(labels);
    expect(addLabelTo(labels, "go-live")).toBe(labels);
  });

  it("replaces an existing kind:* label instead of appending a second one", () => {
    expect(addLabelTo(["api", "kind:needs-review"], " Kind:Code ")).toEqual(["api", "kind:code"]);
  });

  it("returns the same reference when the kind is already set", () => {
    const labels = ["kind:code"];
    expect(addLabelTo(labels, "kind:code")).toBe(labels);
  });

  it("does not mutate the input array", () => {
    const labels = ["api"];
    addLabelTo(labels, "finance");
    expect(labels).toEqual(["api"]);
  });
});

describe("removeLabelFrom", () => {
  it("removes the matching label and leaves the rest in order", () => {
    expect(removeLabelFrom(["api", "go-live", "finance"], "go-live")).toEqual(["api", "finance"]);
  });

  it("is a no-op (by value) when the label is absent", () => {
    expect(removeLabelFrom(["api"], "missing")).toEqual(["api"]);
  });
});
