# Bundle index — 2026-07-06 PLX design-system alignment

- `REPORT.md` — audit checklist, systemic findings, root fixes, verification evidence.
- `before/<surface>/<viewport>.png` — G3 screenshots on `main` fixtures (chromium · tablet 820×1180 · mobile-chrome 393×851), captured before any change.
- `after/<surface>/<viewport>.png` — identical capture after the alignment pass.

Surfaces: ai-spend · board · cmdk · inbox · insights · repos · signin · skills ·
sync-console · task-detail. Screenshots are produced by
the `e2e/ui-*-responsive.spec.ts` gates from deterministic in-memory fixtures,
so before/after pairs are directly comparable.
