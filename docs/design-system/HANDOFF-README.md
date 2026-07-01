# PLX Design System — Handoff for PLX Mission Control

**Provenance (bundle seed):** `plx-customer-portal` repo, branch `staging`, commit `c92f1df5697a4e109dcd0b7d2dc0000f8cb06905` (2026-05-19).
**Token verification:** `src/styles/brand-tokens.css` verified byte-identical (content; LF-normalized) to `plx-customer-portal@staging` commit `fb8e065` as of 2026-06-17.
**Parity manifest:** `config/brand-portal-parity.json` — automated SHA-256 gate; last sync portal@`bdc704295` (2026-07-01). Refresh via `bash scripts/sync-brand-from-portal.sh` (see `docs/runbooks/brand-sync-from-portal.md`).
**Purpose:** Seed a new PLX Mission Control repo with the existing PLX design language so both products share one brand voice.

This bundle is self-contained. Copy it into the new repo and follow the integration steps below.

---

## What's in this bundle

```
plx-mission-control-design-handoff/
├── HANDOFF-README.md            ← you are here
├── design-system/               ← verbatim copy of docs/design-system/ (canonical governance)
│   ├── README.md                ← master index; read this first
│   ├── tokens.css / tokens.ts   ← source-of-truth brand tokens (--p-* namespace, light + dark)
│   ├── decisions/               ← ADR-001 (brand vocabulary), ADR-002 (surface architecture)
│   ├── specs/                   ← portal/homepage/MRP visual spec artifacts (JSX/HTML mocks)
│   ├── assets/                  ← logos, favicons, marks, Mazius Display webfonts (SIL OFL 1.1)
│   ├── source-snapshot/         ← frozen MRP handoff source
│   ├── RESPONSIVE.md            ← adopted responsive governance (3 breakpoints, 44px targets)
│   ├── CONTRIBUTING.md          ← chrome/module contribution contract
│   ├── COMPONENT-INVENTORY.md   ← shadcn audit + brand component catalog
│   └── MIGRATION-PLAN.md, MRP-*.md, HOMEPAGE-SCOPE.md, PRIMITIVE-BOARD.md, REFERENCE.md, ...
└── runtime/                     ← the production implementation files from the portal app
    ├── styles/
    │   ├── brand-tokens.css     ← runtime token mirror (import this in your global CSS)
    │   └── mrp-design.css       ← MRP surface styles (only needed if you reuse MRP chrome)
    ├── components-brand/        ← React brand primitives: BrandBoundary, Kicker, MonoData,
    │                              PMark, AuthStatusBanner (+ README)
    ├── public-brand/            ← runtime-safe assets → copy to public/brand/
    └── public-fonts/            ← Mazius Display webfonts → copy to public/fonts/
```

---

## Integration steps for a new Next.js repo

1. **Governance docs.** Copy `design-system/` to `docs/design-system/` in the new repo. Per its README, this folder is the canonical source of truth — keep that convention. Update its "Current rollout decision" section to reflect Mission Control as a new surface (see step 6).

2. **Tokens.** Copy `runtime/styles/brand-tokens.css` to `src/styles/brand-tokens.css` and import it from your global CSS:

   ```css
   @import "../styles/brand-tokens.css";
   ```

   Tokens activate on elements inside a `.brand-plx` boundary (or `data-brand="plx"`). The portal convention is a route-shell `.brand-plx` wrapper — keep it so the brand layer stays opt-in.

3. **Brand primitives.** Copy `runtime/components-brand/` to `src/components/brand/`. `AuthStatusBanner` is portal-specific; drop it if Mission Control has no auth surface yet.

4. **Static assets.** Copy `runtime/public-brand/` → `public/brand/` and `runtime/public-fonts/` → `public/fonts/`. Favicon metadata pattern from the portal:

   ```ts
   icons: {
     icon: [
       { url: "/brand/favicon-16.png", sizes: "16x16", type: "image/png" },
       { url: "/brand/favicon-32.png", sizes: "32x32", type: "image/png" },
       { url: "/brand/favicon-64.png", sizes: "64x64", type: "image/png" },
     ],
     apple: [{ url: "/brand/favicon-180.png", sizes: "180x180", type: "image/png" }],
   }
   ```

5. **Fonts.** The portal loads three families in `app/layout.tsx`; replicate this:

   ```tsx
   import { Inter, JetBrains_Mono } from "next/font/google";
   import localFont from "next/font/local";

   const maziusDisplay = localFont({
     src: [
       { path: "../../public/fonts/mazius/MaziusDisplay-Regular.woff2", weight: "400", style: "normal" },
       { path: "../../public/fonts/mazius/MaziusDisplay-Italic.otf", weight: "400", style: "italic" },
     ],
     variable: "--font-mazius-display",
     display: "swap",
   });

   const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-inter", display: "swap" });
   const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-jetbrains-mono", display: "swap" });
   ```

   Apply the three `variable` classes on `<html>`/`<body>`. Mazius Display is bundled under SIL OFL 1.1 (`public-fonts/mazius/LICENSE.txt` — keep the license file).

6. **Declare the new surface (ADR-002).** ADR-002 establishes one shared brand-token layer with multiple surfaces (Portal, MRP, Homepage). Mission Control should be added as a **fourth surface**: same tokens, its own components and rollout gates. Add a short section or a new ADR in `decisions/` recording this, so the two repos don't fork the brand silently.

7. **shadcn/ui.** The brand layer sits *on top of* shadcn — it remaps shadcn's role variables (`--primary`, `--background`, `--card`, ...) inside `.brand-plx`. If Mission Control uses shadcn, components inherit the voice automatically. See `design-system/COMPONENT-INVENTORY.md` for keep/extend/replace guidance.

---

## Rules that must survive the copy

- **`--p-*` is the only brand token namespace.** Never hardcode brand hex values in components; consume `--p-*` or the remapped shadcn role variables.
- **Roles vs. values:** use shadcn role vars (`--primary`) for "what is this for", `--p-*` (`--p-accent`) only for brand-only properties with no shadcn equivalent.
- **Responsive governance** (`RESPONSIVE.md`): exactly three breakpoints — desktop ≥1025px, tablet 641–1024px, phone ≤640px. No new breakpoints without a written waiver. Touch targets ≥44×44px. Tables are the only allowed horizontal-scroll surface, never the page.
- **Brand boundary is opt-in.** Tokens activate via `.brand-plx` / `data-brand="plx"`, not globally.
- **Docs are the escalation path.** Anything unclear is a documentation bug — fix the file in `docs/design-system/`, don't rely on chat memory.

## Known state of the system (as of this snapshot)

- v0.4: forest token foundation active (`--p-accent: #244A39`, `--p-paper: #FBF9F5`).
- Tokens are hex, OKLCH conversion pending.
- Dark-mode tokens exist but no production toggle yet.
- ADR-002 accepted; ADR-001 is a starting position, not final.
