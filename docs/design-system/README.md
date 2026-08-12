# PLX Design System

> Brand layer for the PLX customer portal. Sits on top of shadcn/ui without replacing it.

> **PLX_MC fork note (2026-06-10):** this copy was forked from `plx-customer-portal` `staging` @ `c92f1df5` for the Mission Control surface. The Portal repo remains the brand authority — see `decisions/ADR-003-mission-control-surface.md` and `HANDOFF-README.md`. Portal-specific rollout notes below (login pilot, Projects/Workbench, MRP migration) describe the Portal repo, not this one.

This directory is the **canonical source of truth** for the PLX Portal and staging MRP working-surface design language after reconciliation with the SharePoint `New PLX Portal Design/bundle` handoff. The SharePoint/Claude Design export is provenance and import material; production implementation must read from the repo copy here.

It contains tokens, decisions, the migration plan, and a pointer-index of every visual spec. It does not contain the React component implementations; those live in `portal/src/components/brand/` and route/domain components as rollout phases require them.

---

## What is in this folder

```
design-system/
├── README.md                          ← you are here
├── tokens.css                         ← CSS custom properties (source of truth)
├── tokens.ts                          ← TS mirror for build-time consumers
├── MIGRATION-PLAN.md                  ← sequenced plan to land this in the repo
├── MRP-MIGRATION.md                   ← MRP route-tree rollout plan
├── MRP-REFERENCE.md                   ← MRP artifact index
├── RESPONSIVE.md                      ← MRP responsive governance and QA gates
├── CONTRIBUTING.md                    ← MRP chrome/module contribution contract
├── PROMPT.md                          ← copy-paste responsive handoff prompt
├── HOMEPAGE-SCOPE.md                  ← homepage sibling-track decision
├── PRIMITIVE-BOARD.md                 ← durable review board for extracted primitives
├── REFERENCE.md                       ← pointers to the HTML design artifacts
├── COMPONENT-INVENTORY.md             ← shadcn audit + brand component catalog
├── EMAIL.md                           ← email standard index (MC reference)
├── EMAIL-STYLE-SOP.md                 ← transactional + ops/agent email brand SOP (v1.1)
├── plx-email-standard.html            ← visual email standard (open in browser)
├── source-snapshot/                   ← responsive handoff source snapshot
└── decisions/
    ├── ADR-001-brand-vocabulary.md    ← why serif + mono + folio chassis
    └── ADR-002-surface-architecture.md ← one brand layer, multiple surfaces
```

Read in this order: **README -> ADR-001 -> ADR-002 -> MIGRATION-PLAN or MRP-MIGRATION -> tokens.css -> REFERENCE or MRP-REFERENCE -> COMPONENT-INVENTORY**.

For MRP responsive work, read **PROMPT -> RESPONSIVE -> CONTRIBUTING -> MRP-REFERENCE -> MRP-MIGRATION** before touching production routes.

For **email** (including agent Graph sends), read **EMAIL.md → EMAIL-STYLE-SOP.md** and open `plx-email-standard.html`. Implementation lives in the Portal repo (`email-theme.ts`).

### Surfaces Covered

| Surface | Audience | Reference | Migration |
|---|---|---|---|
| Portal | Customers and brand owners | `REFERENCE.md` | `MIGRATION-PLAN.md` |
| MRP | PLX staff and internal operations | `MRP-REFERENCE.md` | `MRP-MIGRATION.md` |
| Email | Customers, suppliers, staff, ops/agent Graph | `EMAIL.md` + `EMAIL-STYLE-SOP.md` | Portal: `portal/src/lib/notifications/email-theme.ts` |
| Homepage | Public marketing visitors | `HOMEPAGE-SCOPE.md` | Sibling track, not part of Portal/MRP rollout |

---

## What this is, in one paragraph

