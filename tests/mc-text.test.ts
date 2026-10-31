// Mission Control text (TASK-4390): references split out of plain text, and
// the renderer's rules from the formatting reference. The renderer is checked
// as static markup: structure, links and that nothing renders raw HTML.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { McText } from "@/components/mc/mc-text";
import { parseMarkdown } from "@/lib/governance-sops/markdown";
import { gateLabel, parseMcText, splitRefs, urlLabel } from "@/lib/mc-text";

const nav = () => {};
const html = (text: string) => renderToStaticMarkup(createElement(McText, { text, nav }));

describe("splitRefs", () => {
  it("turns Mission Control ids into references and leaves the words around them", () => {
    expect(splitRefs("Depends on TASK-4001, in PRJ-SESSION-NUDGE-MCP.")).toEqual([
      { kind: "text", value: "Depends on " },
      { kind: "task", id: "TASK-4001" },
      { kind: "text", value: ", in " },
      { kind: "project", id: "PRJ-SESSION-NUDGE-MCP" },
      { kind: "text", value: "." },
    ]);
    expect(splitRefs("Draft DRF-12 for BKT-FLEET-COMPLIANCE")).toEqual([
      { kind: "text", value: "Draft " },
      { kind: "draft", id: "DRF-12" },
      { kind: "text", value: " for " },
      { kind: "bucket", id: "BKT-FLEET-COMPLIANCE" },
    ]);
  });

  it("keeps a bucket id that the 28-character cut left ending in a hyphen", () => {
    expect(splitRefs("Next in BKT-SESSION-NUDGE-DOOR-GROK- now")).toEqual([
      { kind: "text", value: "Next in " },
      { kind: "bucket", id: "BKT-SESSION-NUDGE-DOOR-GROK-" },
      { kind: "text", value: " now" },
    ]);
  });

  it("keeps a project id that ends in a hyphen", () => {
    expect(splitRefs("In PRJ-SESSION-NUDGE- now")[1]).toEqual({ kind: "project", id: "PRJ-SESSION-NUDGE-" });
  });

  it("does not take an id out of a longer word", () => {
    expect(splitRefs("SUBTASK-12 and MYTASK-3")).toEqual([{ kind: "text", value: "SUBTASK-12 and MYTASK-3" }]);
  });

  it("shortens pull requests, gates and other links", () => {
    expect(splitRefs("Delivered by petralabx/agentic-swarm#1731")).toEqual([
      { kind: "text", value: "Delivered by " },
      { kind: "pr", repo: "petralabx/agentic-swarm", number: 1731, label: "agentic-swarm#1731", href: "https://github.com/petralabx/agentic-swarm/pull/1731" },
    ]);
    expect(splitRefs("https://github.com/petralabx/plx-customer-portal/pull/3100/files")[0]).toEqual({
      kind: "pr",
      repo: "petralabx/plx-customer-portal",
      number: 3100,
      label: "plx-customer-portal#3100",
      href: "https://github.com/petralabx/plx-customer-portal/pull/3100",
    });
    expect(splitRefs("Replaces gate apg_4d3a38538a1955b8.")).toEqual([
      { kind: "text", value: "Replaces gate " },
      { kind: "gate", id: "apg_4d3a38538a1955b8", label: "apg_4d3a…55b8" },
      { kind: "text", value: "." },
    ]);
    expect(gateLabel("apg_4d3a38538a1955b8")).toBe("apg_4d3a…55b8");
    const url = "https://petrasoap.sharepoint.com/sites/PLXSite/Systems/Runbooks";
    expect(splitRefs(`See ${url}.`)).toEqual([
      { kind: "text", value: "See " },
      { kind: "url", href: url, label: "petrasoap.sharepoint.com · …/Systems/Runbooks" },
      { kind: "text", value: "." },
    ]);
    expect(urlLabel("https://example.com/")).toBe("example.com");
  });

  it("collapses a Mission Control URL to its chip, and never splits an id out of a URL", () => {
    expect(splitRefs("https://mc.plxcustomer.io/tasks/TASK-4002")).toEqual([{ kind: "task", id: "TASK-4002" }]);
    expect(splitRefs("https://mc.plxcustomer.io/?screen=approvals&gate=apg_4d3a38538a1955b8")).toEqual([
      { kind: "gate", id: "apg_4d3a38538a1955b8", label: "apg_4d3a…55b8" },
    ]);
    expect(splitRefs("https://mc.plxcustomer.io/?screen=bucket&bucketId=BKT-WMS")).toEqual([{ kind: "bucket", id: "BKT-WMS" }]);
    const other = splitRefs("https://example.com/runs/TASK-9/log");
    expect(other).toHaveLength(1);
    expect(other[0].kind).toBe("url");
  });
});

