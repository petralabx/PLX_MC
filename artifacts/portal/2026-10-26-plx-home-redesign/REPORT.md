# PLX Home redesign — handoff (2026-10-26)

**Owner:** Vince Alton (vince@petrasoap.com) · **Repo:** petralabx/plx-customer-portal · **Target:** staging
**Design canvas (private, Vince's account):** https://claude.ai/artifact/HJrnhPwxvxRNezUv1sFo4i
**Source session:** https://claude.ai/code/session_01B2EgeXNtFVewtaK8aboQhX

## Outcome

Staff no longer land on the empty customer dashboard. After sign-in they reach `/mrp`, which now leads with what needs
them and states when its numbers were taken. Seven PRs merged to staging on 2026-10-25 and 2026-10-26. No schema change.
Nothing is on production yet.

## What changed

1. **Landing.** Staff go to `/mrp`, everyone else to `/dashboard`. Safe deep links still win. (TASK-3890, #3012)
2. **Awaiting you panel.** Up to five rows, oldest first, from work routing, sourcing, stability pulls and the planning board,
   filtered by department, MRP grants and department tags. One action per row. Only the panel refreshes every 60 s. (TASK-3896, #3017)
3. **Planner cues.** Six cues from the planning data path replace the catalogue counts when `PLX_HOME_CUES_ENABLED` is on.
   The flag is off. (TASK-3895, #3016)
4. **Lower half of `/mrp`.** Today on the floor, Sales orders at risk, Recent activity, Jump back in, Go to with G-then-key
   shortcuts. Hard-coded Site, Compliance and Open flags cells, module tiles and "Live" dots removed. Export moved to `/mrp/reports`. (TASK-3897, #3018)
5. **Footer.** Compliance line and a FileMaker sync time read from the ingest watermark. (TASK-3897, fixed by TASK-3908, #3022)
6. **Teams.** PO approver DMs now use the Entra object id and are awaited. (TASK-3898, #3015)
7. **Docs.** Microsoft integration docs corrected against the code; stale Teams manifest archived. (TASK-3900, #3014)

Every read on Home returns `QueryResult<T>`. A failed source says "unavailable", never a false zero.

## Open work in Mission Control

| Task | Kind | Owner | What |
|---|---|---|---|
| TASK-3935 | human-test | Vince / UAT | UAT the redesign on staging, 10 steps in the task |
| TASK-3936 | decision | Vince | Turn on `PLX_HOME_CUES_ENABLED` on staging; pick the Materials short cue target |
| TASK-3899 | admin-setup | Entra admin | Confirm the daemon app's Teams roles; enable channel routing on staging. Prompt: `operations/TASK-3899-entra-operator-prompt.md` |
| TASK-3937 | code | agent | Graph subscription renewal threshold exceeds the 29-day lifetime |
| TASK-3938 | code | agent | used-consumption and projected-revenue parse the sync watermark in server-local time |
| TASK-3939 | code | agent | Awaiting you sourcing count is a floor above 25 open requests |

Not filed, needs a priority call first: the Microsoft 365 moves in `research/03-microsoft-365-interoperability.md`
(Teams activity-feed nudge, Home as a Teams tab, BC cues and deep links, SharePoint change rows, BC Role Center card part).

## Decisions made along the way

- Landing is resolved server-side in the root page with the same coarse gate the `/mrp` layout uses, so landing and layout agree in RBAC enforce mode.
- Role views use existing data: gold `Department` membership (QC/QA under QUALITY), MRP grants and `departmentRoles` tags. No new role model.
- Materials short cue opens `/operations/scheduling` because `/mrp/planning` does not list shortages (open in TASK-3936).
- Cue colour tokens are MRP-local in `mrp-design.css`; the design-system release gate hashes `design-system/tokens.css`.
- The stale Teams manifest went to `artifacts/research-archive/` because the portal repo has no root `archive/`.

## Gate lessons (also in PLX_MC `LESSONS.md`)

1. A second push after a re-checkout carries a new `MC-Checkout` trailer. Add that stamp to the PR body, or `compliance` blocks.
2. The strict RBAC coverage audit runs in the lint job only once a PR leaves draft. Run `npm run audit:rbac` locally before Ready for review.
3. `ai-review/verdict` needs a plx-agents[bot] marker from a reviewer outside the author's family; a Claude-authored PR waits for Astra or sol-6.1.

## Bundle contents

| Path | What |
|---|---|
| `REPORT.md` | This handoff |
| `merged-prs.md` | PR ledger, surfaces, rollback |
| `research/01-…` | Codebase findings: journey and the old MRP Dashboard |
| `research/02-…` | External research: home pages, MRP/ERP dashboards, UX rules |
| `research/03-…` | Microsoft 365: done vs not, ranked opportunities |
| `design/canvas.json`, `design/artboards/*.dc.html` | Canvas source: journey, proposed Home (4 roles), anatomy, phone, Microsoft board |
| `operations/TASK-3899-entra-operator-prompt.md` | Paste-ready prompt for the Entra admin step |
| `operations/agent-shipping-preamble.md` | Paste-ready shipping rules for portal agent sessions |
| `mission-control/tasks.jsonl` | Live export of every task in the programme at handoff time |

The `.dc.html` artboards need the canvas runtime to render. Open the canvas link to view them.
