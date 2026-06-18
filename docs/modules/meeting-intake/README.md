# Module: meeting-intake

## What

The meeting → Mission Control bridge (EN-004 / WS-4). Captures action items from
designated Microsoft Teams meetings and turns them into **proposed** tasks in a
human-confirmed triage queue; a human **promotes** each one into a governed task
through the existing `addTask` path. One pipeline, two capture tiers:

- **Tier B** — native Microsoft Graph Meeting AI Insights (`aiInsights`,
  Copilot-licensed): structured `actionItems` (`title` / `text` /
  `ownerDisplayName`). Pure parse, no extraction to maintain.
- **Tier A** — raw transcript (`.vtt`) fallback: parsed to cues then run through
  an injectable, **in-tenant** extractor seam (default Azure OpenAI).

Explicitly **NOT** this module's job: creating tasks directly (promotion goes
through `mc-data`'s `addTask`), the directory/identity model (EN-003), the repo
allow-list (EN-002), or the SharePoint sync engine (`sync`). It depends on those;
it does not reimplement them.

## Why

Team meetings generate action items by hand today. This bridges the human gap
between a meeting and the plan **without** sacrificing governance: nothing
auto-enters the board. Items land as proposals with the meeting source attached
as evidence, and a human (the accountable owner) confirms owner + initiative
before they become governed tasks (Truth Before Action).

## How

Capture → draft → triage → promote:

1. **Gate** — the feature is OFF by default (`flag.ts`) and only **opted-in**
   meetings feed in (`register.ts`). Both are checked before any capture.
2. **Capture** (`adapters.ts`) — `parseAiInsights` (Tier B, pure) or
   `transcriptToActionItems` (Tier A: `parseVtt` in `vtt.ts` → injected
   extractor). Both produce a normalized `MeetingActionItem[]`.
3. **Draft** (`draft.ts`) — `draftProposedTask` normalizes each item to a
   `ProposedTask`: suggested title, owner resolved against the EN-003 directory
   by display name (`resolveOwnerByDisplayName` — confident match only, else
   null), candidate bucket, and the transcript snippet/timestamp as evidence.
4. **Triage** (`store.ts`) — proposals queue in the module's reactive store
   (`useMeetingIntakeVersion` in `hooks.ts`); the `MeetingIntakeView` UI renders
   only when the flag is on.
5. **Promote** (`store.ts` → `promoteProposedTask`) — calls `addTask` (governed:
   accountable owner, allow-list repos via WS-2, ToDos mirror). The meeting
   source is written into the task description as a traceability artifact.
   `dismissProposedTask` drops a proposal.

Invariants: capture is a no-op unless `meetingIntakeEnabled()` AND the meeting is
opted in; promotion requires an initiative (no orphan tasks); transcripts never
leave the tenant; the kill switch (`tripMeetingIntakeKillSwitch`) forces the
feature off regardless of the flag.

External Integrations declaration: `config/integrations.yaml` (owner, scope,
auth source, default state = off, feature flag, kill switch, health check,
fallback path, data/audit boundary).

## Dependencies

- **mc-data** — `addTask`, `directory`, `pushNotice`, `BUCKET_IDX`, `CURRENT_USER`
  (promotion + owner resolution + initiative metadata).
- **secrets** — `graphCredentials` / `azureOpenAiConfig` (shared accessor) for
  the live Graph + in-tenant Azure OpenAI paths.
- **sync** — the governed task it promotes mirrors through the existing engine;
  this module does not call the engine directly.

Depended on by: the `web` app shell (the `intake` screen + flag-gated sidebar
entry).

### Key Files

- `src/lib/meeting-intake/types.ts` — type contracts (`MeetingSource`,
  `MeetingActionItem`, `ProposedTask`, `ActionItemExtractor`, register).
- `src/lib/meeting-intake/flag.ts` — feature flag + kill switch (off by default).
- `src/lib/meeting-intake/adapters.ts` — Tier B + Tier A capture adapters.
- `src/lib/meeting-intake/vtt.ts` — pure WEBVTT parser.
- `src/lib/meeting-intake/extract.ts` — in-tenant Azure OpenAI extractor (server-only).
- `src/lib/meeting-intake/draft.ts` — owner resolution + proposed-task drafting.
- `src/lib/meeting-intake/register.ts` — opt-in meeting register predicate.
- `src/lib/meeting-intake/store.ts` — reactive triage store (capture/promote/dismiss).
- `src/lib/meeting-intake/hooks.ts` — React binding.
- `src/lib/meeting-intake/health.ts` — health surface (server-only).
- `src/components/mc/meeting-intake.tsx` — flag-gated triage UI.
- `config/integrations.yaml` — External Integrations declaration.

## Owner

Vince (vince@petrasoap.com)

## Criticality

Medium — net-new, off by default, human-in-the-loop. A failure degrades to "no
proposals captured"; it never auto-mutates the governed plan.
