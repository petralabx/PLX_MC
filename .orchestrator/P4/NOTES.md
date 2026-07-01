# P4 Skills Directory UI Notes

## Scope

- Added detail-view Install and Sync actions that call the P2 install/sync-check APIs and render copyable Bash and PowerShell scripts in a modal.
- Added an index-level Submit for review panel that posts candidate skill submissions to `/api/skills-directory/submit`.
- Added an approver-only Review queue tab using `isApprover(ACTORS[CURRENT_USER])`, with approve/reject PATCH actions against `/api/skills-directory/submissions/:id`.
- Kept changes out of `src/lib/github-app/**`.

## Verification

- Target commands:
  - `npm test -- skills-directory`
  - `npx playwright test e2e/skills-directory.spec.ts --project=chromium`

## Notes

- Submit form captures the requested skill id, description, and pasted `SKILL.md`; the `SKILL.md` content is carried in `notes` because the existing P2 submission schema does not expose a dedicated content body field.
- Sync uses `/api/skills-directory/sync-check` for drift summary and `/api/skills-directory/install` with `mode: "sync"` for the copyable scripts.
