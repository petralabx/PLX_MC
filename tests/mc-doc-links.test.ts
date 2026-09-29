// Project / bucket doc links: prd URLs become safe links; built-in PRD ids and
// anything that isn't http(s) do not (src/lib/mc-data/doc-links.ts).
import { describe, expect, it } from "vitest";

import { docLinkFromPrd, normalizeBucketPrd, projectDocLinks } from "@/lib/mc-data/doc-links";

const SPEC =
  "https://github.com/petralabx/plx-customer-portal/blob/staging/docs/projects/cos-companion/DESKTOP-SPEC.md";

describe("docLinkFromPrd", () => {
  it("turns an https URL into a link labelled with the file name", () => {
    expect(docLinkFromPrd(SPEC)).toEqual({ href: SPEC, label: "DESKTOP-SPEC.md" });
  });

  it("accepts http and trims whitespace", () => {
    expect(docLinkFromPrd("  http://example.com/a/b.md  ")).toEqual({
      href: "http://example.com/a/b.md",
      label: "b.md",
    });
  });

  it("labels a bare host or trailing slash sensibly", () => {
    expect(docLinkFromPrd("https://docs.example.com")?.label).toBe("docs.example.com");
    expect(docLinkFromPrd("https://example.com/specs/")?.label).toBe("specs");
  });

  it("decodes the label and survives malformed escapes", () => {
    expect(docLinkFromPrd("https://example.com/My%20Spec.md")?.label).toBe("My Spec.md");
    expect(docLinkFromPrd("https://example.com/bad%E0%A4%A.md")?.label).toBe("bad%E0%A4%A.md");
  });

  it("is not a link for built-in PRD ids, empty values or unsafe schemes", () => {
    for (const prd of [
      null,
      undefined,
      "",
      "   ",
      "PRD-BKT-SHOP",
      "javascript:alert(1)",
      "data:text/html,<b>x</b>",
      "file:///etc/passwd",
      "mailto:someone@example.com",
      "not a url",
    ]) {
      expect(docLinkFromPrd(prd)).toBeNull();
    }
  });
});

describe("normalizeBucketPrd", () => {
  it("stores an http(s) URL and clears a blank value", () => {
    expect(normalizeBucketPrd("  https://example.com/prd.md  ")).toEqual({
      ok: true,
      value: "https://example.com/prd.md",
    });
    expect(normalizeBucketPrd("")).toEqual({ ok: true, value: null });
    expect(normalizeBucketPrd(null)).toEqual({ ok: true, value: null });
    expect(normalizeBucketPrd(undefined)).toEqual({ ok: true, value: undefined });
  });

  it("rejects a bare id and an unsafe scheme", () => {
    expect(normalizeBucketPrd("PRD-001")).toEqual({ ok: false });
    expect(normalizeBucketPrd("javascript:alert(1)")).toEqual({ ok: false });
  });
});

describe("projectDocLinks", () => {
  const project = { id: "PRJ-COS-COMPANION", name: "COS Companion", prd: null };

  it("is empty when nothing links a doc (the block stays hidden)", () => {
    expect(projectDocLinks(project, [{ id: "BKT-A", name: "A", prd: null }])).toEqual([]);
  });

  it("lists the project link first, then buckets in the given order, skipping non-links", () => {
    const links = projectDocLinks({ ...project, prd: "https://example.com/README.md" }, [
      { id: "BKT-DESKTOP-SHELL", name: "Desktop shell", prd: SPEC },
      { id: "BKT-PWA-SPIKE", name: "PWA spike", prd: null },
      { id: "BKT-LEGACY", name: "Legacy", prd: "PRD-LEGACY" },
      { id: "BKT-UAT", name: "UAT", prd: "https://example.com/UAT-PLAN.md" },
    ]);
    expect(links.map((l) => [l.scope, l.scopeId, l.scopeName, l.label])).toEqual([
      ["project", "PRJ-COS-COMPANION", "COS Companion", "README.md"],
      ["bucket", "BKT-DESKTOP-SHELL", "Desktop shell", "DESKTOP-SPEC.md"],
      ["bucket", "BKT-UAT", "UAT", "UAT-PLAN.md"],
    ]);
  });
});