describe("parseMcText", () => {
  it("keeps a single line break inside a paragraph; the SOP parser still joins with a space", () => {
    const [p] = parseMcText("Phase 1 shipped.\nNo nudge yet.");
    expect(p).toEqual({ type: "paragraph", text: [{ type: "text", value: "Phase 1 shipped.\nNo nudge yet." }] });
    const [sop] = parseMarkdown("Phase 1 shipped.\nNo nudge yet.");
    expect(sop).toEqual({ type: "paragraph", text: [{ type: "text", value: "Phase 1 shipped. No nudge yet." }] });
  });
});

describe("McText", () => {
  it("renders paragraphs, a bold topic lead-in and a bold-only line as a section heading", () => {
    const out = html("**What changed.** The PR moved to head 76e691e.\n\n**Next**\n\nShip it.");
    expect(out).toContain("<p><strong>What changed.</strong> The PR moved to head 76e691e.</p>");
    expect(out).toContain('<p class="mct-h"><strong>Next</strong></p>');
    expect(out).toContain("<p>Ship it.</p>");
  });

  it("renders checklists with their state in words for screen readers", () => {
    const out = html("- [ ] Cursor API key\n- [x] Hook installed on coding-1\n\n1. Inbox\n2. End-to-end proof");
    expect(out).toContain('<li class="mct-check"><span class="mct-box" aria-hidden="true"></span><span class="vh">To do: </span>');
    expect(out).toContain('<span class="mct-box on" aria-hidden="true"></span><span class="vh">Done: </span>');
    expect(out).toContain("<ol><li><span>Inbox</span></li><li><span>End-to-end proof</span></li></ol>");
  });

  it("links ids inside Mission Control and pull requests and URLs outside it", () => {
    const out = html("Depends on TASK-4001 and petralabx/agentic-swarm#1731; see https://example.com/a/b/c.");
    expect(out).toContain('<a class="mct-chip" href="/?screen=task&amp;taskId=TASK-4001">TASK-4001</a>');
    expect(out).toContain(
      '<a class="mct-link" href="https://github.com/petralabx/agentic-swarm/pull/1731" target="_blank" rel="noopener noreferrer" title="petralabx/agentic-swarm#1731">agentic-swarm#1731</a>'
    );
    expect(out).toContain('title="https://example.com/a/b/c">example.com · …/b/c</a>.');
  });

  it("never renders markup from the text, and drops links with unsafe schemes", () => {
    const out = html('<script>alert(1)</script> [click](javascript:alert(1)) [ok](https://example.com/x) `<b>`');
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(out).not.toContain("javascript:");
    expect(out).toContain("click");
    expect(out).toContain('<a class="mct-link" href="https://example.com/x" target="_blank" rel="noopener noreferrer">ok</a>');
    expect(out).toContain("<code>&lt;b&gt;</code>");
  });

  it("keeps a link label as text, so a reference inside it never nests a link in a link", () => {
    const out = html("[TASK-221 plan](https://example.com/plan)");
    expect(out.match(/<a /g)).toHaveLength(1);
    expect(out).toContain('<a class="mct-link" href="https://example.com/plan" target="_blank" rel="noopener noreferrer">TASK-221 plan</a>');
  });

  it("opens a relative Mission Control link in place", () => {
    const out = html("[Open the gate](/?screen=approvals&gate=apg_4d3a38538a1955b8)");
    expect(out).toContain('<a class="mct-link" href="/?screen=approvals&amp;gate=apg_4d3a38538a1955b8">Open the gate</a>');
  });

  it("renders nothing for empty text", () => {
    expect(html("   ")).toBe("");
  });
});
