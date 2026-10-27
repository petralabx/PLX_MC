# ADR-006: Mission Control paints the sidebar width before first paint, without a cookie

**Status:** Accepted (TASK-3957)
**Date:** 2026-10-27
**Owner:** Vince Alton
**Deviates from:** portal ADR-011 (PLX shell contract), v2 amendment, Width 6 (`plx-customer-portal`
`docs/design-system/decisions/ADR-011-plx-shell-contract.md`)

> Numbered in this folder's sequence (ADR-001 to ADR-005). Portal ADR-011 says a Mission Control
> deviation from its amendment needs an ADR in this repo; this is that ADR.

## Context

Portal ADR-011's v2 amendment lets a person drag the sidebar between 232 and 400px and collapse it to
the rail. Width 6 says: "Each browser keeps its own width and collapsed state, with a cookie copy, so
the server renders the right width first."

Mission Control's `/` is one static page (`src/app/page.tsx` renders `MissionControlShell`; `next
build` lists it as `○ (Static)`). For the server to read a cookie, the page would have to render on
every request. That changes how the whole app is served, to fix one CSS width.

## Decision

1. Mission Control keeps the width (`mc.side.w`, 232 to 400) and the rail choice (`mc.side.rail`) in
   `localStorage`, as it keeps the pane width (ADR-005).
2. CSS reads them from `<html>`: the `--mc-side-w` property and `data-mc-side="rail"`.
3. A small script in `<head>` (`SIDE_BOOT_SCRIPT`, `src/components/mc/side-boot.ts`) copies the stored
   values onto `<html>` before the first paint. The page stays static.
4. Every later change goes through `paintSide` (`src/components/mc/side-width.ts`), so `<html>` and
   storage never disagree. `<html>` carries `suppressHydrationWarning`, since the script changes its
   attributes before React hydrates.

The outcome Width 6 asks for holds: the first paint shows the person's width. Only the mechanism
differs.

## Consequences

- No cookie and no per-request render. The script is under 300 bytes, and it fails quietly when
  storage is blocked, leaving the 248px default.
- Until the default flip (TASK-3857), the server renders the classic sidebar for a person who opted
  into the new navigation, and the zoned one swaps in after hydration (TASK-3950). The width is already
  on `<html>` then, so the zoned sidebar arrives at the right width. After the flip the server renders
  the zoned sidebar, and the first paint is right.
- TASK-3950 can use the same script for the opt-in itself, instead of the cookie it proposes.
- MRP keeps the cookie Width 6 describes (TASK-3960): its `/mrp` layout already renders per request
  and reads the nav cookie.
