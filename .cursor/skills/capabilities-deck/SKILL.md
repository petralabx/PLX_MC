---
name: capabilities-deck
description: >-
  Interview PLX users and turn an opportunity, source deck, or customer brief
  into a compelling confidential pitch microsite, presentation-clean PDF, and
  email-ready delivery using the typed microsite engine. Use for capabilities
  decks, innovation or diversification pitches, second-source / technical
  transfer proposals, multi-concept product proposals, or PAUME-style customer
  microsites.
---

# Capabilities Deck

A confidential, public (`noindex`) **multi-section pitch microsite** built on the
typed microsite engine. Lives at `/<slug>` on **staging only**.

Use this for a **multi-concept pitch** (opportunity → concepts → why-us →
capability → diversification → commercial → pricing → begin → close). For a
**single-product sample / reformulation update**, use
[sample-feedback-deck](../sample-feedback-deck/SKILL.md) instead.

## Engine (data-only + thin route)

Adding a brand microsite is a **data change plus a thin route folder** — the
renderer is shared. Canonical engine: **`portal/src/lib/microsites/`** and
**`portal/src/components/microsite/`**.

- `schema.ts` — the `MicrositeSpec` Zod contract. Sections: `hero`,
  `opportunity`, `capability`, `why`, `trinity`, `concepts[]`,
  `diversification`, `commercial`, `pricing`, `begin`, `close`, `contact`. Rich
  headings are arrays of `{ text, em? }` segments (real JSX, not HTML strings).
- Capability rows accept evidence-backed percentages or non-numeric status
  labels. Concepts may rename the default `Hero claims` list with `claimsLabel`.
- `data/paume.ts` — multi-concept + pricing example.
- `data/foot-powder.ts` — single-concept + no-pricing example.
- `registry.ts` — slug → spec map.
- `components/microsite/microsite.tsx` — renders any spec.

## Guided discovery — ask, do not hand the user a schema

Read [INTAKE.md](INTAKE.md). Inspect supplied files, links, and the brand's
current public materials before asking questions.

Rules:

1. Ask in short rounds (maximum five questions), starting with meeting audience,
   desired decisions, current relationship, source materials, confidentiality,
   and delivery deadline.
2. Ask only what cannot be inferred or verified. PLX users should describe the
   opportunity in business language, not fill `MicrositeSpec` sections.
3. Treat existing-business quote, technical-transfer / second-source review,
   and new-concept samples as independent lanes. Give each lane its own decision
   and CTA.
4. Maintain a source ledger: `customer-provided`, `brand-verified`,
   `PLX-verified`, `proposal`, or `unknown`.
5. Never invent pricing, volume, timing, capacity, certifications, formula
   approval, or finished-product efficacy. Omit unsupported sections.
6. Confirm output mode: microsite, PDF, email-ready summary, or all three; draft
   versus send; recipients; and approval owner.

The deck is a **decision instrument**, not a brochure. Every major section must
help the meeting audience understand an opportunity, evaluate PLX, or make the
next decision. It must also work when presented live, skimmed from an email
link, or read as a PDF without narration.

## Workflow

```
- [ ] 1. Worktree off staging + bootstrap
- [ ] 2. Author data/<slug>.ts (MicrositeSpec)
- [ ] 3. Register the slug
- [ ] 4. Add the route + make it public (noindex)
- [ ] 5. Add imagery
- [ ] 6. Harden + validate
- [ ] 7. Publish to staging + verify live
- [ ] 8. Export a print-clean PDF
- [ ] 9. Archive PDF to SharePoint (`08-Marketing & Brand`)
- [ ] 10. Register CustomerPitch on the customer record (Pitch library)
- [ ] 11. Email the PDF to the operator (vince@petrasoap.com)
```

1. **Worktree + bootstrap** — off `staging`; run
   `scripts/bootstrap-worktree.ps1` (see `.cursor/rules/worktree-bootstrap.mdc`).
