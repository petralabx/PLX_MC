// Wave 6 — colleague UX: one user-facing term ("Initiative", never "Bucket"),
// no raw env-flag text on screen, and engineering-only detail on /welcome kept
// out of a colleague's way. Code identifiers (bucketId, BKT-*) are unchanged.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import WelcomePage from "@/app/welcome/page";
import { CommandPalette } from "@/components/mc/command-palette";
import { RoutingInboxView } from "@/components/mc/routing-inbox";
import { resetRoutingInboxFlag, setRoutingInboxEnabled } from "@/components/mc/routing-inbox/flag";

afterEach(() => resetRoutingInboxFlag());

const noop = () => {};

describe("command palette vocabulary", () => {
  it("names initiatives, never buckets", () => {
    const html = renderToStaticMarkup(
      createElement(CommandPalette, {
        onClose: noop,
        nav: noop,
        onOpenNewTask: noop,
        onOpenNewInitiative: noop,
        onOpenNewProject: noop,
      })
    );
    expect(html).toContain("Initiative · ");
    expect(html).toContain(">Initiatives<");
    expect(html).not.toMatch(/bucket/i);
  });
});

describe("routing inbox copy", () => {
  it("explains a disabled inbox in plain words, without the env flag", () => {
    setRoutingInboxEnabled(false);
    const html = renderToStaticMarkup(
      createElement(RoutingInboxView, { route: { screen: "routing-inbox" }, nav: noop })
    );
    expect(html).toContain("Routing inbox is not enabled for this workspace.");
    expect(html).not.toContain("PLX_MC_");
    expect(html).not.toContain("≠");
  });

  it("calls the initiative queue Initiative-scoped", () => {
    setRoutingInboxEnabled(true);
    const html = renderToStaticMarkup(
      createElement(RoutingInboxView, { route: { screen: "routing-inbox" }, nav: noop })
    );
    expect(html).toContain("Initiative-scoped");
    expect(html).not.toContain("Bucket-scoped");
  });
});

describe("/welcome", () => {
  it("keeps MC-Checkout / dsp_ detail inside a collapsed 'For engineers' section", () => {
    const html = renderToStaticMarkup(createElement(WelcomePage));
    const start = html.indexOf('<details class="mc-welcome-details" data-testid="welcome-engineers"');
    expect(start).toBeGreaterThan(-1);
    const end = html.indexOf("</details>", start);
    const engineers = html.slice(start, end);
    expect(engineers).toContain("<summary>For engineers</summary>");
    expect(engineers).toContain("MC-Checkout: dsp_");
    // Collapsed by default: no `open` attribute on the element itself.
    expect(html.slice(start, html.indexOf(">", start))).not.toContain(" open");
    // Nothing engineering-only leaks outside it.
    const outside = html.slice(0, start) + html.slice(end);
    expect(outside).not.toContain("MC-Checkout");
    expect(outside).not.toContain("dsp_");
  });
});