PLX is a **regulated cosmetics formulation platform**. The portal is where customers approve formulas, sign deeds, and watch their products move through manufacture. The voice is **chemistry-meets-deed**: editorial typography that respects the legal weight of approval, mono labels that respect the precision of formulation, and a chassis-and-folio chrome that makes every page feel like a bound document rather than a SaaS dashboard. We are not a productivity tool. We are a **system of record**.

The design layer reflects that. It is restrained, type-driven, and deliberately quiet. Color is rationed. Iconography is near-absent. The only ornamental moves are corner ticks and hairlines — chassis marks that signal precision without decorating it.

---

## What this is NOT

- **Not a replacement for shadcn/ui.** Every form, dialog, dropdown, and table in the portal stays on shadcn primitives. The brand layer remaps shadcn's CSS variables — `--primary`, `--background`, `--card`, etc. — to PLX values. Shadcn components inherit the brand voice automatically.
- **Not the public marketing system.** The homepage is a sibling track with its own apothecary direction; see `HOMEPAGE-SCOPE.md`. The working-surface tokens activate only on routes opted in via `.brand-plx` or `data-brand="plx"` (see `tokens.css` §3). Current portal implementation convention is a route-shell `.brand-plx` boundary.
- **Not the raw SharePoint/Claude Design bundle.** The handoff artifacts are design provenance. The repo copy is the governed source for implementation after reconciliation.
- **Not finalized.** This is **v0.2 in progress**. Mazius Display is bundled under SIL OFL 1.1. Tokens are in hex pending OKLCH conversion. Dark mode tokens exist but are not yet exposed as a production UX toggle. ADR-001 remains a starting position alongside accepted ADR-002 surface architecture.

---

## Quick orientation for the next person

If you've never seen PLX before:

1. **Look at the spec artifacts first.** `REFERENCE.md` lists every HTML mock. Open `portal-system.jsx` and `portal-signoff.jsx` in a browser. The voice will land in five minutes.
2. **Read ADR-001.** It explains the three big bets: serif for legal moments, mono for formulation data, chassis-and-folio for chrome.
3. **Skim `tokens.css`.** The `--p-*` namespace is the entire visible surface area of the design system.
4. **Read ADR-002 and the right migration file.** Portal work starts with `MIGRATION-PLAN.md`; MRP work starts with `MRP-MIGRATION.md`.

If you're an LLM agent picking up this handoff: read the core files (`README`, `ADR-001`, `ADR-002`, the relevant migration plan, `tokens.css`, and the relevant reference index) before opening any portal source file. Skip steps and you will reskin the wrong things. Do not treat SharePoint/OneDrive files as implementation canon unless this repo copy is missing or explicitly marked stale.

---

## Conventions

### Token namespace

All brand tokens are prefixed `--p-*` (CSS) or live on the exported `tokens` object (TS). This signals "brand layer" and prevents collisions with shadcn or any future package.

When a component needs a brand value, prefer the shadcn variable that maps to it (`--primary`, `--background`) so theming stays composable. Use `--p-*` directly only for **brand-only** properties — chassis tick spacing, kicker letter-spacing, the rust accent — that have no shadcn equivalent.

### The "two namespaces" question

Why both `--p-*` and `--primary`? Because they answer different questions:

- `--primary`, `--background`, `--card` — **role**. "What is this thing for?" These get remapped per-brand. A multi-tenant future where Brand B activates a different palette: same shadcn components, different remap.
- `--p-paper`, `--p-ink`, `--p-accent` — **value**. "What is this thing literally?" These never change without a brand revision.

Using both in the same codebase is a feature. Using only roles loses the editorial vocabulary. Using only values loses shadcn's theming machinery.

### Naming

- CSS variables: `--p-noun` (e.g. `--p-paper`, `--p-grid`)
- TS exports: `camelCase` matching the noun (e.g. `tokens.paper`, `tokens.grid`)
- Utility classes: `.p-purpose` (e.g. `.p-kicker`, `.p-data`, `.p-hairline`)
- React components: `<PascalCase>` in `components/brand/` (e.g. `<ChassisFolio>`, `<WritStamp>`)

