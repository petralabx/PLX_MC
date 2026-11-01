# ADR-001 — Brand Vocabulary

**Status:** Accepted (v0.2, login-first rollout)
**Date:** 2026-05-06
**Authors:** Claude Design handoff, reconciled by PLX portal implementation
**Supersedes:** none
**Superseded by:** none
**Amended:** 2026-10-31 — §3 (colour rationing) is superseded by the portal's ADR-012, the vibrant status set (decision 9, tokens v1.7.0): https://github.com/petralabx/plx-customer-portal/blob/staging/docs/design-system/decisions/ADR-012-vibrant-status-set.md

---

## Context

PLX is a regulated cosmetics formulation platform. The customer portal is the surface where chemists, brand owners, and regulatory contacts:

- Approve formulas (legal weight: yes — these become specifications of record).
- Sign off on deed-style documents that authorize manufacture.
- Watch projects move through stage-gated phases.
- Read certificates of analysis, ingredient lists, and pilot-pour data.

The first production-quality rollout target is the customer login page. That matters: login is the user's threshold into the system of record. It must carry enough operational trust to feel PLX-specific, while keeping authentication affordances plain, accessible, and honest about what is implemented.

The default shadcn/ui aesthetic — clean neutral SaaS — would functionally work. It would also be **wrong**. It signals "productivity tool," when the actual job is "system of record." A customer signing a $400k manufacturing authorization should feel they are signing something, not clicking through a Linear ticket.

This ADR commits to three big bets that establish the brand vocabulary. Each is reversible at the token layer, but the React component shapes built on top of them will not be.

---

## Decision

### 1. Serif for legal moments. Sans for body. Mono for data.

**Three type stacks, three jobs:**

- **Mazius Display (serif)** — page heroes, deed titles, login moments, anywhere the user should pause. The face has obvious editorial weight: high-contrast strokes, bracketed serifs, an unapologetic display character. It signals "document" and "threshold," not generic dashboard chrome.
- **Geist Sans (inherited from existing portal)** — body, form labels, table cells, navigation. Workmanlike, neutral, fast to read.
- **JetBrains Mono** — chassis ticks, kicker labels, formulation data, project IDs, timestamps, percentages. Mono signals precision; tabular numerals make every percentage line up.

The tracking is intentional and large: `0.22em` on tick labels, `0.18em` on metadata. This is **the** signature move of the brand — small mono labels with generous letter-spacing, all uppercase. It reads as instrumentation: a label on a panel, not a UI string.

**Alternatives considered:**

- *Inter everywhere* — what every shadcn site does. Rejected: anonymous; signals nothing about the regulated nature of the work.
- *Single serif (no sans)* — too editorial; tables and forms become unreadable.
- *No mono* — loses the chassis aesthetic entirely. The mono labels are what make it feel like instrumentation.

### 2. Chassis-and-folio chrome.

Pages are framed as if they were bound documents:

- **Folio borders** — hairline rules at the page edge with mono running heads (`PLX · 02 · DEED OF FORMULATION` upper left, `2614/2026 · LIGHT 03 EAU DE COLOGNE · TARIQ DEL MAR` upper right). This is the literal visual quotation from print folios.
- **Chassis ticks** — small `+`-shaped marks at the four corners of cards and primary content blocks. Decorative, structural-feeling, **not** ornamental flourishes.
- **Hairlines for hierarchy** — single 1px translucent-ink rules separate sections. No drop shadows. No filled containers with rounded corners as a default. Cards exist but they are barely there.

**Why this works for PLX specifically:**

The product traffics in formulas, certificates, and signed authorizations. All of those have a print heritage. The chassis-and-folio language quotes that heritage without literally pretending to be paper (we don't draw torn edges, we don't fake watermarks). It's a metaphor that earns its keep on the deed-of-formulation screen and stays out of the way on a routine project list.

**Alternatives considered:**

- *Heavy card-based UI (Notion / Linear)* — rejected: it makes everything feel transient, like a draft. The deed is not a draft.
- *Glassmorphism / aurora gradients* — already used on the public homepage. Stays there. Different surface, different job.
- *Government-document aesthetic (USWDS)* — too austere; we still need to be a pleasant tool to use day-to-day.

