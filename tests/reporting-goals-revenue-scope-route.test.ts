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
