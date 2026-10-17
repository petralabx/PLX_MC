repo: petralabx/PLX_MC
branch: main
path: src/components/mc

## Last sync
date: 2026-10-17T13:57:00Z

### Updated in this project
- Recreated the Project page (Overview + Initiatives lens) and the Initiative detail page with the repo's real skin (`src/styles/*.css`, Mazius fonts, brand logo)
- Redesigned both pages on PLX tokens: facts band, Documents & links table, initiative sections, task table tiers, phone/tablet/desktop shell
- Sample data in `mc-sample-data.js` mirrors the PLX Portal Go-Live project screenshots

## Screen map
| Screen | Repo files |
|---|---|
| Project Page — Current.dc.html | src/components/mc/project-detail.tsx, src/components/mc/project-overview.tsx, src/components/mc/project-overview.helpers.ts, src/components/mc/atoms.tsx, src/components/mc/chrome.tsx, src/components/mc/top-bar.tsx, src/components/mc/shell.tsx, src/components/mc/nav-model.ts, src/styles/mc-overview.css, src/styles/mc-app.css, src/styles/mc-shell.css, src/styles/mc-surface.css, src/styles/mc-task.css, src/styles/brand-tokens.css |
| Initiative Page — Current.dc.html | src/components/mc/bucket-detail.tsx, src/components/mc/timeline.tsx, src/components/mc/atoms.tsx, src/components/mc/chrome.tsx, src/components/mc/top-bar.tsx, src/components/mc/shell.tsx, src/styles/mc-overview.css, src/styles/mc-app.css, src/styles/mc-shell.css, src/styles/mc-task.css |
| Project Page — Redesign.dc.html | src/components/mc/project-detail.tsx, src/components/mc/project-overview.tsx, src/styles/mc-overview.css, src/styles/mc-shell.css |
| Initiative Page — Redesign.dc.html | src/components/mc/bucket-detail.tsx, src/components/mc/timeline.tsx, src/styles/mc-overview.css, src/styles/mc-shell.css |

## Copied assets
- src/styles/{mc-shell,brand-tokens,mc-surface,mc-app,mc-views,mc-task,mc-overview,mc-authoring}.css → linked via mc-globals.css (mirrors src/app/globals.css layer order)
- public/brand/logo-horizontal-{ink,cream}.png
- public/fonts/mazius/MaziusDisplay-Regular.woff2, MaziusDisplay-Italic.otf
