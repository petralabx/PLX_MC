# PRD — Human-verification evidence standard

- **Owner (accountable human):** Vince
- **Bucket:** `BKT-HUMAN-VERIFICATION-EVIDE` (project `PRJ-PLX-MC-FRONTIER`)
- **Risk tier:** High for step 2. It adds a project-ACL check (`src/lib/permissions/`).

## Problem

Agents create tasks, SOPs and PRs that a person must check. Today their text is long, and a person gets nothing to look at. A person needs short, clear text and a picture or a video.

## When it applies

A person must verify the work when one of these is true:

- The task has the label `verify:human`.
- The task is `kind:human-test`.
- The change is high risk: migrations, auth or permissions, infra, workflows, deploy.

Work is complex when one of these is true:

- The change is high risk.
- The human procedure has more than 5 steps.
- The work touches 2 or more systems.

## Decisions (Vince, 2026-10-17)

1. Text follows STE-lite, the measurable part of ASD-STE100.
2. Simple work needs a diagram, an annotated screenshot or a web page.
3. Complex work from an agent also needs an explainer video.
4. Evidence goes to SharePoint: the PLX site, library `Mission Control`.
5. The folder is `<system>/<project>/<bucket>/<task id>`.
6. Trading Lab (`petralabx/agentic-swarm`) evidence goes on its own site, never the PLX site.
7. The video uses the `plx-knowledge-video` skill. Piper is the fallback voice for now.
8. Each new rule warns for one week, then blocks.
9. Agents never create a library or grant access. A person does that.
10. A PR that affects a module links to each module, process or screen it changed.

## Steps

| Step | Task | What ships | State |
|------|------|------------|-------|
| 1 | TASK-3165 | STE-lite check on agent text; warns until 2026-10-24 | Shipped (#352, #353) |
| 2 | TASK-3166 | `mc_upload_evidence` and the visual-evidence gate; warns until 2026-11-01 (moved from 2026-10-25: uploads were still off) | #354 |
| 3 | TASK-3167 | Explainer video for complex work | Not started |
| 4 | TASK-3168 | PR deep-link check | Not started |

## Restricted projects

The `Mission Control` library inherits the site's permissions. Everyone with library access could read a restricted project's evidence. So MC refuses uploads for a restricted project, and the gate only warns for it. A person must set up a destination that keeps the project's access rules first.

## Out of scope

- Creating the SharePoint library or a Trading Lab site.
- Granting the MC app access to a site.
- Evidence for work that no person must verify.

## Rollback

Each step ships behind its own warn-only week. Revert the step's PR to remove it. Uploads stay off until a person sets `PLX_MC_EVIDENCE_STORE_ENABLED=1`.