### 3. Color is rationed. Earth tones, not alarm colors.

Five status hues — sage, amber, steel, tomato, rust — all **muted** to roughly equivalent saturation. Status colors are **earth-toned**, not Bootstrap-grade alarm colors:

- `--p-ok` is sage `#5C7A55`, not `#22C55E` (vivid green).
- `--p-warn` is amber `#C99340`, not `#F59E0B` (vivid yellow).
- `--p-info` is steel-blue `#5B7B91`, not `#3B82F6` (vivid blue).
- `--p-hot` is tomato `#C84B2C`. Reserved for **destructive**. Not for "open flags." Not for "needs review."

Rust `#B65A3E` is the brand accent and the **only** chromatic flourish — used for active state, primary action, and the rare moment where the page actually needs to point at something. Used sparingly enough that when it appears, it means something.

**Why this matters operationally:**

PLX users see the same project for weeks. A dashboard that shouts a green checkmark and a red X every render trains people to ignore those signals. Muted earth-tones force the user to read the label, which is what we actually want them reading anyway. The "open flag" row uses an amber 2px left rule and a quiet uppercase tag — `amber · open · 6d` — instead of a giant `!`. Same information, fewer cortisol spikes.

**Alternatives considered:**

- *Tailwind default palette* — rejected: too saturated, too SaaS-y, no editorial gravity.
- *Pure monochrome (no accent)* — rejected: removes the one place we let the brand sing.
- *Multi-accent (rust + a secondary brand color)* — rejected for v0: keeps the system small and disciplined. Add later if we earn the need.

---

## Consequences

### Positive

- **The portal will look unlike any competing platform.** Cosmetic ERP and formulation tools are uniformly bland (Trace One, Specright, Centric PLM). PLX's sign-off screen will be visually memorable on first open, and that's a defensible brand asset.
- **The aesthetic earns trust appropriate to the regulated context.** A deed that looks like a deed reads as a deed.
- **Tokens are reskin-friendly.** Multi-tenant futures are not blocked: a Brand B can remap `--primary` and `--background` without touching components.
- **Restraint compounds.** Because the system rations color and ornamentation, the few accents we do use carry signal.

### Negative

- **Higher floor for new screen design.** Engineers cannot grab a Tailwind palette and make a screen look correct. They have to use the brand layer. This is a feature for design coherence and a tax on velocity. Mitigation: shadcn primitives + brand tokens cover ~80% of cases without thought.
- **Mazius Display is bundled.** The webfont files now ship under SIL Open Font License 1.1. Mitigation remains: Times New Roman / EB Garamond fallback works if the webfont fails to load.
- **The mono kicker pattern is easy to get wrong.** Without the right tracking, it looks like a debug label. Mitigation: utility class `.p-kicker` codifies the spec; reviewers should reject hand-rolled variants.
- **Earth-tone status colors fail accessibility audits if used at low contrast.** Mitigation: status colors are always paired with text labels (`amber · open · 6d`), never color-alone. AA contrast verified for all text-on-paper pairs in `tokens.css`.

### Neutral

- This decision is **for the customer portal**. It does not bind the public marketing site or the internal admin/operations tools, both of which can opt in or out via `data-brand="plx"`.

---

## Compliance & accessibility notes

- All text-on-surface pairs in `tokens.css` meet WCAG AA (4.5:1) for body text and 3:1 for large text. Verified manually; should be regression-tested in CI.
- Status hues are never the sole signaler. Every status color appears with a text label or a glyph (the `+` chassis tick is decorative; the status pill content carries the meaning).
- Mono kicker labels at 9px are below the typical readability floor. They are intentionally **non-essential** information — running heads, project IDs, timestamps — that a user can choose to read. Critical text never appears at this size.

---

## How to revise this

If a future ADR supersedes this one, that ADR must explicitly state which of the three big bets is being changed and why. Do not change the type vocabulary, the chassis chrome, or the color rationing without an ADR. Token values can drift inside those constraints (e.g. swapping the rust hue) without a new ADR — bump `tokens.css` and note in the PR.

If the brand vocabulary changes wholesale (new owner, rebrand), retire this ADR with status `Superseded by ADR-NNN` and write the replacement.
