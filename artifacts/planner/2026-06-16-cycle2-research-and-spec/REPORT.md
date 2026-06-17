# Cycle 2 — Planner Research Dossier

Evidence bundle for the Cycle-2 effort to deepen MS Planner features with
Linear-grade UX on PLX Mission Control, building on the completed Cycle-1 spine
(generic `patchTaskFields` mutation spine, unified `GroupBy`, `applyFilters`/`FilterState`,
`--p-*` design tokens, dormant-but-correct sync engine).

## Contents
- RESEARCH.md — post-Cycle-1 current-state map (file:line), a Cycle-2
  GAP/OPPORTUNITY matrix (value/effort/risk), and the recommended module set
  with sequencing and the native-vs-add-dependency decision points.

## Key correction
The chart-library premise was repo-mismatched: the external input read
`apps/vmc-web` (a different repo) and claimed `recharts` was already present.
Verified against `C:/Users/vince/PLX_MC`, this repo has **zero chart
dependencies** — so the charts decision is genuinely native-SVG vs. adding a new
dependency, and native SVG (matching the existing CSS confidence-ring precedent
in `atoms.tsx` and the `--p-*` tokens) is recommended.

## Recommended Cycle-2 modules (reuse-first, zero new runtime deps, no migrations)
- **Module E — Insights view (native-SVG charts):** status donut + total KPI,
  bucket/assignee/priority breakdowns, overdue KPI, every segment click-to-filter
  via the existing `FilterState` substrate. (P0, Value H / Effort M / Risk L)
- **Module F — Saved views / filter persistence (localStorage):** persist and
  restore `FilterState` + group-by/swimlanes; Save/Clear affordances. Closes the
  ephemeral-filter gap (`work-views.tsx:499`). (P0, Value H / Effort L / Risk L)
- **Module G — Timeline filtering + palette quick-wins:** due-date-range filter
  wired to the shared filter state; replace two dead palette stubs with real
  "Mark done" / "Assign to me" actions through the spine. (P1, Value M / Effort L / Risk L)
- **Module H (capacity-gated) — Enable & verify the dormant sync scheduler:**
  flip `PLX_MC_SYNC_ENABLED=1` in dev, add a cadence test, document the kill
  switch. (P1, Value M / Effort L / Risk L)

Sequencing: F -> E -> G -> (H). All are additive and non-blocking; Cycle-1
functionality is complete and shippable. Deferred to Cycle 3 (data/credential
gated): burndown/burn-up/CFD + daily snapshot job, Postgres saved-views API,
bulk multi-select, timeline drag-to-schedule, and SharePoint person/lookup
resolution.

Produced by the autonomous research -> architect -> harden workflow cycle.
