// Pure-function tests for the task kind taxonomy (TASK-2634).
import { describe, expect, it } from "vitest";
import {
  TASK_KINDS, TASK_KIND_DEFAULT, createLabelsWithKind, kindsOf, normalizeKindLabels, withKind,
} from "@/lib/tasks/kind";

const opts = { defaultKind: TASK_KIND_DEFAULT };

describe("task kind taxonomy", () => {
  it("exposes the six kinds and a needs-review default that is one of them", () => {
    expect(TASK_KINDS).toEqual(["code", "admin-setup", "human-test", "decision", "blocked-external", "needs-review"]);
    expect(TASK_KIND_DEFAULT).toBe("kind:needs-review");
  });

  it("kindsOf returns only kind:* labels", () => {
    expect(kindsOf(["lane:dev", "kind:code", "api"])).toEqual(["kind:code"]);
    expect(kindsOf([])).toEqual([]);
  });
});

describe("normalizeKindLabels", () => {
  it("adds the default when no kind is present", () => {
    expect(normalizeKindLabels(["lane:dev"], opts)).toEqual(["lane:dev", "kind:needs-review"]);
    expect(normalizeKindLabels([], opts)).toEqual(["kind:needs-review"]);
  });

  it("keeps an existing kind as-is", () => {
    expect(normalizeKindLabels(["kind:code", "api"], opts)).toEqual(["kind:code", "api"]);
  });

  it("rejects two kinds, including the same kind spelled two ways only when they differ", () => {
    expect(() => normalizeKindLabels(["kind:code", "kind:decision"], opts))
      .toThrowError(expect.objectContaining({ code: "invalid_request", status: 400 }));
    expect(normalizeKindLabels(["kind:code", " KIND:Code "], opts)).toEqual(["kind:code"]);
  });

  it("rejects a kind outside the taxonomy", () => {
    expect(() => normalizeKindLabels(["kind:banana"], opts))
      .toThrowError(expect.objectContaining({ code: "invalid_request", status: 400 }));
  });

  it("trims and lowercases labels and drops blanks", () => {
    expect(normalizeKindLabels(["  KIND:Code ", "  ", "API"], opts)).toEqual(["kind:code", "api"]);
  });
});

describe("createLabelsWithKind", () => {
  it("defaults when neither labels nor kind is given", () => {
    expect(createLabelsWithKind(undefined)).toEqual(["kind:needs-review"]);
  });

  it("merges the kind param, and tolerates a matching kind label", () => {
    expect(createLabelsWithKind(["api"], "code")).toEqual(["api", "kind:code"]);
    expect(createLabelsWithKind(["kind:code"], "code")).toEqual(["kind:code"]);
  });

  it("rejects a kind param that disagrees with a kind label", () => {
    expect(() => createLabelsWithKind(["kind:decision"], "code"))
      .toThrowError(expect.objectContaining({ code: "invalid_request", status: 400 }));
  });
});

describe("withKind", () => {
  it("replaces any existing kind", () => {
    expect(withKind(["a", "kind:code", "b"], "kind:decision")).toEqual(["a", "b", "kind:decision"]);
  });
});
