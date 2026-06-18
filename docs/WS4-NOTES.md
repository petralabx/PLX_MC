# WS-4 — Meeting → Mission Control bridge (EN-004)

Branch: `feat/enh-ws4-meeting-bridge` (off `feat/enhancements-integration`)
Worktree: `~/.cursor/worktrees/ws4-meeting-bridge-f02ca897/PLX_MC-feat-enhancements-2a03bb03d623`

## What WS-4 delivers

A meeting → Mission Control bridge: capture MS Teams meeting action items and
turn them into GOVERNED tasks via a human-confirmed triage queue. One pipeline,
two capture adapters. Ships **DISABLED BY DEFAULT** behind a feature flag + kill
switch (External Integrations governance). Nothing auto-enters the plan — a human
PROMOTES proposals into governed tasks through the existing `addTask` path.

## New module: `src/lib/meeting-intake/`

| File | Role |
|---|---|
| `types.ts` | `MeetingSource`, `MeetingActionItem`, `ProposedTask`, `ActionItemExtractor`, register + Graph payload shapes |
| `flag.ts` | Feature flag (`PLX_MC_MEETING_INTAKE_ENABLED`, off by default) + independent kill switch |
| `vtt.ts` | Pure WEBVTT parser (Tier A) |
| `adapters.ts` | Tier B `parseAiInsights` (pure) + Tier A `transcriptToActionItems` (parse → injected extractor) |
| `extract.ts` | **Server-only** in-tenant Azure OpenAI extractor (default seam) |
| `draft.ts` | `resolveOwnerByDisplayName` (EN-003 directory) + `draftProposedTask` (pure) |
| `register.ts` | Opt-in meeting register predicate (`isMeetingOptedIn`) |
| `store.ts` | Reactive triage store: capture (gated), `promoteProposedTask`, `dismissProposedTask`, opt-in register |
| `hooks.ts` | `useMeetingIntakeVersion` React binding |
| `health.ts` | **Server-only** health surface (`meetingIntakeHealth`) |
| `index.ts` | Client-safe barrel (excludes store/hooks/extract/health) |

UI: `src/components/mc/meeting-intake.tsx` — minimal triage surface reusing the
Inbox/repos row patterns, rendered only when the flag is on (the screen body and
the sidebar entry both gate on `meetingIntakeEnabled()`). Promote/Dismiss actions
with the proposed/unverified state + meeting source/snippet visible.

## Files changed

New:
- `src/lib/meeting-intake/{types,flag,vtt,adapters,extract,draft,register,store,hooks,health,index}.ts`
- `src/components/mc/meeting-intake.tsx`
- `config/integrations.yaml` (External Integrations declaration surface)
- `docs/modules/meeting-intake/README.md`
- `tests/meeting-intake.test.ts`

Modified (surgical, additive):
- `src/lib/secrets.ts` — added `graphConfigured`, `azureOpenAiConfig`/`azureOpenAiConfigured` (shared accessor; no scattered env lookups)
- `src/components/mc/route.ts` — `Screen` gains `"intake"`
- `src/components/mc/screens.tsx` — register `MeetingIntakeView`
- `src/components/mc/chrome.tsx` — flag-gated sidebar entry
- `src/styles/mc-record.css` — triage styles (`--p-*` tokens only)
- `AGENTS.md` + `docs/modules/README.md` — module table row (meeting-intake, Medium)
- `tests/mc-screens.test.ts` — screen-registry contract gains `intake`

## External Integrations declaration (ships disabled)

Declared in `config/integrations.yaml` (the contract carries the *rules*; there
was no per-integration declaration surface, so this is the new clearly-scoped
file the brief asked for). No governance-contract.yaml edit was needed, so the
generated surfaces stay aligned (preflight `--check` green).

