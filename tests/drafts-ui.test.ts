// Drafts screen (Draft Projects step 3). No DOM environment (vitest runs in
// Node), so parts are rendered with renderToStaticMarkup. Draft text is shown
// as text, never as HTML; only http(s) links become links; preflight problems
// show against the plan item they name; the version summary names what changed.
// The New draft form (TASK-4109) opens at draftId=new, or with edit=1 on a draft,
// and that route survives the URL. Its save (TASK-4110) drops rows left empty,
// names half-filled ones, and sends an artifact as a link or inline content.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DraftsView, PlanSection, ResearchSection, VersionDiff } from "@/components/mc/drafts";
import { prepare, type FormState } from "@/components/mc/draft-editor";
import { navAllowed, setNavGuard } from "@/components/mc/nav-guard";
import { routeToUrl, urlToRoute } from "@/components/mc/route";
import { draftPlanSchema, draftResearchSchema } from "@/lib/drafts/schema";
import { emptyDraftContent, type DraftContent, type DraftPlan, type DraftPlanTask, type DraftResearch } from "@/lib/drafts/types";

const content = (): DraftContent => ({
  title: "Draft Projects",
  plan: draftPlanSchema.parse({
    project: { name: "Draft Projects", owner: "vince" },
    buckets: [{ key: "B1", name: "Storage", owner: "vince" }],
    tasks: [
      { key: "T1", bucket: "B1", title: "Drafts tables" },
      { key: "T2", bucket: "B1", title: "Drafts screen", dependsOn: ["T1"] },
    ],
  }) as DraftPlan,
  research: draftResearchSchema.parse({
    summary: "<script>alert(1)</script> as plain text",
    approaches: [
      { name: "Separate tables", chosen: true },
      { name: "Status on projects" },
    ],
    sources: [
      { ref: "[1]", title: "Web page", kind: "external", url: "https://learn.microsoft.com/graph" },
      { ref: "[2]", title: "Repo file", kind: "internal", url: "src/lib/sync/state.ts" },
    ],
    findings: [{ text: "Live surfaces read projects.", sources: ["[2]"] }],
    artifacts: [{ kind: "mermaid", name: "Flow", inline: "graph TD; A-->B<b>" }],
  }) as DraftResearch,
});