### What goes where

| Concern | Lives in |
|---|---|
| Color values, spacing values, type stacks | `tokens.css` (and mirrored to `tokens.ts`) |
| Why we picked them | `decisions/ADR-001-brand-vocabulary.md` |
| Steps to land them in the repo | `MIGRATION-PLAN.md` |
| Durable review state for extracted primitives | `PRIMITIVE-BOARD.md` |
| What each HTML spec artifact covers | `REFERENCE.md` |
| What each MRP spec artifact covers | `MRP-REFERENCE.md` |
| Why homepage is separate | `HOMEPAGE-SCOPE.md` |
| What shadcn components we keep, extend, or replace | `COMPONENT-INVENTORY.md` |
| Brand-specific React components | `portal/src/components/brand/**` (after Phase 3) |
| Domain components built on brand primitives | `portal/src/components/<domain>/**` (after Phase 4) |

---

## Current rollout decision

As of 2026-05-06, the active design-system pilot is the **customer login page** using the selected `PortalLogin_Instrument` direction from `specs/portal/portal-login.jsx`.

This supersedes the previous MRP-first deferral for the next execution lane. The MRP work remains useful evidence, but login is now the first screen that must prove the full governance loop: source-of-truth docs, tokens, auth behavior, light mode, dark mode, mobile responsiveness, accessibility, and no token drift.

As of 2026-05-08, the auth suite has landed on staging and the next customer-facing route is **Projects / Workbench** at `(portal)/projects/page.tsx`. Execute it in two small slices: first remove deprecated FM helper usage from the route, then migrate the visual workbench composition against the portal workbench specs.

As of 2026-05-17, the SharePoint `New PLX Portal Design/bundle` is promoted to canonical import material for v0.4. ADR-002 is accepted for Portal + MRP: one shared brand-token layer, with surface-specific components and route-level rollout gates. The homepage remains a sibling marketing track and must not be folded into Portal/MRP migration by accident.

Phase B of the v0.4 rollout has applied the forest token foundation (`--p-accent: #244A39`, `--p-paper: #FBF9F5`) to the spec/runtime mirrors, expanded the token audit to cover `.brand-plx` remaps and `.p-*` utilities, and exposed the runtime-safe asset subset under `portal/public/brand/`.

## Status

- [x] Tokens defined for light and dark schemes.
- [x] Spec artifacts produced for deed sign-off, project detail, workbench, login, navigation, system overview, and mobile sign-off variants.
- [x] Runtime token mirror exists at `portal/src/styles/brand-tokens.css`.
- [x] Minimal brand primitives exist for the prior MRP pilot (`Kicker`, `MonoData`, `Button` brand variants, `Badge` chassis variant).
- [x] Repo docs fully reconciled against latest Claude Design handoff for the login-first execution lane.
- [x] Login-first auth suite merged to staging for `/login`, `/register`, `/reset-password`, and `/verify-2fa`.
- [ ] Projects / Workbench route split completed: Prisma-only data hygiene first, visual migration second.
- [x] v0.4 SharePoint bundle docs copied/reconciled into this canonical repo copy.
- [x] MRP reference, MRP migration, homepage scope, and ADR-002 surface architecture documented.
- [x] Production logo/favicon assets exposed under `portal/public/brand/` and app metadata favicon paths.
- [x] Mazius Display webfonts bundled under SIL Open Font License 1.1 and loaded via `next/font/local`.

---

## Questions, ownership, escalation

This system was authored from a Claude Design handoff and is now governed in-repo. Anything unclear is a documentation bug; fix the relevant file in `docs/design-system/` rather than relying on chat memory or OneDrive state.

The active decisions and gates are listed in `MIGRATION-PLAN.md`. Resolve them before building production UI.
