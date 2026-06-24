# Module: governance-sops (MC-SOP-Guide)

## What

A read-only governance-doctrine lens in the Mission Control shell (Screen
`governance-sops`, **System of record** sidebar group, label "SOP guide"). It
turns operator-facing SOPs — compliance gate, PR discipline, audit mirror, repo
hygiene, rollback — from buried repo markdown into a browsable, filterable
catalog with a PLX-styled full-text reader. It **displays and validates**
SOPs; it never edits or forks them (the repo markdown is the source of record).

This is the UI module named "governance"; it is distinct from the Python
`scripts/` governance tooling in `docs/modules/governance/README.md`, but
conceptually aligned (both make one source of doctrine authoritative).

## Why

Operators under pressure (an agent PR was blocked) need the Collaborator SOP in
one click, not a repo-archaeology session. SOPs live as canonical markdown; a
registry points MC at them so the cockpit can present doctrine without becoming
a second copy. Missing/invalid sources are shown loudly (never hidden), and
unverified/stale content is badged — no false authority.

## How

1. **Registry** — `config/governance-sops-registry.json`
   (`plx-governance-sops-registry/v1`): per-SOP `slug`, `title`, `description`,
   `audience`, `owner`, `effective_date`, `status`, `tags`, and an optional
   `source.repo_path`. Parsed by `parseSopRegistryJson` (zod; never throws;
   rejects duplicate slugs). The registry is the structured catalog that could
   later be SharePoint-backed without a UI change.
2. **Source** — `LocalFsSopSource` reads repo-relative markdown from the work
   tree (server-only, path-traversal rejected). Injected into the loader so
   tests run without the filesystem.
3. **Markdown** — `parseMarkdown` is a dependency-free parser → an `MdNode`
   token tree (headings, paragraphs, lists incl. task-lists + one level of
   nesting, GFM tables, fenced code, blockquote callouts, thematic breaks,
   inline strong/em/code/link). The UI renders the tree through React, so text
   is auto-escaped — **no raw HTML is ever injected**.
4. **Loader** — `listSopSummaries` / `getSopDetail` derive each row's state:
   `ready` (source readable), `planned` (no source → calm "coming soon"), or
   `degraded` (configured but missing/empty/unreadable → loud). One bad SOP
   never kills the batch; degraded rows sort first, planned last.
5. **API** — `GET /api/governance-sops` (list) and
   `GET /api/governance-sops/[slug]` (detail) go through the shared `route()`
   wrapper, return the standard `{ data }` / `{ error }` envelope, and are
   auth-gated by middleware. A degraded/planned detail is returned in
   `{ data: { ok: false, … } }` at 200 — visible, not hidden; an unknown slug
   is a 404.
6. **UI** — `GovernanceSopsView` (Screen `governance-sops`) fetches via the
   shared `api()` wrapper and renders an index (stat strip + search/category/
   status filters + hairline catalog) and a detail reader (folio metadata strip
   + serif doctrine prose at a comfortable measure + sticky TOC). `--p-*` tokens
   only behind `.mc`, `gs-` namespace, three breakpoints, 44px touch targets,
   tables the only horizontal-scroll surface.

```
registry.json → LocalFsSopSource → markdown parser + loader
    → GET /api/governance-sops[*] → GovernanceSopsView (index | detail)
```

## Dependencies

Depends on: **web** (MC shell, shared `api()` + `route()` wrappers, middleware
auth), **design-system** (`--p-*` tokens, `--mazius` serif, behind `.brand-plx`/
`.mc`). No new runtime dependency — the markdown renderer is in-repo. Depended on
by: nothing (read-only doctrine lens).

Future (out of scope for v1): mirroring the SOP catalog from SharePoint (the
registry leaves room for a non-repo `source`); in-app authoring is explicitly
not built.

### Key Files

- `config/governance-sops-registry.json` — the SOP catalog (no secrets)
- `src/lib/governance-sops/` — domain module: `types.ts`, `registry.ts`,
  `source.ts` (server-only fs), `markdown.ts` (parser), `loader.ts`, barrel
  `index.ts`
- `src/app/api/governance-sops/` — read-only list + `[slug]` detail routes
- `src/components/mc/governance-sops/` — `index.tsx` (screen), `views.tsx`
  (index + detail + markdown reader), `helpers.ts` (pure filter/label/tone)
- `src/styles/mc-governance-sops.css` — screen styles (`gs-`, `--p-*` only)
- `tests/governance-sops.test.ts` — registry parse, markdown parser, loader
  state derivation, seed integration
- `tests/mc-screens.test.ts` — registers `governance-sops` in the screen map

## Owner

Vince

## Criticality

Medium
