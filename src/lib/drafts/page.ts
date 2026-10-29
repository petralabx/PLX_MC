// A frozen draft version as a review page (TASK-4135): one self-contained HTML
// file that the writer's agent publishes as a private Claude Artifact. Every
// plan item and research section carries data-target, the target a comment
// anchored there is relayed with (P, B1, T3, research.summary, …). Every value
// is escaped, links are http(s) only, and the page runs no script.

import type { Draft, DraftVersion } from "./types";

const esc = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Text as written: line breaks kept, nothing interpreted. */
const text = (value: string) => (value.trim() ? `<p class="text">${esc(value.trim())}</p>` : "");

const link = (url: string, label = url) =>
  /^https?:\/\//i.test(url) ? `<a href="${esc(url)}" rel="noopener noreferrer">${esc(label)}</a>` : `<code>${esc(url)}</code>`;

const meta = (items: [string, string][]) => {
  const shown = items.filter(([, value]) => value.trim());
  return shown.length ? `<dl class="meta">${shown.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : "";
};

const list = (items: string[]) => (items.length ? `<ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>` : "");

/** One anchored part of the page: a comment on it is relayed with this target. */
const part = (target: string, heading: string, body: string, tag: "section" | "article" = "section") =>
  `<${tag} id="${esc(target.replace(/\./g, "-"))}" data-target="${esc(target)}"><h${tag === "section" ? 2 : 3}>${heading}</h${tag === "section" ? 2 : 3}>${body}</${tag}>`;

const STYLE = `
:root {
  --p-paper: #FBFAF6; --p-card: #FFFFFF; --p-ink: #1B1A17; --p-muted: #6B665B;
  --p-line: #E4E0D6; --p-accent: #244A39; --p-note: #F5F3EC;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --p-paper: #151512; --p-card: #1D1C18; --p-ink: #ECE8DF; --p-muted: #A39D90;
    --p-line: #2E2C25; --p-accent: #9CC2AC; --p-note: #22211C;
  }
}
:root[data-theme="dark"] {
  --p-paper: #151512; --p-card: #1D1C18; --p-ink: #ECE8DF; --p-muted: #A39D90;
  --p-line: #2E2C25; --p-accent: #9CC2AC; --p-note: #22211C;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--p-paper); color: var(--p-ink); font: 16px/1.55 "Inter", "Segoe UI", "Helvetica Neue", Arial, sans-serif; }
main { max-width: 860px; margin: 0 auto; padding: 32px 16px 64px; }
h1 { font-size: 28px; line-height: 1.2; margin: 4px 0 8px; }
h2 { font-size: 20px; margin: 0 0 8px; }
h3 { font-size: 16px; margin: 0 0 6px; }
a { color: var(--p-accent); overflow-wrap: anywhere; }
code { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 13px; overflow-wrap: anywhere; }
.kicker { color: var(--p-muted); font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; }
.note { background: var(--p-note); border: 1px solid var(--p-line); border-radius: 8px; padding: 12px 14px; margin: 16px 0 24px; }
section, article { background: var(--p-card); border: 1px solid var(--p-line); border-radius: 8px; padding: 16px; margin: 0 0 16px; }
article { margin: 12px 0 0; }
.text { white-space: pre-wrap; overflow-wrap: anywhere; margin: 6px 0; }
.meta { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; margin: 6px 0; color: var(--p-muted); font-size: 14px; }
.meta dt { font-weight: 600; }
.meta dd { margin: 0; overflow-wrap: anywhere; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--p-note); border-radius: 6px; padding: 10px; font-size: 13px; }
ul { padding-left: 20px; }
`;

/** The page's title: a name, not a summary. */
export const draftPageTitle = (draftId: string, version: number) => `${draftId} v${version} review`;

export function renderDraftPage(draft: Pick<Draft, "id" | "author">, frozen: DraftVersion): string {
  const { plan, research, title } = frozen.content;
  const project = plan.project;

  const tasksOf = (bucket: string) =>
    plan.tasks
      .filter((t) => t.bucket === bucket)
      .map((t) =>
        part(
          t.key,
          `${esc(t.key)} · ${esc(t.title || "(untitled task)")}`,
          meta([
            ["Priority", t.priority],
            ["Kind", t.kind],
            ["Accountable", t.accountableOwner ?? ""],
            ["Repos", t.repos.join(", ")],
            ["Depends on", t.dependsOn.join(", ")],
          ]) + text(t.description),
          "article"
        )
      )
      .join("");

  const planHtml =
    part(
      "P",
      `P · ${esc(project.existing ? `Adds to ${project.existing}` : project.name || "(unnamed project)")}`,
      meta([
        ["Owner", project.owner],
        ["Repos", project.repos.join(", ")],
      ]) + text(project.desc)
    ) +
    plan.buckets
      .map((b) =>
        part(
          b.key,
          `${esc(b.key)} · ${esc(b.name || "(unnamed bucket)")}`,
          meta([
            ["Owner", b.owner],
            ["Repos", b.repos.join(", ")],
          ]) +
            text(b.desc) +
            tasksOf(b.key)
        )
      )
      .join("");

  const sources = new Map(research.sources.map((s) => [s.ref, s]));
  const researchHtml = [
    part("research.summary", "Summary", text(research.summary)),
    part("research.context", "Context", text(research.context)),
    part(
      "research.findings",
      "Findings",
      list(research.findings.map((f) => `${esc(f.text)}${f.sources.length ? ` <span class="kicker">${f.sources.map(esc).join(", ")}</span>` : ""}`))
    ),
    part(
      "research.approaches",
      "Approaches",
      list(
        research.approaches.map(
          (a) =>
            `<strong>${esc(a.name)}</strong>${a.chosen ? " (chosen)" : ""} <span class="kicker">risk ${esc(a.risk)} · effort ${esc(a.effort)}</span>` +
            (a.pros.length ? `<p class="text">Pros: ${a.pros.map(esc).join("; ")}</p>` : "") +
            (a.cons.length ? `<p class="text">Cons: ${a.cons.map(esc).join("; ")}</p>` : "")
        )
      )
    ),
    part("research.recommendation", "Recommendation", text(research.recommendation)),
    part(
      "research.risks",
      "Risks",
      list(research.risks.map((r) => `${esc(r.text)} <span class="kicker">likelihood ${esc(r.likelihood)} · impact ${esc(r.impact)}</span>${r.mitigation ? text(`Mitigation: ${r.mitigation}`) : ""}`))
    ),
    part("research.openQuestions", "Open questions", list(research.openQuestions.map(esc))),
    part(
      "research.sources",
      "Sources",
      list([...sources.values()].map((s) => `<code>${esc(s.ref)}</code> ${esc(s.title)}${s.url ? ` · ${link(s.url)}` : ""}`))
    ),
    part(
      "research.artifacts",
      "Artifacts",
      list(research.artifacts.map((a) => (a.url ? `${esc(a.kind)}: ${link(a.url, a.name)}` : `${esc(a.kind)}: ${esc(a.name)}<pre>${esc(a.inline ?? "")}</pre>`)))
    ),
  ].join("");

  const pageTitle = draftPageTitle(draft.id, frozen.version);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(pageTitle)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<p class="kicker">Draft ${esc(draft.id)} · version ${frozen.version} · <code>${esc(frozen.digest.slice(0, 19))}</code></p>
<h1>${esc(title || "(untitled draft)")}</h1>
${meta([
  ["Author", draft.author],
  ["Frozen", `${frozen.frozenAt} by ${frozen.frozenBy}`],
])}
<div class="note">Comment on any part of this page. Comments from Petra people come back to Mission Control as comments on version ${frozen.version}. Nothing here changes the plan: the author changes it in Mission Control, and a new version gets a new page.</div>
<h2 class="kicker">Plan</h2>
${planHtml}
<h2 class="kicker">Research</h2>
${researchHtml}
</main>
</body>
</html>
`;
}
