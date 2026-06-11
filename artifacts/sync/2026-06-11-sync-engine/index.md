# Bundle index — 2026-06-11-sync-engine

- `REPORT.md` — live verification of sync engine v1 against the staging
  SharePoint site and the `plx_mc` staging database: seed, outbound create,
  idempotence, §5.2 error retry, inbound pull, §5.1 conflict raise +
  manual resolution (including the inbound-before-outbound ordering fix),
  create→push, delta-link persistence, and the in-app scheduler smoke test.

Related repo files: `src/lib/sync/` (engine, mapping, graph, repo, state,
scheduler), `src/lib/api/` (route + client wrappers), `src/app/api/`,
`src/instrumentation.ts`, `tests/sync-mapping.test.ts`, `tests/api-route.test.ts`.
