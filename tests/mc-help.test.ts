// Wave 6 — colleague UX: one user-facing vocabulary. The Help screen explains
// how Mission Control works and defines the words colleagues meet on screen.
// "Initiative" is the only user-facing name for what the code calls a bucket.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GLOSSARY, HOW_IT_WORKS } from "@/components/mc/help-content";
import { HelpView } from "@/components/mc/help";
import { routeToUrl, urlToRoute } from "@/components/mc/route";
import { SCREENS } from "@/components/mc/screens";
import { STAGES } from "@/lib/mc-data";

const TERMS = [
  "Task",
  "Initiative",
  "Project",
  "Stage",
  "PRD",
  "Evidence",
  "Accountable owner",
  "Checkout / MC-Checkout stamp",
  "Compliance gate",
  "Routing",
];

describe("Help glossary content", () => {
  it("defines every term a colleague meets, once each, in reading order", () => {
    expect(GLOSSARY.map((entry) => entry.term)).toEqual(TERMS);
  });

  it("lists the nine lifecycle stages straight from the data model, in order", () => {
    const stage = GLOSSARY.find((entry) => entry.term === "Stage");
    expect(stage?.list).toEqual(STAGES.map((s) => s.name));
    expect(stage?.list).toHaveLength(9);
    // The gated stages are named from STAGES too, so the copy can't drift.
    for (const gated of STAGES.filter((s) => s.gate)) {
      expect(stage?.definition).toContain(`${gated.gate} gate on ${gated.name}`);
    }
  });

  it("gives every term a plain-language definition that never says 'bucket'", () => {
    for (const entry of GLOSSARY) {
      expect(entry.definition.length, entry.term).toBeGreaterThan(40);
      expect(entry.definition.toLowerCase(), entry.term).not.toContain("bucket");
    }
  });

  it("keeps 'How Mission Control works' to a short, ordered sequence", () => {
    expect(HOW_IT_WORKS.length).toBeGreaterThanOrEqual(3);
    expect(HOW_IT_WORKS.length).toBeLessThanOrEqual(6);
  });
});

describe("Help screen", () => {
  it("is a registered, deep-linkable screen", () => {
    expect(SCREENS.help).toBe(HelpView);
    expect(routeToUrl({ screen: "help" })).toBe("/?screen=help");
    expect(urlToRoute("/?screen=help")).toEqual({ screen: "help" });
  });

  it("renders the how-it-works steps and the glossary as a definition list", () => {
    const html = renderToStaticMarkup(
      createElement(HelpView, { route: { screen: "help" }, nav: () => {} })
    );
    expect(html).toContain('data-testid="help-screen"');
    expect(html).toContain("How Mission Control works");
    expect(html).toContain("<dl");
    for (const term of TERMS) expect(html).toContain(`<dt>${term}</dt>`);
    for (const s of STAGES) expect(html).toContain(s.name);
    expect(html).not.toMatch(/bucket/i);
  });
});