2. **Author the spec** — `portal/src/lib/microsites/data/<slug>.ts`, copying the
   closest worked example; satisfy `schema.ts`. Turn the decision map into a
   narrative: stakes → opportunity → concept/business lanes → why PLX →
   commercial decision table → explicit next steps. Keep proposals visibly
   distinct from verified facts.
3. **Register** — add `[<slug>.slug]: <slug>` to the map in
   `portal/src/lib/microsites/registry.ts`.
4. **Route** — copy `portal/src/app/paume/page.tsx` to
   `portal/src/app/<slug>/page.tsx` (set `SLUG`); add `"/<slug>"` to
   `PUBLIC_ROUTES` in `portal/src/middleware.ts`. Keep `confidential: true`
   (→ `noindex`). **Default frictionless:** do **not** set `accessGate` and do
   **not** wrap the deck in `AccessGate` unless the operator explicitly asks for
   a soft company-name obscurity lock. Customers read that screen as a broken
   password page when they do not know the unlock word (ALDI deodorant, 2026-07-30).
   Prefer share-link + PDF; if a gate is required, put the unlock word in the
   share email and add helper copy on failure.
5. **Imagery** — add an OG image and one image per concept. If the brand provides
   none, ask whether to use verified public brand imagery as a clearly labelled
   current-format reference or to generate concept imagery. Never present a
   reference image as an approved product.
6. **Harden + validate** — run the **ui-ux-design-loop** skill's gate pack (axe
   clean in both light and dark); then
   `cd portal && npm run typecheck && npm run lint && npm run build`
   (prefix `NODE_OPTIONS=--max-old-space-size=8192` if the webpack build OOMs).
7. **Publish** — commit, open a PR against `staging`, and babysit it to green +
   merge (the **babysit** skill); the merge auto-deploys to
   `https://staging.plxcustomer.io/<slug>`. Confirm the live URL returns 200.
8. **PDF export** — produce a **print-clean** PDF (see "PDF export" below). Never
   ship the naive full-page render of the live microsite — its grids fragment.
9. **Archive PDF** — upload the verified PDF to the customer SharePoint folder
   `08-Marketing & Brand` (mandatory — see [ARCHIVE.md](ARCHIVE.md)).
10. **Register Pitch library row** — create or upsert a `CustomerPitch` on the
    customer record so staff can reopen the deck from admin and the PD pipeline
    (mandatory — see [PITCH-LIBRARY.md](PITCH-LIBRARY.md)). Prefer the admin UI;
    use the admin API or `register-customer-pitch.mjs` when headless.
11. **Email** — prepare the email-ready summary (include live URL + PDF archive
    link), then draft or send exactly as authorized (see "Email delivery").

## PDF export

The microsite is a scroll-designed web layout; a naive `page.pdf()` of the live
URL paginates badly (grey voids, collapsed columns, half-cut images). Prefer a
**dedicated Letter print HTML** (or an equivalent print stylesheet) that reflows
the narrative — do **not** ship a Chromium screenshot of the scroll deck as the
customer leave-behind.

**First-class Letter polish (ALDI deodorant, 2026-07-30):**

1. **PLX design system, not a parallel look.** Load Mazius Display + Inter +
   JetBrains Mono; use `--p-paper` / `--p-ink` / `--p-accent` (`#244A39`) /
   `--p-grid` / `--p-muted` / `--p-rail`. Microsite lane accents stay
   `--c-forest` / `--c-amber` / `--c-steel`. No Fraunces/IBM Plex / invented gold.
2. **Own the margins on the page box.** Chrome headless is unreliable with
   `@page { margin }`. Use `@page { size: letter; margin: 0 }` and
   `.page { height: 279.4mm; padding: ~22mm }` so text never kisses the trim.
   Measure with `pdftoppm` + pixel→mm (target ≥18–22mm).
