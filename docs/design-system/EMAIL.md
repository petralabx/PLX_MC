# PLX Email Standard (Mission Control reference)

> **Version:** 1.1 · **Effective:** 2026-08-12
> Brand authority for **code** remains `petralabx/plx-customer-portal`
> (`portal/src/lib/notifications/email-theme.ts` on `staging`).

## Files in this repo

| File | Purpose |
|---|---|
| [`EMAIL-STYLE-SOP.md`](./EMAIL-STYLE-SOP.md) | Authoring rules, archetypes, do/don't |
| [`plx-email-standard.html`](./plx-email-standard.html) | Self-contained visual standard — open in any browser |

## Rule for every agent (Cursor, Cloud, Claude, Grok)

When sending any PLX email (ops digests, UAT retest, owners tour, Graph from
`cos@`):

1. Follow `EMAIL-STYLE-SOP.md`.
2. In the portal repo, render through `emailShell` and the helpers in
   `email-theme.ts` — never hand-roll HTML.
3. Use skill `plx-graph-mail` for Graph transport + validate-before-send.
4. Staging links only: `https://staging.plxcustomer.io` (never the vercel.app
   git alias).

Portal cursor rule: `.cursor/rules/plx-email-standard.mdc` (always applied).
