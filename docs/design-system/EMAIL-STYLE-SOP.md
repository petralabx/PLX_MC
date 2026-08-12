# EMAIL STYLE SOP — PLX Transactional Email

> **Version:** 1.1 · **Effective:** 2026-08-12 · **Extends:** v1.0 (2026-06-24)
> **Tokens:** UNCHANGED — the ADR-007 palette is canonical and respected.
> **Scope:** Every PLX-templated email — customer-, supplier-, staff-facing, **and ops/agent sends** (Graph mail from `cos@`).
> **Destination:** `docs/design-system/EMAIL-STYLE-SOP.md`

Email clients cannot resolve `var(--p-*)`, so brand tokens are mirrored as literal hex
in **one module**: `portal/src/lib/notifications/email-theme.ts`. Build every email
through that module — never hand-roll inline HTML in a route, script, or agent session.

## What changed in v1.1

1. **No palette or geometry changes.** The v1.0 `EMAIL` constants stand: sage-tinted
   recess `#ECEFE9` (`--p-paper-2`, per ADR-007), muted `#6B665B`, card 8px / button
   4px / box 6px radii. `tokens.css` and `brand-tokens.css` stay exactly as they are;
   `npm run audit:tokens` keeps the mirror honest.
2. **Shell rebuilt table-based** (nested tables + `bgcolor`) so Outlook's Word engine
   keeps the ink header bar. The div-based v1.0 shell dropped it, leaving paper-colored
   header text invisible on white — the "Customer Portal" ghost-text bug. Buttons are
   table-based too, so padding renders.
3. **New helpers:** `emailKV` (credentials/meta), `emailLink` (secondary CTA),
   `emailDivider`, shared `escapeHtml`.
4. **Usage rules tightened** (§5): soft tones tint boxes only — never full-width
   bands; secondary CTAs are forest sans links, never underlined mono strings.
5. **Archetype taxonomy added** (§3) — the six kinds of PLX email and their patterns.
6. **Scope widened:** ops/agent sends (Cursor sessions, cron scripts, plx-graph-mail)
   must render through `emailShell` like any route.

## 1. Palette (email-safe, v1.0 values — verbatim)

| Role | Hex | Token |
|---|---|---|
| Page background / footer band / KV inset | `#ECEFE9` | `--p-paper-2` (ADR-007) |
| Card | `#FBFAF6` | `--p-paper` |
| Header bar / buttons | `#1B1A17` | `--p-ink` |
| Text on ink | `#FBFAF6` | `--p-paper` |
| Headings | `#1B1A17` | `--p-ink` |
| Body copy | `#3A3833` | `--p-ink-2` |
| Kicker / meta / footer | `#6B665B` | `--p-muted` |
| Hairline | `#E4E0D6` | ≈ `--p-grid` |
| Soft hairline | `#EFEBE2` | ≈ `--p-grid-2` |

Status (solid / soft): forest `#244A39`/`#BCCFBF` (links, CTA hover — rationed; the soft
tints boxes/rules only, never a field); sage `#5C7A55`/`#EAF0E6` (approved/signed);
amber `#C99340`/`#FAF1DF` (pending/revision/expiry); steel `#5B7B91`/`#E8EFF3` (info);
mineral `#52606E`/`#E7EAEC` (rejected/destructive **only** — not red).

## 2. Type

| Job | Stack |
|---|---|
| Sans (body) | `'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif` |
| Serif (title) | `Georgia, 'Times New Roman', serif` |
| Mono (labels/data) | `'JetBrains Mono', 'IBM Plex Mono', Menlo, Consolas, ui-monospace, monospace` |

Kicker mono 11/0.16em caps muted · title Georgia 22/1.3 ink, sentence case, ≤1 italic
forest `<em>` · body sans 14/1.65 · footer mono 10/0.14em caps · button mono 12/0.08em
caps, 4px radius. Mono never runs body text.

## 3. Archetypes — the kinds of PLX email

| # | Archetype | Job & pattern | Builders |
|---|---|---|---|
| 01 | Outcome | A decision landed. Kicker states it, tone box proves it, one CTA. | `documentApprovedEmail`, `documentRejectedEmail`, `formRequestCompletedEmail` |
| 02 | Action required | Recipient must do one thing. Calm copy, deadline visible, quoted feedback in a warn box, one button. | `revisionRequestedEmail`, `formRequestEmail`, `sourcingRequestEmail`, UAT retest |
| 03 | Access & credentials | Accounts, invites, resets, test logins. Credentials in `emailKV`, expiry in a warn box. | `welcomeEmail`, `userInviteEmail`, `passwordResetEmail` |
| 04 | Digest / report | Cron summaries. Counted rows, mono figures, hairline separators, one dashboard CTA. | `dailyDigestEmail`, `send-status-email.ts` |
| 05 | Staff alert | Internal ping. No greeting — KV data first, one button. Terse. | `documentUploadedStaffEmail`, `creditAppSubmittedStaffEmail`, `qcPreviewFeedbackEmail` |
| 06 | External & formal | Suppliers/partners. Formal serif, attachment note in an info box, reply-driven — buttons optional. | `purchaseOrderEmail`, capabilities-deck delivery |

## 4. Building blocks

`emailShell` (the frame — every send) · `emailKicker` · `emailParagraph` · `emailButton`
(ink, 4px radius, mono caps — **one per email**) · `emailLink` (forest sans underline —
secondary CTAs; never underlined mono) · `emailBox(html, tone)` · `emailKV(rows)` ·
`emailMono` · `emailDivider` · `escapeHtml`.

## 5. Authoring rules

**Do:** render through `emailShell` (routes, scripts, and agent/Graph sends alike);
pull every color from the `EMAIL` constant, never raw hex; escape user values in body
**and** preheader; set a preheader on customer sends; send from verified
`support@plxcustomer.io` (ops sends: `cos@petrasoap.com` via plx-graph-mail); sentence
case everywhere, uppercase only via tracked mono; correct tone semantics
(approved→ok, rejected→hot, pending/expiry→warn, FYI→info).

**Don't:** hand-roll email HTML; introduce off-token hex (zinc/tailwind defaults,
`#16a34a`, `#dc2626`, …); saturated red/green/blue status; shadows, gradients, images,
icons, emoji; any soft color as a full-width field; underlined-mono link strings as
CTAs; mono running text; webfont-only stacks; `*-git-staging-*.vercel.app` URLs;
unverified From domains.

**Out of scope:** DocuSign envelope documents, WMS print/label templates, user-composed
Outlook/Graph passthrough.

## 6. Verifying

`cd portal && npm run audit:tokens` · off-brand hex sweep · render
`uat-agent-emails.render.test.ts` · spot-check one send in Outlook desktop (Word
engine): ink header visible, backgrounds intact, button padded.