3. **Fill the folio — do not vertically center a tiny block.** Sparse top-third
   layouts read unfinished. Grow section panels (`flex: 1`) and scale type /
   padding so each page uses the Letter frame; leave calm unused area *inside*
   framed panels, not empty bands above/below a floating card.
4. **Do not pin body copy to the panel footer** (`margin-top: auto` on card
   paragraphs) — that creates a sandwich void in the middle of tall panels.
5. **Progress rails must read Done / Now / Todo** (filled vs current vs open),
   with an explicit “Step N of M · Now” label when a path is mid-flight.
6. **PDF stands alone.** No “optional web gate” language. If a staging URL is
   included, state the unlock word only when a gate still exists (default: none).
7. **Verify every page raster** (`pdftoppm`) — page count alone is not QA.

**Also still true for print-CSS-on-live-microsite attempts:**

- **Hairline grids fragment.** Convert `gap: 1px` faux grids to flex + per-child
  `1px solid var(--p-grid)` borders under `@media print`.
- **Fixed heights strand whitespace.** `min-height: 0 !important`; drop sticky.
- **Orphaned headers / split cards.** Glue `.sec-head` to its grid; avoid
  `break-inside: avoid` on whole tall `section`s.
- **Protect product-format references.** `object-fit: contain` in a fixed frame
  when the whole pack is evidence; reserve `cover` for croppable lifestyle art.
- **Render discipline:** fonts ready, images `complete`, reveal animations on,
  then `page.pdf({ printBackground: true, preferCSSPageSize: true })`.

**Responsiveness requirement:** all print/reformatting rules live inside
`@media print` (and normal responsive breakpoints stay intact). The screen
microsite must remain fully responsive — never let a print override leak into
the on-screen layout, and re-check the live route at mobile/tablet/desktop after
touching shared CSS.

## Email delivery

Use the **plx-graph-mail** skill and Microsoft Graph on the Windows workstation.
Confirm recipients, draft-versus-send authorization, and sender before acting.

**Canonical template:** [EMAIL.md](EMAIL.md) — customer card (name, website,
LinkedIn, HQ, category), meeting block, opportunity synopsis, staging deck URL,
and a **presentation guide** with deep links to each included section (`#top`,
`#opportunity`, `#concepts`, `#{{concept.id}}`, `#why`, `#commercial`, `#begin`,
`#contact`, …). Omit rows for sections the deck does not ship.

Also:

- attach the verified print-clean PDF when one was exported in the same delivery
- state that concept imagery/formulas are directions when applicable
- identify the PLX contact and meeting date

Confirm Graph returns success. If re-sending a corrected file, say explicitly
that the new attachment supersedes the prior version.

## Done

- `data/<slug>.ts` validates against `schema.ts`; registered; route + middleware
  wired; imagery present
- axe WCAG A/AA clean both themes; typecheck + lint + build pass
- Live at `staging.plxcustomer.io/<slug>`
- Print-clean PDF exported (every page verified — no grey voids, collapsed
  columns, or cut-off sections/images), **archived to SharePoint**
  (`08-Marketing & Brand`), **registered in the customer Pitch library**
  (`CustomerPitch` with live URL + SharePoint URL + meeting date + status), and
  emailed to the operator with both the live URL and the archive link

## Notes

- **Public-link boundary:** `confidential: true` adds the visual label and
  `noindex,nofollow`; it does not authenticate the viewer. Obtain accountable-
  operator approval before publishing a link-accessible pitch. If the content
  must be restricted by identity, use an authenticated portal route instead —
  **not** `accessGate` (soft company-name obscurity only; customers confuse it
  with a broken password wall).
- **Default open:** frictionless staging link after operator approval. Soft gates
  are opt-in only.
- **Staging only** (`.cursor/rules/staging-environment.mdc`). Production needs
  explicit operator approval.
- The engine renders structured segments — never `dangerouslySetInnerHTML`.
- Keep it confidential until the operator approves sharing the link.
