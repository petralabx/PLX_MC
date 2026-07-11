# Annotated Screens

Numbered callouts on each screenshot key to the legend panel on the right of every image. These are the visual companion to **README.md §6 (Screens & views)** — read them together. All frames are the high‑fidelity prototype in light mode; dark mode is fully supported (see DESIGN_TOKENS.md §2).

| # | File | Screen | Highlights |
|---|---|---|---|
| 01 | `01-inbox.png` | **Inbox (Home)** | Section headers + counts, notification rows, live sync pill, bucket status ticks |
| 02 | `02-board.png` | **Board** | View switch, stage columns (3‑band / full lifecycle), task cards, per‑card sync |
| 03 | `03-timeline.png` | **Timeline (Gantt)** | Initiative lanes, 7px pill bars, milestones, cycle bands |
| 04 | `04-traceability.png` | **Traceability Matrix** | Req → Task → PR → Evidence → Test → Merge chain; GAP rows; export |
| 05 | `05-feed.png` | **Agent Activity** | Live agent feed, context chips, review actions |
| 06 | `06-bucket-overview.png` | **Initiative Detail — Overview** | Header, sync state, facts, PRD summary |
| 07 | `07-bucket-records.png` | **Initiative Detail — Records** | Embedded SharePoint ToDos list + Documents & Links |
| 08 | `08-task-overview.png` | **Task Detail — Overview** | Title/meta, confidence, description, activity log |
| 09 | `09-task-record.png` | **Task Detail — System of Record** | Mapped fields, Sync now, **inline conflict resolver** |
| 10 | `10-sync-overview.png` | **Sync Console — Overview** | Site bar, Sync now, register cards, per‑state counts |
| 11 | `11-sync-mapping.png` | **Sync Console — Field Mapping** | Full MC field ↔ SharePoint column table w/ directions |
| 12 | `12-sync-queue.png` | **Sync Console — Review Queue** | Two‑sided conflict diff, Keep MC / Keep SharePoint, push errors |
| 13 | `13-files.png` | **Files — Document Library** | Breadcrumb, columns, per‑initiative folders |
| 14 | `14-files-folder.png` | **Files — Inside a Folder** | File rows with type chip, author, per‑file sync |
| 15 | `15-newtask.png` | **New Task Modal** | Title, initiative, owner, priority/stage/due/estimate, PRD req chips |
| 16 | `16-peoplepicker.png` | **People Picker** | Directory typeahead across both Petra domains, invite + domain‑block |
| 17 | `.orchestrator/design-projects/after-project-detail.png` | **Project Detail** | Initiative card grid (mono ID, health pill, task progress bar; 3/2/1 columns at desktop/tablet/mobile); facts rail + inline edit for health, accountable owner, target, and description — screenshot captured at integration |

**Note:** the Initiative and Task detail screens are taller than one viewport, so each is split into two frames (overview + records/record). Several frames are scrolled to the relevant section; the legend names what's shown.
