// Approvals and My tasks deep links (TASK-3559). A link opens one gate (or one
// question) on the Approvals screen, or My tasks, and it survives the sign-in
// redirect. It names no person: whose approvals and tasks show comes from the
// session, never from the URL.
import { describe, expect, it } from "vitest";

import { urlToRoute } from "@/components/mc/route";
import { signInReturnPath } from "@/lib/auth/gate";
import { questionLink } from "@/lib/compliance/questions";
import { gateLink, publicMcBaseUrl } from "@/lib/mcp/envelope";

const pathAndQuery = (href: string) => {
  const url = new URL(href);
  return `${url.pathname}${url.search}`;
};

// The stable My tasks link people share; the shell reads it as the "mine" screen.
const myTasks = () => `${publicMcBaseUrl()}/?screen=my-tasks`;

describe("gateLink (TASK-3559)", () => {
  it("opens the gate on the Approvals screen the shell reads", () => {
    const href = gateLink("apg_0123456789abcdef");
    expect(href).toBe(`${publicMcBaseUrl()}/?screen=approvals&gate=apg_0123456789abcdef`);
    expect(urlToRoute(href)).toEqual({ screen: "approvals", gate: "apg_0123456789abcdef" });
  });

  it("percent-encodes the id, so an id cannot add its own parameters", () => {
    expect(urlToRoute(gateLink("apg_x&screen=home"))).toEqual({ screen: "approvals", gate: "apg_x&screen=home" });
  });

  it("names no person", () => {
    expect([...new URL(gateLink("apg_1")).searchParams.keys()]).toEqual(["screen", "gate"]);
  });
});

describe("the links survive the sign-in redirect (TASK-3559)", () => {
  it.each([
    ["a gate", gateLink("apg_0123456789abcdef"), { screen: "approvals", gate: "apg_0123456789abcdef" }],
    ["a question", questionLink("q_0123456789abcdef"), { screen: "approvals", question: "q_0123456789abcdef" }],
    ["My tasks", myTasks(), { screen: "mine" }],
  ])("comes back to %s after sign-in", (_what, href, route) => {
    // Auth.js passes the full requested URL as callbackUrl.
    const back = signInReturnPath(href);
    expect(back).toBe(pathAndQuery(href));
    expect(urlToRoute(back)).toEqual(route);
  });
});