describe("Drafts screen", () => {
  it("shows draft text as text, and links only http(s) sources", () => {
    const html = renderToStaticMarkup(createElement(ResearchSection, { content: content() }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; as plain text");
    expect(html).toContain('<a href="https://learn.microsoft.com/graph" target="_blank" rel="noreferrer noopener">Web page</a>');
    expect(html).not.toContain('href="src/lib/sync/state.ts"');
    expect(html).toContain("src/lib/sync/state.ts");
    expect(html).toContain("graph TD; A--&gt;B&lt;b&gt;");
    expect(html).toContain("chosen");
  });

  it("shows each preflight problem against the plan item it names", () => {
    const html = renderToStaticMarkup(
      createElement(PlanSection, {
        content: content(),
        issues: [{ code: "repo_not_allowed", path: "plan.tasks[T2].repos", message: "x-repo is not in the registry." }],
      })
    );
    const t2 = html.slice(html.indexOf(">T2<"));
    expect(t2).toContain("x-repo is not in the registry.");
    expect(html.slice(html.indexOf(">T1<"), html.indexOf(">T2<"))).not.toContain("x-repo");
    expect(html).toContain("after T1");
  });

  it("names what changed since an older version", () => {
    const older = content();
    const newer = content();
    newer.title = "Draft Projects v2";
    newer.plan.tasks[1].title = "Drafts screen and Accept";
    newer.plan.tasks.push({ ...newer.plan.tasks[0], key: "T3", title: "Approvals panel" });
    const html = renderToStaticMarkup(createElement(VersionDiff, { older, newer, olderVersion: 1 }));
    expect(html).toContain("Since version 1:");
    expect(html).toContain("T2 changed");
    expect(html).toContain("T3 added");
    expect(html).not.toContain("T1 changed");
    expect(renderToStaticMarkup(createElement(VersionDiff, { older, newer: content(), olderVersion: 1 }))).toContain("no change");
  });

  it("opens on the list, or on one draft while it loads", () => {
    const nav = vi.fn();
    expect(renderToStaticMarkup(createElement(DraftsView, { route: { screen: "drafts" }, nav }))).toContain("Loading drafts");
    expect(renderToStaticMarkup(createElement(DraftsView, { route: { screen: "drafts", draftId: "DRF-4" }, nav }))).toContain("Loading DRF-4");
  });

  it("opens the New draft form, or the form for one draft while it loads", () => {
    const nav = vi.fn();
    const fresh = renderToStaticMarkup(createElement(DraftsView, { route: { screen: "drafts", draftId: "new" }, nav }));
    expect(fresh).toContain("New <em>draft</em>");
    expect(fresh).toContain("Create draft");
    expect(fresh).toContain('aria-label="Plan"');
    expect(fresh).toContain('aria-label="Research"');
    const editing = renderToStaticMarkup(createElement(DraftsView, { route: { screen: "drafts", draftId: "DRF-4", edit: "1" }, nav }));
    expect(editing).toContain("Loading DRF-4");
    expect(editing).not.toContain('aria-label="Reviews"');
  });

  it("keeps the form in the URL", () => {
    expect(routeToUrl({ screen: "drafts", draftId: "DRF-4", edit: "1" })).toBe("/?screen=drafts&draftId=DRF-4&edit=1");
    expect(urlToRoute("/?screen=drafts&draftId=DRF-4&edit=1")).toEqual({ screen: "drafts", draftId: "DRF-4", edit: "1" });
    expect(urlToRoute("/?screen=drafts&draftId=DRF-4&edit=yes")).toEqual({ screen: "drafts", draftId: "DRF-4" });
  });
});

describe("the navigation guard", () => {
  it("asks the guard while it is set, and lets navigation go once it is cleared", () => {
    expect(navAllowed()).toBe(true);
    let answer = false;
    const clear = setNavGuard(() => answer);
    expect(navAllowed()).toBe(false);
    answer = true;
    expect(navAllowed()).toBe(true);
    clear();
    answer = false;
    expect(navAllowed()).toBe(true);
  });

  it("does not clear a guard that replaced it", () => {
    const clearFirst = setNavGuard(() => false);
    const clearSecond = setNavGuard(() => false);
    clearFirst();
    expect(navAllowed()).toBe(false);
    clearSecond();
    expect(navAllowed()).toBe(true);
  });
});

describe("the New draft form's save", () => {
  const form = (edit: (c: DraftContent) => void): FormState => {
    const content = emptyDraftContent("A plan");
    edit(content);
    return { content, visibility: "shared", members: "", reviewers: "" };
  };
  const task: DraftPlanTask = { key: "T1", bucket: "B1", title: "x", description: "", priority: "medium", kind: "code", repos: [], accountableOwner: null, dependsOn: [] };

  it("drops rows left empty, and tidies lists typed one per line or by commas", () => {
    const { body, problems } = prepare(
      form((c) => {
        c.research.approaches = [{ name: "", pros: ["", " "], cons: [], risk: "medium", effort: "M", chosen: false }];
        c.research.findings = [{ text: " ", sources: [] }];
        c.research.risks = [{ text: "", likelihood: "low", impact: "low", mitigation: " " }];
        c.research.openQuestions = ["Who reviews?", "", "  "];
        c.research.artifacts = [{ kind: "web-page", name: "", url: "", inline: null }];
        c.plan.tasks = [{ ...task, dependsOn: ["T2", " ", " TASK-12"] }];
      })
    );
    expect(problems).toEqual([]);
    expect(body.research).toMatchObject({ approaches: [], findings: [], risks: [], openQuestions: ["Who reviews?"], artifacts: [] });
    expect((body.plan as DraftPlan).tasks[0].dependsOn).toEqual(["T2", "TASK-12"]);
  });

  it("names a half-filled row instead of sending it", () => {
    const { problems } = prepare(
      form((c) => {
        c.title = " ";
        c.research.risks = [{ text: "", likelihood: "low", impact: "low", mitigation: "Retry the import." }];
        c.research.artifacts = [
          { kind: "mermaid", name: "Flow", url: null, inline: " " },
          { kind: "web-page", name: "", url: "https://example.com/a", inline: null },
          { kind: "document", name: "Spec", url: " ", inline: null },
        ];
      })
    );
    expect(problems).toEqual([
      "Give the draft a title.",
      "Risk 1 needs its text.",
      "Artifact 1 needs its content.",
      "Artifact 2 needs a name.",
      "Artifact 3 needs its link.",
    ]);
  });

  it("sends an artifact as a link or as inline content, never both", () => {
    const { body } = prepare(
      form((c) => {
        c.research.artifacts = [
          { kind: "mermaid", name: "Flow", url: null, inline: "graph TD; A-->B" },
          { kind: "web-page", name: "Spec", url: " https://example.com/spec ", inline: null },
        ];
      })
    );
    expect((body.research as DraftResearch).artifacts).toEqual([
      { kind: "mermaid", name: "Flow", url: null, inline: "graph TD; A-->B" },
      { kind: "web-page", name: "Spec", url: "https://example.com/spec", inline: null },
    ]);
  });
});
