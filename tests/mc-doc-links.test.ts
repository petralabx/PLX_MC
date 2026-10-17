// Doc links: prd URLs become safe links; built-in PRD ids and
// anything that isn't http(s) do not (src/lib/mc-data/doc-links.ts).
import { describe, expect, it } from "vitest";

import { SHAREPOINT_REGISTERS, docLinkFromPrd, docLinkKind, normalizeBucketPrd } from "@/lib/mc-data/doc-links";

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

describe("docLinkKind", () => {
  const kind = (url: string) => docLinkKind(docLinkFromPrd(url)!);

  it("picks the task icon for a TASK-* page, the issue icon for a GitHub issue, else doc", () => {
    expect(kind("https://mc.plxcustomer.io/tasks/TASK-2181")).toBe("task");
    expect(kind("https://github.com/petralabx/PLX_MC/issues/341")).toBe("issue");
    expect(kind(SPEC)).toBe("doc");
    expect(kind("https://docs.example.com")).toBe("doc");
  });
});

describe("SHAREPOINT_REGISTERS", () => {
  it("lists the five registers once each, documents last as the library", () => {
    expect(SHAREPOINT_REGISTERS.map((r) => r.label)).toEqual([
      "Project Plan",
      "Roadmap",
      "Milestone Register",
      "Risk Register",
      "Project Documents",
    ]);
    expect(new Set(SHAREPOINT_REGISTERS.map((r) => r.key)).size).toBe(5);
    expect(SHAREPOINT_REGISTERS.filter((r) => r.source === "Library").map((r) => r.key)).toEqual(["documents"]);
  });
});