- **Owner:** Vince · **Criticality:** Medium
- **Scope:** runtime, gated, **off by default** — not represented as deployed capability
- **Autonomous:** yes (derives proposed tasks) → requires explicit enablement
- **Feature flag:** `PLX_MC_MEETING_INTAKE_ENABLED` (+ `NEXT_PUBLIC_` for the UI gate)
- **Kill switch:** `tripMeetingIntakeKillSwitch()` — forces off regardless of the flag
- **Auth source:** Microsoft Graph (`graphCredentials`) + Azure OpenAI (`azureOpenAiConfig`), both via the shared `src/lib/secrets.ts` accessor
- **Health check:** `meetingIntakeHealth()` (`src/lib/meeting-intake/health.ts`)
- **Fallback path:** Tier B aiInsights → Tier A transcript + in-tenant extraction; capture is a no-op when off / not opted in; Tier A live path stays dormant + fails visibly when Azure is unconfigured (no fabricated items)
- **Data/audit boundary:** transcripts reasoned over IN-TENANT only (Azure OpenAI), never an external LLM; items land as PROPOSED in a human-confirmed queue; on promotion the meeting source (snippet + timestamp) is kept as a traceability artifact and mirrored via the standard ToDos path

## Behind the flag vs fixture-tested

- **Fixture-tested (hermetic, no live calls):** Tier B `aiInsights` parsing, Tier A
  `.vtt` parsing, the extractor seam (injected mock), owner resolution from a
  display name, capture gating (flag off / not opted in / kill switch), promote →
  governed task (owner + repo linkage + source citation), repo allow-list clamp,
  promote-without-initiative refusal, dismiss, and flag-off disabling promotion.
- **Behind the flag, env-gated (not exercised in tests/build):** the in-tenant
  Azure OpenAI extractor (`extract.ts`) is the default Tier A seam; it reads Azure
  config via the shared accessor and fails visibly when unconfigured. The server
  capture path wires it as the default; tests inject a mock instead.

## Deferred (with reason — no fabrication, build stays green)

- **Graph change-notification subscription wiring (SHOULD):** deferred. Creating a
  Graph subscription needs a public webhook notification URL, which this app does
  not yet expose; standing one up is its own External Integrations surface. The
  capture entrypoints (`captureFromAiInsights` / `captureFromTranscript`) accept
  payloads directly, so the webhook handler is a thin future addition that calls
  them. **TODO:** add the subscription + `/api/meetings/webhook` route when a
  public notification endpoint exists.
- **Persisting proposals/register across reloads + SharePoint mirror of the
  triage queue:** in-memory for now (reset by `resetMeetingIntake`), matching the
  prototype's not-yet-server-persisted surfaces (repo requests, bucket comments).
  Promoted tasks DO persist + mirror via `addTask`.

## Verification (all green — run in the worktree)

- `npm run typecheck` → exit 0
- `npm run test` → **22 files, 320 passed** (baseline 300; +20 in `tests/meeting-intake.test.ts`, plus the `intake` entry added to `tests/mc-screens.test.ts`)
- `npm run build` → success (no new routes; client bundle does not pull in the server-only secrets/extractor)
- `./scripts/preflight.sh --mode pre-commit` → all checks passed (governance surfaces aligned, hygiene clean, migrations clean, ruff clean, canary green, typecheck clean)
- Heavy Playwright E2E intentionally skipped (per brief).

## Notes for final integration / decisions needed

- **M365 Copilot licensing for the 6 users** decides the Tier A vs Tier B default
  at runtime (open item from the spec). The bridge supports both; no code change
  needed either way.
- **Webhook endpoint** must be decided before the live Graph subscription can be
  wired (the only meaningful deferral).
- Pre-existing lint at `src/components/mc/shell.tsx:134` was left untouched (not
  WS-4; ESLint isn't in the preflight gate).
- Shared-file edits (`secrets.ts`, `route.ts`, `screens.tsx`, `chrome.tsx`,
  `mc-record.css`, `AGENTS.md`, module index) are additive and localized.
