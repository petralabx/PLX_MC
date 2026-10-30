import { describe, expect, it } from "vitest";

import { routeToUrl, urlToRoute } from "../src/components/mc/route";

// The manufacturing-customers filter's place in the URL: `scope=mfg`, kept with `fx=sage`.
describe("goals scope route", () => {
  it("round-trips scope=mfg next to fx=sage", () => {
    const url = routeToUrl({ screen: "goals", fx: "sage", scope: "mfg" });
    expect(url).toBe("/?screen=goals&fx=sage&scope=mfg");
    expect(urlToRoute(url)).toEqual({ screen: "goals", fx: "sage", scope: "mfg" });
  });

  it("leaves all customers out of the URL and ignores unknown scopes", () => {
    expect(routeToUrl({ screen: "goals" })).toBe("/?screen=goals");
    expect(urlToRoute("/?screen=goals&scope=all")).toEqual({ screen: "goals" });
    expect(urlToRoute("/?screen=goals&scope=nope")).toEqual({ screen: "goals" });
  });
});

describe("goals section tab route", () => {
  it("keeps the open section in the URL and leaves the default out", () => {
    expect(routeToUrl({ screen: "goals" })).toBe("/?screen=goals");
    expect(routeToUrl({ screen: "goals", tab: "classes" })).toBe("/?screen=goals");
    expect(routeToUrl({ screen: "goals", tab: "batches", fx: "sage", scope: "mfg" })).toBe(
      "/?screen=goals&fx=sage&scope=mfg&tab=batches"
    );
    expect(urlToRoute("/?screen=goals&tab=batches")).toEqual({ screen: "goals", tab: "batches" });
    expect(urlToRoute("/?screen=goals&fx=sage&scope=mfg&tab=forecast")).toEqual({
      screen: "goals",
      fx: "sage",
      scope: "mfg",
      tab: "forecast",
    });
    expect(urlToRoute("/?screen=goals")).toEqual({ screen: "goals" });
    expect(urlToRoute("/?screen=goals&tab=classes")).toEqual({ screen: "goals" });
    expect(urlToRoute("/?screen=goals&tab=nope")).toEqual({ screen: "goals" });
    expect(urlToRoute("/?screen=goals&tab=BATCHES")).toEqual({ screen: "goals" });
  });
});
