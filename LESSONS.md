# LESSONS.md

<!-- The institutional memory file. Every correction, incident, or surprising
     failure becomes a dated entry here. Agents read this at session start and
     must not repeat documented mistakes. Recurring lessons get promoted into
     .cursor/rules/ so they are enforced, not just remembered. -->

## How to write an entry

- Date it (YYYY-MM-DD, with timezone if relevant).
- State what went wrong in one line.
- State the root cause in one line.
- State the rule going forward — actionable, checkable, present tense.
- If the lesson recurs 3+ times, promote it to a rule in `.cursor/rules/`
  and/or a gate in `scripts/preflight.sh`, then note the promotion here.

## Lessons

### 2026-06-11 (ET) — PowerShell 7 round-trip de-escaped prod/ec2-secrets unicode

- **What happened:** Merging `PLX_MC_DATABASE_URL` into `prod/ec2-secrets` via
  `ConvertFrom-Json | ConvertTo-Json` re-stored a `\uE10D` escape as a raw
  UTF-8 char; the AWS CLI's cp1252 output path then failed on every
  `get-secret-value`, breaking `~/load-secrets.ps1` until the secret was
  re-stored with `json.dumps(..., ensure_ascii=True)` via boto3.
- **Root cause:** PowerShell 7's `ConvertTo-Json` emits raw non-ASCII; the
  secret's loader-safety depends on the stored JSON staying ASCII-escaped.
- **Rule going forward:** Never round-trip `prod/ec2-secrets` through
  PowerShell JSON cmdlets. Mutate it with a tool that guarantees
  `ensure_ascii` output, and verify the loader fetch path immediately after
  any write.

### 2026-06-11 (ET) — IDE-browser snapshots fake React hydration errors

- **What happened:** The dev overlay reported hydration text mismatches
  (first in `Topbar`, later in `InboxView`), suggesting an SSR/client bug in
  the store's API hydration. The overlay's actual diff was
  `- data-cursor-ref="e37"` — an attribute the Cursor IDE browser's
  accessibility-snapshot tooling injects into the live DOM, tripping React's
  hydration comparison (the documented "extension messes with the HTML
  before React loads" case). Time was spent chasing an app bug that did not
  exist.
- **Root cause:** Snapshot instrumentation mutates the DOM while React is
  hydrating; React attributes the mismatch to the nearest component.
- **Rule going forward:** Before chasing a hydration error seen in the IDE
  browser, read the overlay's +/- diff first; if it names `data-cursor-ref`
  (or any non-app attribute), it is tooling noise — verify in a plain
  browser only if doubt remains.

### 2026-06-11 (ET) — Idle RDS pool connections hang requests without timeouts

- **What happened:** After ~80 idle minutes, the dev server's pooled Postgres
  connections had been silently dropped; the next `/api/state` request checked
  out a dead socket and hung forever (no error, no timeout) — burning two
  long waits before the root cause was found. A fresh connection to the same
  database worked instantly.
- **Root cause:** `pg.Pool` was created with no `connectionTimeoutMillis`,
  `query_timeout`, `idleTimeoutMillis`, or `keepAlive`; defaults wait
  indefinitely on dead sockets.
- **Rule going forward:** Every outbound network client gets explicit
  timeouts at creation time — pools (`connectionTimeoutMillis`,
  `query_timeout`, `idleTimeoutMillis` below the path's idle-kill window,
  `keepAlive`) and HTTP fetches (`AbortSignal.timeout`). A hanging request is
  worse than a failing one. Fixed in `src/lib/db` and `src/lib/sync/graph.ts`.

### 2026-06-10 (ET) — Killed an unrelated dev server with a too-broad process filter

- **What happened:** While clearing stray Next dev servers for this repo, a
  `node.exe` CommandLine filter of `next|PLX_MC` also matched and killed the
  operator's separate `vmc-web` dev server (port 3100). It was restarted to
  restore prior state.
- **Root cause:** The kill filter matched any process mentioning the framework
  name, not just this repository.
- **Rule going forward:** Scope process kills to this repo's full path
  (`C:\Users\agentic-winrm\PLX_MC`), never a bare framework name; print and
  eyeball the match list before issuing `Stop-Process`.

### 2026-06-10 (ET) — `localhost` in the IDE browser is not this box

- **What happened:** The IDE browser showed a different app at
  `http://localhost:3000` than this box's dev server; the browser runs on the
  operator's machine, so `localhost` resolved there.
- **Root cause:** Browser and dev server are on different hosts; the dev server
  is reachable only via this box's Tailscale IP, and Next blocks cross-origin
  `_next` dev assets by default (so the page renders but never hydrates).
- **Rule going forward:** View this box's dev server via its Network/Tailscale
  URL (printed by `next dev`) and add that origin to `allowedDevOrigins` in
  `next.config.ts` so client chunks load and hydration works.

### 2026-06-10 (ET) — Reported files missing without fetching first

- **What happened:** The founding session reported `starter-kit/` absent and
  asked the operator how to obtain it; it had been pushed after the clone and
  a plain `git pull` delivered it.
- **Root cause:** Concluded repo state from the working tree without checking
  the remote first.
- **Rule going forward:** Before reporting anything missing from the repo, run
  `git fetch` and inspect `origin/*` branches; ask only after the remote is
  ruled out.

### 2026-06-10 (ET) — Box credentials live in AWS Secrets Manager, not local config

- **What happened:** A machine-wide hunt for Microsoft Graph credentials
  (CLIs, PS modules, credential manager, env vars) found nothing; the intended
  path was the "AWS Secrets Runtime" provisioning doc — load `prod/ec2-secrets`
  (us-east-1) into the session via `~/load-secrets.ps1`.
- **Root cause:** Provisioning convention was documented in SharePoint, not on
  the box.
- **Rule going forward:** On this project, secrets always come from AWS
  Secrets Manager `prod/ec2-secrets` through the loader; check there first.
  Codified in `TOOLS.md` (Secrets Source of Truth).

### 2026-06-10 (ET) — Windows default encoding corrupted generated surfaces

- **What happened:** The governance generator wrote surfaces with the locale
  encoding (cp1252) on Windows; UTF-8 readers (and Linux CI) would fail on the
  em-dashes.
- **Root cause:** `Path.read_text()`/`write_text()` without an explicit
  encoding.
- **Rule going forward:** All repo tooling I/O pins `encoding="utf-8"` (and
  `newline="\n"` on writes). Fixed in
  `scripts/generate-governance-surfaces.py`.
