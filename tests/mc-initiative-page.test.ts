// TASK-3175 — Initiative (bucket) page redesign: the spec moves into the
// header kicker (no standalone "/ Spec" block), and Documents & links lists
// every bucket repo as a GitHub row after the five SharePoint registers.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { BucketDetail, docRowsForBucket, specForBucket } from "@/components/mc/bucket-detail";
import { addBucket, resetStore, updateBucket } from "@/lib/mc-data/store";

// The body of the first `@container main (max-width: 599px)` block in a stylesheet.
function phoneTier(file: string): string {
  const css = readFileSync(join(process.cwd(), "src/styles", file), "utf8");
  const start = css.indexOf("@container main (max-width: 599px)");
  expect(start).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("\n}\n", start));
}

beforeEach(() => resetStore());

function render(bucketId: string): string {
  return renderToStaticMarkup(
    createElement(BucketDetail, { route: { screen: "bucket", bucketId }, nav: () => {} })
  );
}

describe("specForBucket", () => {
  it("links an http(s) spec by its file name", () => {
    expect(specForBucket("https://github.com/petralabx/x/blob/main/docs/wms-uom.md")).toEqual({
      kind: "url",
      href: "https://github.com/petralabx/x/blob/main/docs/wms-uom.md",
      label: "wms-uom.md",
    });
  });

  it("treats a missing or non-URL value as no spec", () => {
    expect(specForBucket(null)).toEqual({ kind: "none" });
    expect(specForBucket("javascript:alert(1)")).toEqual({ kind: "none" });
  });
});

describe("docRowsForBucket", () => {
  it("lists the five registers, then one GitHub row per repo in order", () => {
    const rows = docRowsForBucket(["portal-web", "wms-sync"], (id) => `name:${id}`);
    expect(rows.map((r) => [r.label, r.source])).toEqual([
      ["Project Plan", "MS List"],
      ["Roadmap", "MS List"],
      ["Milestone Register", "MS List"],
      ["Risk Register", "MS List"],
      ["Project Documents", "Library"],
      ["name:portal-web", "GitHub"],
      ["name:wms-sync", "GitHub"],
    ]);
    expect(rows.filter((r) => r.source === "GitHub").every((r) => r.target === "repos")).toBe(true);
  });
});

describe("BucketDetail header", () => {
  it("puts the spec link in the kicker and drops the standalone Spec block", () => {
    const bucket = addBucket({ name: "Spec in header" });
    updateBucket(bucket.id, { prd: "https://example.com/specs/spec-in-header.md" });
    const html = render(bucket.id);
    expect(html).toContain(`Initiative · ${bucket.id}`);
    expect(html).toMatch(/<a[^>]*href="https:\/\/example\.com\/specs\/spec-in-header\.md"[^>]*target="_blank"/);
    expect(html).toContain("spec-in-header.md");
    expect(html).not.toContain("/ Spec");
  });

  it("offers + Add spec when the initiative has none", () => {
    const bucket = addBucket({ name: "No spec yet" });
    const html = render(bucket.id);
    expect(html).toContain("+ Add spec");
    expect(html).not.toContain('data-testid="bucket-spec-link"');
  });
});

describe("BucketDetail body", () => {
  it("renders tasks/discussion and the aside sections in two body columns", () => {
    const bucket = addBucket({ name: "Body layout" });
    const html = render(bucket.id);
    const main = html.indexOf('class="ini-main"');
    const aside = html.indexOf('class="ini-aside"');
    expect(main).toBeGreaterThan(-1);
    expect(aside).toBeGreaterThan(main);
    expect(html.slice(main, aside)).toContain("/ Discussion");
    for (const heading of ["/ Documents &amp; Links", "/ Milestones", "/ Risks", "/ Traceability"]) {
      expect(html.slice(aside)).toContain(heading);
    }
  });
});

describe("BucketDetail strip and tasks", () => {
  it("uses the shared overview strip (3-up facts) and the three-way task filter", () => {
    const bucket = addBucket({ name: "Shared parts" });
    const html = render(bucket.id);
    expect(html).toContain('data-testid="overview-strip"');
    expect(html).toContain("pv-strip-in cols-3");
    for (const label of ["Health", "Accountable owner", "Project", "Started", "Target"]) {
      expect(html).toContain(`<span class="k">${label}</span>`);
    }
    expect(html).toMatch(/0 tasks · 0 done · 0 cancelled · 0 in\s+flight · <span class="">0 blocked<\/span>/);
    expect(html).toContain('aria-label="Task filter"');
    expect(html).toContain("No tasks in this initiative yet.");
  });
});

describe("Owner picker at the phone tier", () => {
  // .ppick is 284px wide; anchored at the owner cell (column 2 of 3) it ran
  // past a 390px viewport. It anchors to the facts zone's left edge instead.
  it("anchors the strip's owner picker to the facts zone and caps its width", () => {
    const block = phoneTier("mc-overview.css");
    expect(block).toMatch(/\.mc \.pv-facts \{\s*position: relative;/);
    expect(block).toMatch(/\.mc \.pv-strip \.pv-owner \{\s*position: static;/);
    expect(block).toMatch(/\.mc \.pv-strip \.ppick \{\s*min-width: min\(284px, 100%\);/);
  });
});
