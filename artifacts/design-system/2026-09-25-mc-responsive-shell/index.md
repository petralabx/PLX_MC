# Bundle index — 2026-09-25 MC responsive redesign, PR 1 (shell)

- `REPORT.md` — what changed, verification evidence, assumed open questions, deviations from the
  handoff reference code, known follow-ups.
- `before/<screen>-<width>.png` — `main` @ 2faa2a2 (Home, Board at 393 / 820 / 1440 / 2560).
- `after/<screen>-<width>.png` — this PR (TASK-1994) at the same widths:
  - `home-*`, `board-*` — the nav form per tier (tabs + strip · icon rail · sidebar · sidebar + pane).
  - `pane-*` — `/?screen=board&taskId=TASK-221`: full-screen page (393), right sheet (820), overlay
    (1440), persistent column (2560).
  - `more-393`, `drawer-393` — the More sheet and More → All screens drawer on phone.
  - `drawer-820` — the tablet rail expanded into the labelled drawer.
  - `live-2560` — the pinned Agent activity column beside the empty pane.

All captures are viewport screenshots from the e2e harness (no database → the store's offline
fixtures and the offline banner), clock fixed at 2026-09-25T10:00Z, reduced motion. The round
"N" badge bottom-left is the Next.js dev-tools indicator (`next dev` only).
