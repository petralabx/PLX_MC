# Module: mc-text

## What

Mission Control text (TASK-4390): how a description, status note or approval
summary written as plain text with a little markdown is shown. It keeps the
writer's structure (paragraphs, bold topic lead-ins, headings, lists,
checklists, code) and turns Mission Control references into links. It owns the
reference rules and the `McText` renderer. It does not own editing (the
screens keep their textareas) or the markdown grammar (the governance-sops
parser).

## Why

Agents and people write long descriptions and approval summaries with TASK
ids, pull requests and gate ids in them. Shown as one block of plain text they
were hard to read and nothing was clickable (design review 2026-10-31, the
"Formatting reference" board).

## How

- `src/lib/mc-text/refs.ts` `splitRefs(text)`: plain text into text and
  references, in order. TASK, PRJ, BKT (a 28-character cut can end in a
  hyphen) and DRF ids; `apg_` gate ids (shown `apg_4d3a…55b8`); `owner/repo#N`
  and GitHub pull-request URLs (shown `repo#N`); any other URL (shown host and
  the last two path segments). A URL wins over an id inside it, and a Mission
  Control URL collapses to its chip. Pure.
- `src/lib/mc-text/index.ts` `parseMcText(text)`: the governance-sops
  `parseMarkdown` with `breaks: true`, so a single line break inside a
  paragraph stays one.
- `src/components/mc/mc-text.tsx` `McText`: renders the blocks. A paragraph
  that is only bold, and a markdown heading, render as a section heading
  (`.mct-h`); a checklist item says "Done:" or "To do:" to screen readers. In-app
  references are links (`navHref`) that navigate in place on a plain click.
  Pull requests and URLs open in a new tab. A markdown link renders only for
  http, https or mailto. React escapes every string, and nothing uses
  `dangerouslySetInnerHTML`.
- Used on: the project description, the bucket (initiative) description, the
  task description and an approval gate's summary.
- Styles: `src/styles/mc-text.css` (`.mct`). It takes its size and colour from
  the surface it sits in.

## Dependencies

- governance-sops: `parseMarkdown` and its node types (`src/lib/governance-sops/markdown.ts`, imported directly because that module's barrel also exports server-only sources).
- web: `nav-model.ts` `navHref` and `isPlainLeftClick`, and the `Route` and `Nav` types.

### Key Files

- `src/lib/mc-text/refs.ts`: reference rules.
- `src/lib/mc-text/index.ts`: the module's entry point (client-safe).
- `src/components/mc/mc-text.tsx`: the renderer.
- `src/styles/mc-text.css`: styles.
- `tests/mc-text.test.ts`, `e2e/mc-text.spec.ts`: tests.

## Owner

Vince
