# Nontechnical proxy review (P6 closeout)

> Generated, non-authoritative consumer. Canonical architecture remains in
> `AGENTS.md` and `docs/modules/*`.

## Review scope

Plain-language comprehension pass on the Architecture screen and diagram pack
after P6 discoverability links landed in `README.md` and `AGENTS.md`.

## Verdict

**PASS** — a non-engineer can recover the five rules from the in-app labels,
footers, and the README/AGENTS entry points.

## Five rules (plain English)

1. **All work centers on a Task — YES.** Task is the central box; tools help you
   check out, update, and finish tasks.
2. **SharePoint is the official Task record; the operational database is
   separate — YES.** SharePoint keeps the official record; the app's database
   is a working copy and history, not the authority.
3. **The web app is not the final authority — YES.** The screen says the
   diagrams are a generated guide, not official; canonical truth lives in repo
   docs (`AGENTS.md`).
4. **Suggestions follow rules; agent tools are optional helpers — YES.**
   Rule-based routing suggestions; agent tools and external agents are optional
   and sit outside the core deployed app.
5. **Checkout, finish, audit, and evidence stay connected — YES.** Checkout and
   completion attach to tasks; audit and GitHub links hang off tasks.

## What could confuse a teammate

- "Generated consumer" needs the one-liner: *if the picture disagrees with the
  docs, trust the docs.*
- The third diagram is an interaction map, not a strict step-by-step order.

## Teammate summary (3 sentences)

Mission Control helps people review and finish work that always points back to a
Task. SharePoint keeps the official Task record; the app's database is a
separate working copy. Optional agent tools can help from your laptop, but they
do not replace SharePoint or the repo docs that define how the system really
works.

## Where to start

- In-app: https://mc.plxcustomer.io/?screen=architecture
- Repo pack: `docs/architecture/` (linked from root README)
